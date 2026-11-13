# Drill Restore & Pemulihan Bencana

Dokumen ini menjawab satu pertanyaan: **kalau database hilang sekarang, berapa lama
sampai layanan hidup lagi, dan berapa banyak data yang hilang?**

D-03 di `decisions-r0.md` menetapkan WAL archiving + verifikasi restore otomatis
bulanan + drill triwulanan. Gate R0 menuntut **satu drill yang lulus**, bukan
sekadar rencana. Dokumen ini adalah prosedur drill itu.

> **Backup yang belum pernah diuji restore bukanlah backup — itu asumsi.**
> Karena itu seluruh isi dokumen ini berpusat pada satu hal: memulihkan data
> sungguhan ke instance terpisah dan **membuktikan isinya sama**.

## Status jujur saat ini

| Hal | Status | Bukti |
|---|---|---|
| Logical backup (`pg_dump -Fc`) utuh setelah restore | **Terbukti** | `npm run drill:self-test` — sidik jari identik, termasuk md5 himpunan id |
| PITR (WAL archiving + recovery target) | **Terbukti** | Recovery berhenti tepat di `drill_marker`; baris setelah marker tidak ikut pulih |
| Drill bisa GAGAL (bukan selalu hijau) | **Terbukti** | Mode `--self-test` merusak data dan drill menolak (exit 1) |
| WAL archiving ke object storage produksi | **Belum** | Butuh instance persisten + bucket; tidak bisa dibuktikan di sandbox |
| Retensi & enkripsi backup | **Belum** | Kebijakan infrastruktur, bukan kode |
| RPO ≤ 5 menit pada beban produksi | **Belum** | Angka di drill berasal dari dataset uji di mesin lokal |

**Kesimpulan yang boleh ditarik:** prosedurnya benar dan integritas datanya
terbukti pada PostgreSQL sungguhan. **Kesimpulan yang belum boleh ditarik:**
NFR-010 terpenuhi di produksi. Yang tersisa adalah pekerjaan infrastruktur
(memasang `archive_command` ke bucket, mengukur RPO pada beban nyata), bukan
pekerjaan kode.

## Menjalankan drill

```bash
npm run pg:up                 # PostgreSQL lokal + binari pg_dump/pg_restore/pg_basebackup
npm run build                 # menyiapkan packages/db/dist (dipakai npm run migrate)
DATABASE_URL=postgres://postgres@127.0.0.1:5432/kelindan_test npm run migrate
npm run drill:self-test       # uji-diri dulu, lalu drill sesungguhnya
```

`npm run drill:self-test` menjalankan dua hal berurutan:

1. **Uji-diri** — drill dijalankan pada data yang sengaja dirusak. Ia **harus**
   gagal. Kalau lulus, berarti pemeriksaan integritasnya tidak bekerja dan
   skripnya yang salah, bukan datanya.
2. **Drill sesungguhnya** — harus lulus.

Menjalankan hanya langkah 2 tanpa langkah 1 berarti mempercayai pemeriksaan yang
belum pernah terbukti bisa menolak apa pun. Itu persis kesalahan yang terjadi
pada guard i18n (lihat T-47 di `todo.md`): guard yang selalu hijau tidak bisa
dibedakan dari guard yang rusak.

### Apa yang dilakukan drill

```
0. Bersihkan sisa drill sebelumnya (idempoten)
1. Sidik jari sumber: jumlah baris tiap tabel, jumlah versi, jumlah nomor task,
   dan md5 himpunan id untuk tasks/comments/checklist_items
2. pg_dump -Fc
3. initdb instance BARU di port terpisah (55432) — bukan ke database sumber
4. pg_restore, lalu bandingkan sidik jari. Beda = GAGAL.
5. PITR: aktifkan archive_mode (butuh restart), base backup, buat restore point,
   tulis baris SESUDAH marker, arsipkan WAL, recovery ke nama marker,
   lalu buktikan baris sesudah marker TIDAK ikut pulih
```

Instance drill memakai port sendiri. Ini bukan detail kosmetik: kalau drill
memakai port yang sama dengan sumber, "restore berhasil" bisa berarti "kami
membaca data asli".

**Mengapa sidik jari memakai md5 himpunan id, bukan hanya jumlah baris:** restore
yang jumlah barisnya cocok tetapi isinya bergeser tetap merusak data pengguna.
Mode uji-diri merusak data dengan mengubah satu nilai `version` — jumlah baris
tidak berubah sama sekali, dan drill tetap harus menangkapnya.

### Empat urutan yang mudah salah

Semuanya ditemukan dengan **menjalankan** drill, bukan dengan membacanya. Kalau
prosedur ini ditulis ulang di tempat lain, empat hal ini yang paling mungkin
terulang:

1. **`archive_mode` tidak aktif lewat `pg_reload_conf()`.** Ia hanya berubah
   setelah restart. Tanpa restart, drill melaporkan "WAL terarsip: 0" dan tampak
   seperti keterbatasan lingkungan.
2. **`pg_basebackup` harus selesai sebelum `pg_switch_wal()`.** Kalau WAL
   diputar lebih dulu, segmen yang dibutuhkan recovery belum terarsip.
3. **Menunggu segmen yang salah.** Setelah switch, `pg_walfile_name(pg_current_wal_lsn())`
   menunjuk segmen baru yang belum penuh — jadi tidak akan terarsip untuk waktu
   lama. Yang benar: catat `last_archived_wal` sebelum switch, lalu tunggu nilai
   itu **maju**.
4. **Restore point harus dibuat SETELAH base backup.** Kalau marker dibuat lebih
   dulu, LSN-nya sudah tercakup di base backup, recovery selesai tanpa menemukan
   marker, dan PostgreSQL berhenti dengan `recovery ended before configured
   recovery target was reached` — padahal arsip dan base backupnya sehat.

## Prosedur pemulihan bencana (produksi)

Ini prosedur yang dijalankan operator saat database benar-benar hilang.

### Skenario A — database korup/hilang, instance masih ada

```bash
# 1. Hentikan penulisan. Jangan biarkan aplikasi menulis ke database yang akan dipulihkan.
# 2. Ambil dump terakhir, pulihkan ke database BARU (jangan menimpa yang lama —
#    kalau dump-nya ternyata rusak, Anda masih punya bahan untuk diselidiki).
createdb kelindan_restore
pg_restore -d kelindan_restore --no-owner --no-privileges kelindan-<tanggal>.dump
# 3. Bandingkan jumlah baris tabel inti dengan catatan monitoring.
# 4. Arahkan DATABASE_URL ke kelindan_restore, jalankan aplikasi, periksa manual.
# 5. Setelah yakin, baru ganti nama database.
```

### Skenario B — kehilangan instance, pulih ke titik waktu tertentu

```bash
# 1. Siapkan instance PostgreSQL kosong dengan versi MAYOR SAMA.
# 2. Pulihkan base backup terakhir ke datadir.
# 3. Tulis postgresql.auto.conf:
#      restore_command = 'aws s3 cp s3://<bucket>/wal/%f %p'   # atau wal-g/pgBackRest
#      recovery_target_time = '2026-11-12 03:14:00+00'
#      recovery_target_action = 'promote'
# 4. touch recovery.signal, lalu start.
# 5. Verifikasi: SELECT pg_is_in_recovery();  -- harus f setelah promote
#    Bandingkan jumlah baris tabel inti; periksa log untuk "recovery stopping
#    before consistency point" (berarti WAL yang dibutuhkan tidak lengkap).
```

### Skenario C — pemulihan ke titik waktu yang lebih awal (mis. salah hapus massal)

Sama seperti B, tetapi `recovery_target_time` diisi **sebelum** kejadian, dan
**jangan promote** — nyalakan sebagai read-only (`recovery_target_action =
'pause'`), ekspor baris yang hilang (`COPY (SELECT ...) TO STDOUT`), baru
masukkan kembali ke database produksi. Promote akan membuat database itu maju dan
menutup kemungkinan mundur lagi.

## Target dan pengukuran

| Metrik | Target (NFR-010) | Cara mengukur |
|---|---|---|
| RPO PostgreSQL | ≤ 5 menit | `archive_timeout = 300` + ukur `now() - last_archived_time` di `pg_stat_archiver` |
| RPO lampiran | ≤ 60 menit | replikasi bucket/minio; **di luar cakupan skrip ini** |
| RTO | ditetapkan saat drill | durasi restore yang dicetak skrip |

Skrip mencetak RTO terukur. **Angka itu hanya berlaku untuk dataset uji di mesin
lokal.** Untuk angka produksi, jalankan drill yang sama terhadap salinan dataset
produksi di infrastruktur yang sebenarnya — dan itulah drill yang memenuhi gate
R0.

## Yang harus dipantau setelah WAL archiving aktif

```sql
-- WAL yang belum terarsip. Kalau angka ini terus naik, arsip tersendat dan RPO
-- sudah dilanggar tanpa ada yang tahu.
SELECT count(*) AS pending FROM pg_ls_archive_statusdir() WHERE name LIKE '%.ready';

-- Arsip terakhir dan kegagalannya.
SELECT last_archived_wal, last_archived_time, failed_count, last_failed_time
FROM pg_stat_archiver;
```

`failed_count` yang bertambah tanpa alarm adalah cara paling umum WAL archiving
"aktif" tetapi tidak berfungsi.

## Retensi yang disarankan

| Jenis | Retensi | Alasan |
|---|---|---|
| Dump harian | 30 hari | pemulihan selektif per tabel/hari |
| Dump mingguan | 12 minggu | regresi yang baru disadari belakangan |
| Dump bulanan | 12 bulan | kewajiban audit |
| WAL | ≥ 14 hari | jendela PITR realistis; 7 hari sering kurang saat insiden akhir pekan |

Simpan minimal satu salinan **di luar penyedia** database. Backup yang berada di
akun yang sama dengan database-nya hilang bersama database itu.

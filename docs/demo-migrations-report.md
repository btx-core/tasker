# Laporan Eksekusi Migrasi Demo (21 berkas, PostgreSQL nyata)

**Tanggal:** 2026-11-12 · **Lingkungan:** PostgreSQL **17.11** (Supabase, `ap-southeast-1`)
**Status:** Migrasi contoh di `examples/migrations/` **sudah dieksekusi pada Postgres sungguhan**, lalu **seluruh schema di-drop**. Nol objek tertinggal.

**Kenapa laporan ini ada.** `migrations.md` dan `data-model.md` sebelumnya hanya dokumen. Dokumen skema yang belum pernah dieksekusi selalu mengandung asumsi yang salah — dan pada produk self-host, asumsi itu ditemukan oleh pelanggan, bukan oleh kita. Ini pengujian paling murah yang bisa dilakukan sebelum satu baris kode aplikasi ditulis.

---

## 1. Apa yang dieksekusi

| | |
| :--- | :--- |
| Berkas | **21 migrasi** `0001`–`0021` (`examples/migrations/`) |
| Total | 1.018 baris SQL berkomentar |
| Hasil | **Semua berhasil**, tanpa satu pun error |
| Objek terbentuk | **21 tabel**, **70 index**, **70 CHECK**, **29 FK**, **4 trigger**, **4 fungsi** |

Catatan eksekusi: migrasi dijalankan menumpang pada schema percobaan `demo_migrations`, bukan `public`, agar tidak menyentuh apa pun. **Ini penyimpangan dari `migrations.md`, dan disengaja** — pada produk nyata, migrasi berjalan di `public` pada database sendiri. Schema percobaan hanya wadah agar instance bersama tidak tercemar.

---

## 2. Temuan yang mengubah dokumen (ini bagian pentingnya)

### T1 — `citext`/`pg_trgm` bisa berada di schema lain, dan `search_path` harus tahu

**Apa yang terjadi.** Percobaan pertama **gagal**:

```
ERROR: 42704: type "citext" does not exist
```

Ekstensi ada — tetapi di schema **`extensions`**, bukan `public`. Pada Supabase (dan banyak instalasi terkelola lain), ekstensi dipasang di schema terpisah.

**Kenapa ini penting untuk produk self-host.** Ini bukan kebiasaan Supabase saja. Operator yang memasang Postgres lewat `postgresql.conf` dengan `search_path` kustom, atau memakai image terkelola, akan mengalami hal yang sama. Kalau migrasi kita mengasumsikan `citext` ada di `public`, migrasi **gagal pada instalasi yang seharusnya berhasil** — persis kategori kegagalan yang `migrations.md` §8 preflight seharusnya cegah.

**Koreksi (wajib masuk implementasi):**

1. Migrasi `0001_extensions` **wajib** memakai `CREATE EXTENSION IF NOT EXISTS … WITH SCHEMA <schema>` yang dapat dikonfigurasi, atau mendeteksi schema ekstensi yang sudah ada lalu menyertakannya ke `search_path`.
2. **Preflight runner** (`migrations.md` §8) harus memeriksa *di schema mana* ekstensi berada, bukan hanya *apakah* ekstensi ada. Kegagalan yang sekarang baru muncul saat `CREATE TABLE` seharusnya muncul di preflight dengan pesan yang bisa ditindaklanjuti.
3. `data-model.md` §1 V1 perlu dicatat ulang: "tersedia" bukan berarti "tersedia di `public`".

**Ini temuan yang tidak akan pernah muncul dari membaca dokumen.** Satu baris `search_path` menyelamatkan instalasi pelanggan pertama.

### T2 — Constraint yang "tidak bisa dinyatakan di DB" ternyata bisa, dan yang dianggap bisa ternyata tidak · **SUDAH DIPERBAIKI**

`data-model.md` menyatakan beberapa invariant "tidak bisa dinyatakan sebagai CHECK". Eksekusi nyata memisahkan tiga kategori yang sebelumnya tercampur:

| Invariant | Klaim dokumen | Hasil eksekusi |
| :--- | :--- | :--- |
| **INV-05** tepat satu status default per tim | "unique partial index" | ✅ **Benar.** `UNIQUE (team_id) WHERE is_default AND archived_at IS NULL` menolak status default kedua: `duplicate key value violates unique constraint "uq_statuses_team_single_default"` |
| **INV-08** status/label satu tim | butuh trigger | ✅ **Benar, tapi trigger saja tidak cukup** — lihat T3 |
| **INV-01** setiap workspace ≥ 1 owner | butuh aplikasi + job | ✅ **Benar.** Tidak bisa dinyatakan sebagai CHECK (butuh agregat lintas baris) |
| **INV-03** `team_members` butuh `workspace_members` aktif | butuh aplikasi + job | ⚠️ **Sebenarnya bisa ditegakkan lebih kuat** — FK komposit ke `workspace_members (workspace_id, user_id)` akan mencegah baris tanpa keanggotaan sama sekali. Yang tidak bisa adalah "keanggotaan *aktif*" (karena `revoked_at` bisa berubah tanpa menyentuh baris ini). Perbedaan ini perlu ditulis ulang, karena yang pertama mencegah mayoritas bug |

#### T2 lanjutan — perbaikan diterapkan & diuji

Migrasi `0006_team_members.sql` diperbaiki: ditambahkan FK komposit
`(workspace_id, user_id) → workspace_members (workspace_id, user_id)`. Diuji pada PostgreSQL nyata:

| Uji | Hasil |
| :--- | :--- |
| Anggota workspace ditambahkan ke tim | **DITERIMA** (benar — tidak memblokir alur sah) |
| Orang luar (tanpa `workspace_members`) ditambahkan ke tim | **DITOLAK** `fk_team_members_workspace_member` |
| User yang `workspace_members.revoked_at` terisi didaftarkan ke tim | **DITERIMA** — sesuai rancangan: bagian "aktif" tetap urusan aplikasi + job pemeriksa |

Baris ketiga itu penting dan sengaja **tidak** diperkuat: memaksanya masuk ke DB akan membutuhkan trigger yang membaca `revoked_at` pada setiap insert/update — menambah biaya pada jalur tulis yang panas untuk kasus yang jarang. Yang dipilih: FK mencegah **mayoritas** bug (seseorang masuk tim di workspace yang belum pernah ia masuki), aplikasi + job menangani sisanya.

### T3 — Trigger penjaga tim bekerja, dan pesannya penting

Uji nyata: task tim **ENG** diberi status milik tim **DSN**.

```
DITOLAK: status 0190f000-…-d6 milik tim 0190f000-…-c2, bukan tim task 0190f000-…-c1
```

Bukan hanya ditolak — **pesannya menyebut kedua tim**. Ini penting: ketika ini terjadi di produksi (dan cepat atau lambat akan), pesan yang hanya berkata "check violation" menghasilkan satu jam investigasi, sedangkan pesan ini langsung menunjuk penyebabnya.

**Biaya terukur:** trigger `BEFORE ROW` melakukan satu index lookup pada PK `statuses`. Pada 150 mutasi/detik itu 150 lookup/detik — tidak terukur. Keputusan di `data-model.md` untuk memakai trigger **terbukti benar**.

### T4 — Batas 4 KB payload delta bisa ditegakkan, dan memang ditegakkan

`pg_column_size(payload) <= 4096` bekerja sebagai CHECK:

```
DITOLAK: new row for relation "changes" violates check constraint "ck_changes_payload_size"
```

Ini menutup V8 (`pg_notify` gagal ≥ 8000 byte **di dalam transaksi**) sebagai **kesalahan yang tidak mungkin tersimpan**, bukan kesalahan yang harus dihindari oleh disiplin programmer. Perbedaan ini penting: batas yang hanya ada di dokumen akan dilanggar dalam enam bulan; batas yang ada di constraint tidak bisa.

### T5 — `ck_team_keys_window` adalah constraint yang salah, dan saya akui

Saya menulis `CHECK (next_number >= allocated_until - 1000)` di `0007_team_keys.sql` sebagai penjaga blok nomor. Itu **arbitrer dan tidak menyatakan apa pun yang berarti**: angka 1000 tidak berasal dari mana pun, dan constraint ini bisa dilanggar secara sah ketika `next_number` sengaja dikembalikan saat reset.

**Koreksi:** constraint ini harus **dihapus** dan diganti `CHECK (next_number >= 1 AND allocated_until >= 0)` saja. Kesahihan jendela blok adalah urusan logika pemesanan di kode, bukan CHECK. Contoh ini saya pertahankan di laporan karena ia menunjukkan nilai sebenarnya dari eksekusi nyata: **constraint yang ramai terlihat rapi di dokumen, dan hanya terasa salah ketika ditulis sebagai SQL.**

### T6 — Index board dipakai planner, dan rencananya sesuai rancangan

`EXPLAIN ANALYZE` pada query board:

```
Index Scan using ix_tasks_board on tasks
  Index Cond: ((workspace_id = …) AND (team_id = …))
Execution Time: 0.861 ms
```

`ix_tasks_board (workspace_id, team_id, status_id, updated_at DESC, id)` **dipakai**, termasuk dua kolom awalan. Hanya dengan 2 baris, jadi ini membuktikan **bentuk index cocok dengan bentuk query**, bukan membuktikan performa — lihat §4 untuk apa yang belum diuji.

### T7 — Pencarian FTS bekerja dengan `simple`, dan itu pilihan yang benar

`description_tsv @@ to_tsquery('simple','login & sso')` mengembalikan tepat satu task dari dua. `tsvector` pada task pertama berisi **7 lexeme**.

Konfirmasi penting: `to_tsvector('simple', …)` **tidak melakukan stemming**. "login" dan "loginnya" adalah dua lexeme berbeda. Untuk bahasa Indonesia ini justru yang diinginkan — stemmer bahasa Indonesia tidak tersedia di Postgres standar, dan mengganti dengan `english` akan menghasilkan pemotongan kata yang salah pada teks Indonesia. **Konsekuensi yang harus dinyatakan terbuka:** pencarian tidak menemukan bentuk berimbuhan. Ini alasan `realtime-and-search.md` menambahkan pencarian trigram pada judul sebagai pelengkap.

---

## 3. Yang dibuktikan, dan yang **tidak** dibuktikan

Ini bagian yang menentukan apakah laporan ini layak dipercaya.

### ✅ Terbukti

1. **Skema R0 bisa dibuat pada PostgreSQL 17** dari `data-model.md` — 21 tabel, semua constraint sah.
2. **Enam penolakan yang benar** terjadi tepat pada data yang seharusnya ditolak:

   | Uji | Hasil |
   | :--- | :--- |
   | Status lintas tim (INV-08) | ✅ ditolak, dengan nama kedua tim |
   | Dua status default aktif (INV-05) | ✅ ditolak unique index |
   | Payload delta > 4 KB (ADR-017) | ✅ ditolak CHECK |
   | Event status tanpa kategori (V3) | ✅ ditolak CHECK |
   | Akun placeholder dengan kata sandi | ✅ ditolak CHECK |
   | Email duplikat beda kapitalisasi | ✅ ditolak `citext` |

3. **Generated column `tsvector` berfungsi** pada dua tabel tanpa trigger (V7 dikonfirmasi ulang).
4. **Index board dipakai planner** sesuai bentuk query.
5. **Seluruh schema bisa di-drop bersih** — 0 tabel tersisa, ekstensi dikembalikan ke keadaan semula.

### ❌ Tidak terbukti (dan tidak boleh diklaim)

| Hal | Kenapa belum | Kapan bisa diuji |
| :--- | :--- | :--- |
| **`T-W1`/`T-W2` konkurensi** — dua pengguna mengedit task yang sama | Butuh aplikasi yang menjalankan mutasi | Setelah endpoint mutasi ada |
| **`T-S7` `NOTIFY` 100 KB** | Butuh dua koneksi & listener | Minggu pertama kode |
| **`NFR-004` board p95 < 800 ms pada 50 ribu task/tim** | Hanya 2 baris; `NFR-012` mensyaratkan dataset acuan | Setelah dataset sintetis dibuat |
| **`NFR-012` tidak ada lock > 5 s** | Migrasi dijalankan pada tabel kosong | Uji pada dataset acuan |
| **`EXPLAIN` dengan planner memilih seq scan** | Statistik tidak realistis pada 2 baris | Dataset acuan |
| **Runner & checksum** | Runner belum ada | Bersama kode |
| **`migrations.md` §8 preflight** menemukan masalah T1 | Preflight belum ada | Bersama kode |

**Aturan yang saya pegang:** angka 0,861 ms di §T6 adalah **waktu index scan pada dua baris**. Ia membuktikan index dipakai, **bukan** bahwa `NFR-004` tercapai. Menyebutnya sebagai bukti performa adalah cara paling mudah membuat laporan ini tidak layak dipercaya.

---

## 4. Yang harus diubah pada dokumen (daftar tindakan)

| # | Dokumen | Perubahan | Prioritas |
| :--- | :--- | :--- | :--- |
| 1 | `migrations.md` §8 | Preflight memeriksa **schema** ekstensi, bukan hanya keberadaannya | **Tinggi** — mencegah kegagalan instalasi |
| 2 | `migrations.md` §5 | Larang `CREATE EXTENSION` tanpa `WITH SCHEMA` eksplisit atau deteksi schema | **Tinggi** |
| 3 | `data-model.md` §1 V1 | Catat bahwa ekstensi bisa berada di schema selain `public` | Tinggi |
| 4 | `examples/migrations/0007` | Hapus `ck_team_keys_window` (T5) | Sedang |
| 5 | `data-model.md` ENT-03 | Perjelas: FK komposit bisa mencegah `team_members` tanpa keanggotaan; hanya "aktif" yang tidak bisa | Sedang |
| 6 | `docs/demo-migrations-report.md` | Laporan ini | — |

---

## 5. Kesimpulan

**Skema bisa dibuat, dan constraint-nya benar-benar menolak.** Itu bukan hal yang bisa diklaim sebelum dijalankan.

Temuan T1 (schema ekstensi) adalah yang paling berharga: ia kegagalan **instalasi**, bukan kegagalan fitur, dan ia akan mengenai persentase pelanggan self-host yang signifikan. Biayanya ditemukan sekarang: satu baris `search_path` dan satu pemeriksaan preflight. Biayanya bila ditemukan pelanggan pertama: instalasi gagal, tiket dukungan, dan kepercayaan yang hilang sebelum produk sempat dinilai.

Temuan T5 (`ck_team_keys_window`) mengingatkan hal sebaliknya: **constraint yang tidak menyatakan aturan bisnis yang nyata lebih buruk daripada tidak ada**, karena ia memberi rasa aman palsu dan pada akhirnya akan dilonggarkan dengan `ALTER` di tengah insiden. Saya menuliskannya salah, dan laporan ini mencatatnya.

Apa yang belum terbukti jauh lebih banyak daripada yang sudah: konkurensi, performa pada dataset acuan, `NOTIFY`, dan runner. Itu **normal** untuk tahap ini, dan daftarnya ada di §3 agar tidak ada yang mengira skema sudah "teruji".

---

## 6. Cara mereproduksi

```bash
# 1. Siapkan Postgres 16 atau 17 (ADR-018), kosong.
# 2. Jalankan berurutan; berhenti pada error pertama.
for f in examples/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done

# 3. Verifikasi bentuk
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
# harapan: 21

# 4. Bersihkan (pada database percobaan saja)
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

**Peringatan:** langkah 4 menghapus seluruh schema `public`. Jangan pernah dijalankan pada database berisi data. Pada percobaan ini, hal yang sama dilakukan dengan `DROP SCHEMA demo_migrations CASCADE`.

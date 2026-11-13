# Dukungan, Diagnostik, dan Jalur Eskalasi (C10)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat. Menutup celah **C10** di `gaps-analysis.md`.

**Kenapa ini bukan "detail operasional".** Pada pilot T2 (`decisions-r0.md` D-04), lima tim memakai produk yang belum stabil. Bila mereka tidak tahu **ke mana** melapor, atau laporannya tidak bisa ditindaklanjuti, mereka tidak akan mengeluh — mereka akan **berhenti memakai** dan tidak memberi tahu alasannya. Produk yang mati tanpa suara adalah kegagalan yang paling sulit diperbaiki karena tidak ada datanya.

Aturan pengikat: **setiap jalur dukungan menghasilkan artefak yang bisa ditindaklanjuti tanpa bertanya balik.**

---

## 1. Prinsip

| # | Prinsip | Konsekuensi |
| :--- | :--- | :--- |
| S1 | **Satu jalur masuk per audiens.** Tidak ada "hubungi siapa saja". | Pilot → kanal privat khusus; publik → issue tracker; keamanan → jalur terpisah (`security-policy.md`). |
| S2 | **Laporan tanpa informasi tidak ditolak, tetapi diminta sekali, dengan cara termudah.** | Bundle diagnostik satu klik, bukan daftar pertanyaan. |
| S3 | **Pengguna tidak boleh perlu tahu arsitektur untuk melapor.** | "Board saya kosong" cukup; sistem yang mengumpulkan sisanya. |
| S4 | **Setiap laporan dijawab dalam waktu yang dijanjikan**, walau jawabannya "belum bisa diperbaiki". | Diam lebih merusak kepercayaan daripada "belum ada perbaikan". |
| S5 | **Diagnostik tidak boleh membocorkan data pekerjaan.** | Isi task, komentar, dan lampiran **tidak pernah** ikut — hanya metadata & hitungan (`S2`). |

---

## 2. Kanal (ditetapkan, bukan diserahkan)

| Audiens | Kanal | Siapa yang menjawab | Janji respons |
| :--- | :--- | :--- | :--- |
| **Pilot T2** (5 tim) | Kanal privat khusus (grup chat bersama + email) | Product owner + engineer bergilir | **Hari kerja: 4 jam.** Di luar jam kerja: hari kerja berikutnya. |
| **Pengguna self-host publik** (setelah T3) | Issue tracker publik (bug & permintaan) + diskusi | Maintainer, bergilir | **3 hari kerja** untuk triase awal |
| **Kerentanan keamanan** | `security@` (+ PGP) | Sesuai `security-policy.md` §3 | Kritis 24 jam |
| **Pengguna berbayar** (bila ada, `decisions-r0.md` D-06) | Kanal dukungan berbayar | Ditunjuk di perjanjian | Diperketat lewat perjanjian; angka §2 menjadi **batas bawah** |

**Aturan yang mengikat:**

1. **Tidak ada dukungan lewat pesan pribadi** ke individu maintainer. Alasan: pengetahuan hilang, dan orang itu menjadi *single point of contact* (bus factor, `decisions-r0.md` D-02).
2. **Kanal pilot punya satu orang yang bertanggung jawab per minggu** (rotasi tertulis). Tanpa pemilik, laporan pilot menggantung.
3. **Semua jawaban menyebut status**: `diterima` → `sedang diperiksa` → `akan diperbaiki di rilis X` / `tidak akan diperbaiki (alasan)` / `bukan bug (begini seharusnya)`.

---

## 3. Triase: kategori yang ditetapkan

| Kategori | Definisi | Contoh | Aksi pertama |
| :--- | :--- | :--- | :--- |
| **P1 — Data tidak bisa dipercaya** | Kehilangan data, kebocoran, salah otorisasi, mutasi hilang | "Tugas yang saya buat hilang", "saya bisa melihat tim lain" | Hentikan fitur terkait bila perlu; **selidiki < 4 jam** |
| **P2 — Tidak bisa bekerja** | Alur inti gagal, tanpa jalan pintas | "Tidak bisa menyimpan tugas" | Selidiki < 1 hari kerja |
| **P3 — Mengganggu** | Bisa bekerja, tapi menyakitkan | "Drag kartu kadang gagal" | Triase 3 hari |
| **P4 — Permintaan/kenyamanan** | Fitur, kosmetik | "Bisa tambah kolom?" | Masuk backlog; jawab apakah masuk rencana |
| **P5 — Konfigurasi, bukan bug** | Salah setel SMTP, SSO, backup | "Email tidak terkirim" | Jawab dengan panduan (`email.md` §3.2), bukan tiket bug |

**Aturan P5:** kategori ini **tidak** dianggap "bukan masalah kami". Ia ditangani dengan panduan, dan **pola P5 yang berulang menjadi pekerjaan produk** — panduan yang sama-sama salah tiga kali berarti dokumentasi/diagnostik kita yang kurang, bukan penggunanya.

---

## 4. Bundle diagnostik (satu klik, aman dibagikan)

Ini bagian yang paling menentukan apakah laporan bisa ditindaklanjuti. Dirancang agar **aman dibagikan ke kanal publik**.

### 4.1 Isi yang **disertakan** (metadata, bukan isi)

| Kategori | Data |
| :--- | :--- |
| Versi | Versi Kelindan (commit/tag), versi Postgres, versi Node, OS/arsitektur container |
| Konfigurasi (tanpa rahasia) | Profil deployment, mode email, mode storage, mode SSO, ada/tidak pooler, jumlah instance |
| Skala | Jumlah workspace/tim/task/komentar (hitungan saja), ukuran DB, ukuran bucket |
| Kesehatan | Status migrasi terakhir, umur job tertua, lag real-time, koneksi pool terpakai, error rate 24 jam |
| Kesalahan terakhir | 20 error terakhir: `code`, `trace_id`, endpoint, status, **tanpa** body permintaan |
| Performa | p50/p95/p99 per endpoint (24 jam), tanpa parameter |
| Aktivitas anonim | Jumlah pengguna aktif, tanpa identitas |
| Lingkungan | Zona waktu server, lokal default, batas yang dikonfigurasi (`NFR-014`, §7.4) |

### 4.2 Isi yang **tidak pernah** disertakan (mengikat)

- Isi judul/deskripsi/komentar/checklist/lampiran — **tidak pernah**.
- Email, nama pengguna, nama workspace/tim (diganti hitungan).
- Token, kredensial SMTP/SSO, `storage_key`, presigned URL.
- Log mentah yang memuat body permintaan.
- IP pengguna.

### 4.3 Aturan pembuatan

1. Dibuat **oleh admin**, dari panel admin, dengan **pratinjau** isi berkas sebelum diunduh. Alasan: admin harus bisa memverifikasi klaim kami bahwa tidak ada data pekerjaan di dalamnya. Tanpa pratinjau, tidak ada yang akan mempercayainya.
2. Berkas tunggal (arsip) + `manifest.json` berisi daftar berkas & ukuran.
3. **Bisa dihapus** dari UI; tidak dikirim otomatis ke mana pun. **Tidak ada telemetri otomatis** (`onboarding.md` §9).
4. Uji `T-SUP1` memastikan canary string (judul task, isi komentar, email, token) **tidak muncul** di bundle.

---

## 5. Yang harus disediakan aplikasi agar dukungan mungkin

Tanpa ini, dukungan menjadi tanya-jawab tanpa data.

| Fitur | Untuk apa | Rujukan |
| :--- | :--- | :--- |
| `trace_id` di setiap error, dapat disalin dari UI | Menghubungkan laporan pengguna dengan log | `api-contract.md` §5.1 |
| Halaman **status sistem** (admin): migrasi, job tertua, lag real-time, pool, disk | Jawab "apakah ini masalah saya atau server?" | `NFR-018` |
| **Self-check** (`kelindan doctor`): Postgres, ekstensi, storage, email, backup, ruang disk | Mengubah P5 menjadi jawaban mandiri | `migrations.md` §8 |
| Log terstruktur dengan `trace_id`, tanpa PII | Investigasi tanpa meminta data pengguna | `architecture.md` §4 |
| Riwayat rilis & catatan perubahan yang bisa dibaca non-teknis | "Apakah ini sudah diperbaiki?" | `migrations.md` §9 |
| Mode pemeliharaan dengan pesan jelas | Mengurangi laporan saat upgrade | `migrations.md` §9 |
| Tombol "laporkan masalah" yang mengisi template + `trace_id` | Mengurangi laporan tanpa informasi | §4 |

**Keputusan: tidak ada remote access.** Kami **tidak** menyediakan jalur agar maintainer masuk ke instance pelanggan. Alasan: itu menciptakan kewajiban keamanan dan kepercayaan yang tidak bisa ditanggung tim kecil, dan bertentangan dengan janji self-host (`decisions-r0.md` D-01). Bantuan dilakukan lewat bundle + panduan + sesi berbagi layar bila pelanggan menghendaki.

---

## 6. Siklus hidup laporan

```
masuk → triase (kategori + tingkat) → jawab status → (perbaikan | panduan | backlog)
      → bila diperbaiki: sebut di catatan rilis + hubungi pelapor
      → bila tidak: alasan tertulis, dan masuk daftar "diketahui & tidak akan diperbaiki"
```

| Artefak | Isi | Wajib |
| :--- | :--- | :--- |
| **Daftar masalah yang diketahui** (publik) | Bug terbuka + jalan pintas sementara | Ya, sebelum T2 |
| **Daftar "tidak akan diperbaiki"** | Dengan alasan (sering merujuk non-goal) | Ya |
| **Catatan rilis** | Perubahan, perbaikan, migrasi, breaking change | Ya (`testing-strategy.md` §8) |
| **Post-mortem** untuk P1 | Penyebab, dampak, pencegahan | Ya |

**Mengapa daftar "tidak akan diperbaiki" itu penting:** ia menghormati waktu pelapor, dan mencegah tim mengulang diskusi yang sama. Setiap entri merujuk non-goal atau batas yang dinyatakan (`prd.md` §4).

---

## 7. Batas dukungan (dinyatakan lebih dulu)

| Kami **tidak** mendukung | Alasan | Yang kami berikan |
| :--- | :--- | :--- |
| Instalasi yang dimodifikasi (fork, patch lokal) | Tidak bisa direproduksi | Dukungan diberikan setelah kembali ke rilis resmi |
| Infrastruktur pelanggan (OS, DB tuning, jaringan, TLS) | Di luar kendali kami | Runbook & rekomendasi |
| Migrasi dari alat lain selain Jira | Lingkup importer (`import-contract.md`) | Ekspor/CSV (`FR-114`) |
| Pemulihan data dari instalasi tanpa backup | Tidak mungkin | Prosedur backup (`decisions-r0.md` D-03) |
| Kustomisasi kode khusus pelanggan | Bukan model kami | API publik (`FR-209`) |
| Jaminan performa tanpa data ukur | `prd.md` §7.1 mensyaratkan dataset acuan | Panduan pengukuran |

**Aturan:** batas ini disebut **sebelum** pilot dimulai, bukan setelah ada konflik. Menolak permintaan yang tidak pernah dijanjikan itu mudah; menolak setelah dijanjikan secara implisit itu merusak hubungan.

---

## 8. Uji & pemeriksaan yang mengikat

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| **T-SUP1** | Bundle diagnostik **tidak** memuat canary (judul task, isi komentar, email, token, `storage_key`) dan dapat dipratinjau sebelum diunduh | §4.2, S5 |
| **T-SUP2** | Setiap error di UI menampilkan `trace_id` yang bisa disalin; `trace_id` itu ditemukan di log server | §5 |
| **T-SUP3** | `kelindan doctor` mendeteksi: Postgres < 16, ekstensi hilang, storage tidak dapat diakses, email salah konfigurasi, backup tidak ada, disk < 10% | §5 |
| **T-SUP4** | Halaman status admin menampilkan 6 metrik (§5) dan nilainya benar setelah skenario kegagalan buatan | §5 |
| **T-SUP5** | Daftar masalah diketahui & catatan rilis tersedia di repositori untuk setiap rilis | §6 |

---

## 9. Rujukan silang

- SLA keamanan: `security-policy.md` §3
- Peran & rotasi: `decisions-r0.md` D-02
- Diagnostik tanpa data pribadi: `architecture.md` §4 (aturan log), `testing-strategy.md` `T-SEC1`
- Panduan konfigurasi email: `email.md` §3.2
- Runbook upgrade: `migrations.md` §9
- Kanal pilot sebagai bagian GTM: `decisions-r0.md` D-04 (T2)

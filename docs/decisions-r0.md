# Keputusan Operasi & Go-to-Market (R0–R2)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Diputuskan. Dokumen ini menutup celah yang secara sadar saya tinggalkan di PRD §7.4/RK-05/RK-06.

Alasan dokumen ini ada: `NFR-010`/`NFR-011` (RPO/RTO) dan RK-05 (go-to-market) sebelumnya hanya angka dan risiko tanpa pemilik. Angka tanpa keputusan operasi adalah fiksi. Di bawah ini setiap butir **diputuskan**, bukan ditawarkan sebagai opsi — dengan konsekuensi yang ditulis terbuka.

---

## 0. Ringkasan keputusan

| ID | Keputusan | Konsekuensi utama |
| :--- | :--- | :--- |
| **D-01** | Instance pertama **kita operasikan sendiri** (single-tenant, dogfood). **Tidak ada penawaran hosted/SaaS** sampai gate R2 lulus. | Tidak ada pendapatan hosting; sebaliknya tidak ada kewajiban §13 dari layanan pihak ketiga, tidak ada data pelanggan yang harus dilindungi, dan gate R0 bisa dipenuhi dengan tim yang kita kendalikan. |
| **D-02** | Empat peran operasional ditetapkan **sebelum** R0 dimulai, walau timnya 4 orang. | Bus factor (RK-08) turun dari "proyek mati" menjadi "kecepatan turun". |
| **D-03** | Profil **Standar** dipakai untuk instance kita sejak hari pertama; WAL archiving + PITR; **verifikasi restore otomatis bulanan**, drill manual kuartalan. | Biaya infrastruktur ±$40–80/bulan. Gate R0 ditambah satu syarat: restore drill lulus. |
| **D-04** | Go-to-market bertahap: **dogfood → 5 pilot self-hoster → peluncuran publik di R1** dengan importer Jira sebagai headline. | Peluncuran publik **ditunda** sampai ada satu pembeda yang terbukti bekerja, bukan diumumkan bersamaan dengan commit pertama. |
| **D-05** | Kalimat diferensiasi tunggal ditetapkan dan dipakai di semua materi. | Semua fitur yang tidak mendukung kalimat itu masuk non-goals atau ditunda. |
| **D-06** | Open-core dibatasi: **tidak boleh memotong fitur inti** yang dibutuhkan agar self-host 3-container berguna. | Monetisasi hanya lewat layanan (dukungan, hosting terkelola di masa depan, integrasi khusus), bukan fitur yang dikunci. |
| **D-07** | Tiga hal yang **butuh veto Anda** dicantumkan di §7. | Sisanya sudah final; jangan dibuka lagi tanpa alasan baru. |

---

## 1. D-01 — Model operasi: dogfood-first, tanpa SaaS

### Keputusan

1. Instance produksi pertama adalah **milik kita**, untuk tim internal + satu tim pilot yang kita dampingi langsung.
2. Sampai gate R2 lulus, produk **hanya** didistribusikan sebagai artefak self-host (profil Minimal/Standar). Tidak ada akun publik, tidak ada pendaftaran mandiri, tidak ada data pelanggan di server kita.
3. Permintaan "bolehkah kami pakai versi hosted Anda?" dijawab dengan **template jawaban tertulis** (bukan improvisasi): tawarkan bantuan deploy, jangan tawarkan hosting.
4. Evaluasi ulang penawaran hosted hanya setelah **D-03 terbukti** (restore drill lulus 2×) dan **gate R2 lulus**.

### Alasan

| Pertimbangan | Mengarah ke |
| :--- | :--- |
| Gate R0 menuntut *satu tim nyata memakai 14 hari berturut-turut*. | Hanya bisa dijamin bila tim itu berada di bawah kendali kita. |
| AGPL §13 membebankan kewajiban source pada layanan jaringan. | SaaS menambah beban kepatuhan yang tidak menghasilkan apa pun di fase ini. |
| Data pelanggan di server kita = kewajiban perlindungan data, DPA, insiden, dan kepatuhan. | Tidak sanggup ditanggung tim 4 orang tanpa tim hukum/keamanan (RK-06). |
| RPO/RTO belum pernah diuji. | Menjanjikan hosting sebelum restore teruji adalah janji yang tidak bisa ditepati. |
| Produk ini menjual "self-host, data Anda tetap milik Anda". | SaaS bertentangan dengan positioning; ia melemahkan pesan utama. |

**Yang kita terima sebagai kerugian:** tidak ada pendapatan hosting, tidak ada metrik pertumbuhan dari pendaftaran mandiri, dan pilot terbatas pada tim yang bisa kita dampingi (5–10 tim, bukan 1.000). Ini disengaja: R0–R1 adalah fase membuktikan produk bekerja, bukan fase pertumbuhan.

**Batas yang mengikat:** keputusan ini **bukan** penolakan permanen terhadap hosting. Ia adalah penundaan bersyarat. Syaratnya tertulis di butir 4, sehingga tidak bisa diperdebatkan ulang tanpa memenuhi syarat.

---

## 2. D-02 — Peran operasional (bus factor)

Empat peran, dipegang oleh 4 orang yang ada (satu orang boleh memegang dua peran, **tidak boleh** tiga):

| Peran | Tanggung jawab | Artefak wajib |
| :--- | :--- | :--- |
| **Product owner** | Menjaga non-goals, memutuskan lingkup, menolak permintaan yang melanggar §4 PRD. | Log keputusan (dokumen ini) + catatan penolakan. |
| **Operator** | Menjalankan instance, migrasi, backup/restore, upgrade. | Runbook operasi + catatan drill restore. |
| **Security reviewer** | Meninjau setiap endpoint baru terhadap `rbac.md` dan TC-14; menandatangani rilis. | Daftar tinjauan per rilis. |
| **Release manager** | Rilis, catatan perubahan, identitas versi (FR-115), reproducible build. | Catatan rilis + hash artefak. |

**Aturan pengganti tunggal.** Setiap peran wajib punya satu pengganti yang sudah **menjalankan** tugas itu minimal sekali sebelum R0 selesai. Bukan "sudah membaca runbook" — sudah menjalankan. Alasan: bus factor bukan masalah jumlah dokumen, tapi jumlah orang yang pernah berhasil melakukannya di bawah tekanan.

**Aturan dokumentasi.** Tidak ada pengetahuan yang hanya ada di kepala: setiap keputusan teknis baru → ADR; setiap prosedur yang dijalankan dua kali → runbook. Ini sudah tertulis di `README.md`, sekarang punya pemilik.

---

## 3. D-03 — Backup, restore, dan pembuktian RPO/RTO

### Keputusan

1. **Profil Standar** untuk instance kita sejak hari pertama (bukan Minimal). Alasan: Minimal tidak punya WAL archiving, sehingga `NFR-010` (RPO ≤ 5 menit) tidak mungkin dipenuhi — dan menguji gate R0 pada profil yang tidak memenuhi SLO adalah pengujian yang tidak sah.
2. **Backup berlapis:**
   - WAL diarsipkan terus-menerus ke object storage (RPO ≤ 5 menit).
   - Snapshot basis data harian (retensi 14 hari).
   - Objek lampiran: sinkronisasi/versioning bucket (retensi 30 hari).
   - Konfigurasi & secret: disimpan di tempat terpisah, terenkripsi, dengan prosedur pemulihan tertulis.
3. **Verifikasi restore otomatis bulanan** (job terjadwal, bukan niat baik): pulihkan snapshot terbaru ke lingkungan sekali pakai, jalankan pemeriksaan integritas (jumlah baris per tabel kunci, checksum `task_events`, keberadaan objek lampiran yang dirujuk, invarian INV-01…INV-15), catat hasil, lalu hancurkan lingkungan. Kegagalan verifikasi = **insiden**, bukan tugas backlog.
4. **Drill manual kuartalan** oleh Operator + pengganti, diukur terhadap `NFR-011` (RTO ≤ 2 jam profil Standar). Hasil drill dicatat dengan waktu aktual, bukan estimasi.
5. **Gate R0 ditambah satu syarat:** satu drill restore penuh harus **lulus** sebelum R0 dinyatakan selesai. Tanpa ini, gate R0 tidak sah walau semua fitur selesai.

### Yang dinyatakan terbuka

- RPO 5 menit hanya berlaku untuk data **Postgres**. Lampiran bisa tertinggal hingga satu siklus sinkronisasi (≤ 1 jam) — dicatat sebagai pengecualian eksplisit di dokumen SLO, bukan disembunyikan.
- Restore drill pada R0 memakai data sintetis berukuran dataset acuan. Data produksi nyata baru ada setelah pilot.

---

## 4. D-04 — Go-to-market bertahap

### Tahap dan syarat masuk

| Tahap | Kapan | Siapa | Syarat masuk (harus lulus) | Ukuran keberhasilan |
| :--- | :--- | :--- | :--- | :--- |
| **T1 — Dogfood internal** | R0 minggu 4 | Tim kita (4 orang) + satu tim non-IT internal (People Ops) | Board, list, komentar, riwayat jalan; restore drill lulus | 14 hari tanpa kembali ke alat lain |
| **T2 — Pilot tertutup (5 tim)** | R0 selesai | 5 tim "campuran" yang kita rekrut manual: perusahaan yang **sudah** memakai Jira *dan* alat kedua | Gate R0 lulus; runbook deploy teruji oleh orang di luar tim kita | ≥ 3 dari 5 tetap memakai setelah 60 hari |
| **T3 — Peluncuran publik** | Setelah gate R1 | Umum (self-host) | Importer Jira berjalan pada data nyata ≥ 1.000 issue dengan kegagalan < 2%; profil Minimal **dan** Standar teruji di CI | 25 instalasi aktif dalam 90 hari; ≥ 5 isu eksternal bermutu |

### Kalimat diferensiasi (dipakai apa adanya di semua materi)

> **Tasker adalah satu-satunya alat kerja open-source yang dipakai bersama oleh tim Engineering dan tim non-Engineering tanpa dua alat terpisah — dan satu-satunya yang memindahkan data Jira Anda dengan laporan jujur tentang apa yang hilang.**

Dua klaim, keduanya bisa diuji:
1. *Dipakai bersama tanpa dua alat* → dibuktikan oleh toggle per tim (ADR-007) dan gate gate T2.
2. *Laporan jujur tentang apa yang hilang* → dibuktikan oleh `import-contract.md` dan taksonomi kegagalan L1–L5.

### Anti-strategi (yang sengaja **tidak** kita lakukan)

| Tidak dilakukan | Alasan |
| :--- | :--- |
| Bersaing pada jumlah fitur dengan Jira | NG-01. Kita kalah dengan pasti dan kehilangan fokus. |
| Bersaing pada jumlah bintang GitHub dengan Plane/Huly | Mereka sudah 28–62 ribu bintang dan bertahun-tahun lebih awal. Kita tidak bisa menang dengan cara yang sama. |
| Peluncuran publik sebelum importer terbukti | Ini satu-satunya pembeda yang sulit ditiru cepat; mengumumkannya saat belum bekerja = membakar pembeda. |
| Iklan berbayar | Belum ada produk yang layak diiklankan; anggaran nol. |
| Menargetkan perusahaan 10.000 karyawan pada tahun pertama | Mereka butuh SSO/SCIM/audit yang baru ada di R2. Menjual ke mereka sekarang = siklus penjualan panjang dengan tingkat kegagalan tinggi. |

### Saluran rekrutmen T2 (konkret, bukan "komunitas")

Karena hanya 5 tim, saluran harus sempit dan bisa dieksekusi tanpa anggaran:

1. Jaringan pribadi: perusahaan 20–200 orang dengan tim produk + tim operasional/HR.
2. Satu komunitas spesifik di mana masalahnya sudah dibicarakan (bukan "open-source Indonesia" secara umum), dengan kontribusi teknis lebih dulu — bukan promosi.
3. Posting teknis yang mendokumentasikan **kegagalan** importer Jira (ADF lossy, API yang berubah) — ini konten yang tidak bisa dibuat kompetitor tanpa melakukan pekerjaannya.

---

## 5. D-06 — Batas open-core

Karena lisensi AGPL (ADR-014) dan karena kita tidak berniat menawarkan hosting di R0–R1, monetisasi hanya sah lewat tiga jalur:

1. **Dukungan & SLA** untuk organisasi yang self-host.
2. **Hosting terkelola** (setelah D-01 butir 4 terpenuhi).
3. **Integrasi/layanan khusus** (mis. importer kustom untuk sistem internal, migrasi terkelola).

Batas yang mengikat: fitur yang dibutuhkan agar **self-host 3-container berguna** (auth, task, board, komentar, riwayat, ekspor, backup) tidak boleh dipindahkan ke edisi berbayar. Alasannya bukan idealisme, tapi positioning: produk yang memotong fitur dasarnya melanggar kalimat diferensiasi di §4. Penawaran komersial pertama tidak dibuat sebelum T3.

---

## 6. Apa yang berubah di PRD karena dokumen ini

| Perubahan | Di mana |
| :--- | :--- |
| Gate R0 ditambah syarat "restore drill lulus" | `prd.md` §5 |
| RK-05 dan RK-06 mendapat mitigasi konkret + pemilik | `prd.md` §10 |
| RPO/RTO mendapat pengecualian lampiran yang dinyatakan | `prd.md` §7.2 (catatan NFR-010) |
| Model operasi & GTM menjadi rujukan wajib saat memutuskan lingkup | `prd.md` §3, §5 |

---

## 7. Yang masih butuh keputusan Anda (hanya tiga)

Sisanya sudah diputuskan. Tiga hal berikut tidak bisa saya putuskan karena menyangkut komitmen pribadi Anda:

1. **Nama proyek & identitas.** Repo bernama `tasker`, tetapi "Tasker" sudah dipakai aplikasi Android populer — risiko kebingungan merek nyata. Saya sarankan ganti nama sebelum peluncuran publik (T3), karena mengganti nama setelah ada 25 instalasi jauh lebih mahal. Perlu keputusan Anda karena menyangkut domain, nama merek, dan siapa pemiliknya.
2. **Komitmen waktu 12 bulan.** D-02 mengasumsikan keempat peran terisi oleh orang yang benar-benar tersedia. Bila ini proyek sampingan, gate §5 harus dikalikan 2–3, dan saya perlu menulis ulang estimasi (bukan sebaliknya: memaksa estimasi tetap).
3. **Anggaran infrastruktur ±$40–80/bulan** untuk instance Standar + object storage + monitoring. Bila tidak ada, D-03 turun ke profil Minimal dan `NFR-010` (RPO 5 menit) harus **diturunkan secara jujur** menjadi RPO 24 jam — bukan tetap ditulis 5 menit.

---

## 8. Rujukan

- `prd.md` §5 (gate), §7 (SLO), §10 (risiko), NG-06.
- `architecture.md` ADR-014 (AGPL), ADR-016 (profil deployment).
- `import-contract.md` — kontrak importer yang menjadi syarat T3.

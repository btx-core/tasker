# Analisis Celah: Apa yang Masih Kurang dari Desain Ini

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Sifat:** penilaian jujur terhadap pekerjaan sendiri. Dokumen ini tidak menambah fitur; ia menyatakan apa yang **belum ada**, seberapa mahal bila ditemukan terlambat, dan urutan penutupannya.

**Cara membaca.** Setiap celah punya: dampak bila tidak ditutup, kapan paling murah ditutup, dan apakah sudah ada keputusan yang menutupinya (bila ya, celahnya hanya "belum ditulis" — bukan "belum diputuskan"). Bedanya penting: yang kedua jauh lebih berbahaya.

**Ringkasan:** desain ini cukup untuk mulai R0, tetapi **belum cukup untuk dikatakan siap produksi**. Celah terbesar bukan pada fitur (lingkup sudah sengaja dipotong), melainkan pada **proses**: bagaimana perubahan skema dan API disebarkan, bagaimana kualitas diukur, dan bagaimana pengguna berpindah dari alat lama. Tiga hal itu tidak punya pemilik di dokumen mana pun saat ini.

---

## 1. Celah yang paling berbahaya (harus ditutup sebelum kode pertama)

### C1 — Skema database belum punya aturan perubahan (migrasi, seed, rollback)

**Yang ada:** `NFR-012` (migrasi maju saja, expand/contract, tidak mengunci tabel > 5 s) — satu baris SLO.
**Yang tidak ada:** strategi migrasi, konvensi penamaan/penomoran migration, data seed (status default per tim, label awal), mekanisme backfill untuk kolom baru, dan **cara menguji migrasi** pada dataset realistis.

**Dampak:** tim 4 orang tanpa aturan migrasi akan menghasilkan migrasi yang tidak bisa dijalankan pada instalasi yang sudah berisi data — kegagalan yang khas pada produk self-host, dan penyebab nomor satu pengguna menolak upgrade. Ini **lebih mahal** daripada bug fitur mana pun, karena ia membekukan rilis.

**Kapan murah:** sekarang (menulis dokumen), sebelum ada satu migration.

**Status:** **belum diputuskan**. Perlu `docs/migrations.md`.

### C2 — Kontrak API belum ditulis

**Yang ada:** `FR-209` (API publik REST + webhook), `FR-114` (ekspor), dan ADR-015 (idempotensi/versi/konflik).
**Yang tidak ada:** bentuk konkret kontrak — konvensi error (kode, bentuk body, trace ID), bentuk paginasi (cursor), penamaan field, kebijakan versi API (`/v1`), batas rate limit per endpoint, bentuk patch (JSON Merge Patch vs daftar operasi), dan contoh request/response.

**Dampak:** tanpa ini, setiap endpoint akan punya bentuk error yang berbeda, dan API publik R1 akan menjadi kumpulan ketidakkonsistenan yang tidak bisa diperbaiki tanpa breaking change. Ini juga yang membuat integrasi pihak ketiga mahal.

**Kapan murah:** sebelum endpoint pertama ditulis.

**Status:** **belum diputuskan** — hanya prinsipnya (ADR-015). Perlu `docs/api-contract.md`.

### C3 — Tidak ada rencana pengujian yang mengikat

**Yang ada:** 25 test case otorisasi (`rbac.md` §6), gate CI yang disebut di beberapa ADR, aturan "endpoint baru wajib ikut TC-14".
**Yang tidak ada:** piramida pengujian, target cakupan per lapisan, cara menguji konkurensi (yang justru inti ADR-015), cara menguji real-time (dua klien), cara menguji migrasi, uji chaos jaringan untuk optimistic UI, dan keputusan tentang environment uji (apakah ada staging? siapa yang menjalankannya?).

**Dampak:** klaim "sistem ini benar" tidak bisa dibuktikan. Dan bug yang paling mahal di arsitektur ini (konflik tulis, delta hilang, izin bocor) **hanya** muncul pada uji konkurensi dan gagal-jaringan — bukan pada uji unit.

**Kapan murah:** sebelum R0 berjalan setengah.

**Status:** **belum diputuskan**. Perlu `docs/testing-strategy.md`. Ini celah yang paling sering saya sesalkan di proyek nyata.

---

## 2. Celah arsitektural (keputusan belum diambil)

### C4 — Strategi email keluar tidak ada

**Yang ada:** `FR-206` (inbox, email hanya untuk mention/penugasan).
**Yang tidak ada:** provider SMTP, konfigurasi self-host, masalah deliverability (SPF/DKIM/DMARC), penanganan bounce, batas kirim, template email, dan mode "tanpa email sama sekali" untuk instalasi internal.

**Dampak:** email adalah satu-satunya jalur notifikasi ke luar aplikasi. Instalasi self-host yang emailnya masuk spam akan membuat pengguna mengira produknya rusak. Ini masalah operasional nomor dua setelah backup.

**Status:** **belum diputuskan**. Perlu ADR + bagian deployment.

### C5 — Tidak ada strategi gambar/lampiran sisi klien

**Yang ada:** ADR-009 (presigned URL, batas 100 MB), batas 50 lampiran/task.
**Yang tidak ada:** kompresi gambar di klien, thumbnail (kalau tidak ada, board akan memuat file 8 MB per kartu), unggahan berlanjut (resumable) untuk file besar di jaringan buruk, dan penanganan unggahan ganda.

**Dampak:** satu screenshot 8 MB × 20 kartu = board yang tidak bisa dipakai. Ini bertabrakan langsung dengan janji kecepatan (`NFR-003`), dan akan ditemukan pada hari pertama pilot.

**Status:** **belum diputuskan**. Perlu ADR kecil.

### C6 — Editor teks: belum dipilih, padahal ini keputusan besar

**Yang ada:** "Markdown terbatas" untuk deskripsi & komentar; ADR-015 butir 4 soal konflik editor.
**Yang tidak ada:** apakah pengguna mengetik Markdown mentah, atau WYSIWYG? Pilihan ini menentukan: model konflik (teks polos vs struktur dokumen), cara menyimpan (teks vs JSON), cara mengimpor ADF, dan biaya keseluruhan.

**Dampak:** memilih WYSIWYG setelah 6 bulan berarti migrasi data dan penulisan ulang editor. Memilih markdown mentah berarti pengguna non-IT (persona P3) menolak produk — dan P3 adalah justru pembeda produk ini.

**Status:** **belum diputuskan**, dan ini salah satu yang paling menentukan. Rekomendasi saya: markdown dengan toolbar (bukan WYSIWYG penuh) pada R0, lalu evaluasi. Perlu ADR.

### C7 — Definisi "sereal-time" per objek belum lengkap

**Yang ada:** ADR-006 (`changes` dengan `seq` per workspace), delta minimal.
**Yang tidak ada:** daftar entitas yang disiarkan (apakah `statuses`, `labels`, `teams` juga?), perilaku saat admin mengubah pengaturan tim (apakah semua klien harus reload?), dan cara klien menangani perubahan **struktur** (status dihapus saat kartu sedang ditampilkan).

**Status:** **belum diputuskan**. Perlu tabel "objek yang disiarkan" di ADR-006.

### C8 — Pencarian: hasil belum didefinisikan secara perilaku

**Yang ada:** ADR-005/ADR-019 (mesin, batas, scope).
**Yang tidak ada:** apa yang dicari (judul saja? deskripsi? komentar? nama orang?), peringkat/bobot, perilaku untuk query kosong, dan apakah hasil pencarian menghormati toggle fitur yang mati.

**Dampak:** command palette (`Ctrl+K`) adalah fitur yang paling terasa. Hasil yang buruk = produk terasa lambat berpikir, walaupun latensinya memenuhi SLO.

**Status:** sebagian diputuskan (ADR-005 §3 menyebut cakupan & bobot), belum ada spesifikasi perilaku.

---

## 3. Celah proses & organisasi (tidak teknis, tapi lebih sering mematikan proyek)

### C9 — Tidak ada kebijakan dependency & supply chain

**Yang ada:** ADR-014 (pemeriksaan kompatibilitas lisensi di CI).
**Yang tidak ada:** kebijakan menambah dependensi (siapa menyetujui, kriteria), jadwal pembaruan keamanan, cara menangani CVE, proses merilis patch keamanan untuk versi lama self-host (backport), dan SBOM.

**Dampak:** produk self-host yang tidak bisa merilis patch keamanan cepat akan ditinggalkan — bukan karena fiturnya kurang, tapi karena sysadmin tidak boleh menjalankan perangkat lunak yang tidak ditambal. Ini juga melemahkan seluruh klaim enterprise.

**Status:** **belum diputuskan**. Perlu `docs/security-policy.md`.

### C10 — Tidak ada dukungan & jalur eskalasi

**Yang ada:** T1–T3 di `decisions-r0.md`.
**Yang tidak ada:** di mana pengguna melaporkan bug, SLA respons (bahkan untuk pilot), cara mengumpulkan diagnostik tanpa membocorkan data (bundle log yang disanitasi), dan siapa yang menjawab pada minggu pertama.

**Dampak:** 5 pilot tanpa jalur dukungan akan berhenti memakai produk dan tidak memberi tahu alasannya.

**Status:** **belum diputuskan**.

### C11 — Onboarding & data awal belum dirancang

**Yang ada:** `FR-107` (template tim).
**Yang tidak ada:** apa yang dilihat pengguna pada menit pertama (empty state), apakah ada contoh data, bagaimana mengundang tim pertama, dan apa yang terjadi bila workspace kosong sepenuhnya.

**Dampak:** empty state adalah tempat produk mati. Ini murah dirancang sekarang, mahal diperbaiki setelah 100 pengguna.

**Status:** **belum diputuskan** (desain UX, bukan arsitektur).

### C12 — i18n: diputuskan setengah

**Yang ada:** `locale` dan `timezone` pada `users`, default `id-ID`.
**Yang tidak ada:** apakah UI benar-benar multibahasa (dan siapa menerjemahkan), format tanggal/angka per lokal, dan apakah istilah produk (Goal, Cycle) diterjemahkan.

**Dampak:** setengah-setengah lebih buruk daripada satu bahasa dengan jujur. Menambah i18n setelah 50 komponen berarti menyentuh semuanya.

**Status:** **belum diputuskan**. Rekomendasi: satu bahasa (Indonesia) untuk R0, dengan string terpusat sejak awal agar i18n murah ditambahkan nanti.

---

## 4. Celah domain yang sengaja ditunda (bukan lupa)

Ini bukan kelalaian. Dicatat agar tidak ada yang mengira dokumen ini tidak menyadarinya.

| Celah | Kenapa ditunda | Risiko bila tetap ditunda terlalu lama |
| :--- | :--- | :--- |
| Time tracking & billing (`FR-309`) | Persona sekunder (NG-06) | Kehilangan segmen agensi; model data `time_entries` sudah disiapkan sehingga biaya menambahkannya rendah. |
| Release management (`FR-311`) | Belum ada permintaan nyata | Tim software akan memakai label `ver:` sebagai jalan pintas — cukup sampai R2. |
| Kapasitas per Cycle (`FR-310`) | Butuh data velocity nyata dulu | Manajer tidak bisa merencanakan beban; ini fitur yang diminta *setelah* ada data, bukan sebelum. |
| Automation builder (NG-03) | Sumber kerumitan Jira | Tim akan meminta otomatisasi; jawaban kita di R0–R1 adalah "belum", dan itu harus disampaikan jelas di materi, bukan disembunyikan. |
| Mobile native (NG-08) | Biaya dua codebase | PWA wajib (`FR-110`) menjadi satu-satunya jalan; kalau PWA gagal, NG-08 harus dibuka. |
| Offline penuh (NG-09) | ADR-001 | Pengguna lapangan akan meminta; jawaban resmi: baca-saja dari cache, bukan antrean tulis. |

---

## 5. Hal yang **sudah** tertutup dan tidak perlu dikhawatirkan lagi

Agar penilaian ini seimbang — ini yang biasanya paling sering hilang pada desain produk sejenis:

- Konsistensi tulis & konflik (ADR-015) — idempotensi, versi, konflik per-field, aturan khusus editor.
- Riwayat transisi sebagai prasyarat metrik (ADR-004) — tanpa ini, seluruh R2 tidak mungkin.
- Isolasi tenant dua lapis + test otomatis per endpoint (ADR-003/ADR-012, TC-14).
- Batas payload `NOTIFY` yang **sudah diukur**, bukan diasumsikan (ADR-017).
- Batas pencarian yang dinyatakan terbuka (ADR-019).
- Model ancaman termasuk cache klien (T1–T10).
- Kontrak importer dengan taksonomi kegagalan (L1–L5) dan kolom skema yang sudah dipastikan cukup sebelum migration.
- Definisi metrik (velocity vs throughput, snapshot scope) — biasanya ini ditulis setelah angkanya salah.
- Non-goals yang mengikat, gate berbasis bukti, dan backup yang wajib diuji (bukan sekadar dikonfigurasi).

---

## 6. Urutan penutupan celah (rekomendasi saya)

Berdasarkan "biaya bila ditemukan terlambat" ÷ "biaya menutup sekarang":

| Urutan | Celah | Kapan | Kenapa di urutan ini |
| :---: | :--- | :--- | :--- |
| **1** | **C3** (strategi pengujian) | sebelum R0 menulis endpoint | Bug termahal di arsitektur ini hanya muncul pada uji konkurensi & gagal-jaringan. Menulis uji ini belakangan = menulis ulang. |
| **2** | **C2** (kontrak API) | sebelum endpoint pertama | Bentuk error & paginasi yang tidak konsisten tidak bisa diperbaiki tanpa breaking change. |
| **3** | **C1** (aturan migrasi) | sebelum migration pertama | Menentukan apakah produk ini bisa di-upgrade sama sekali. |
| **4** | **C6** (editor) | sebelum menulis UI task | Menentukan model data deskripsi dan seluruh pengalaman persona P3. |
| **5** | **C4** (email) | sebelum pilot T2 | Pilot tanpa email = pengguna tidak tahu ada penugasan. |
| **6** | **C5** (gambar) | sebelum pilot T2 | Langsung terlihat dan merusak janji kecepatan. |
| **7** | **C9** (keamanan/supply chain) | sebelum rilis publik T3 | Syarat agar sysadmin mau menjalankannya. |
| **8** | **C10, C11, C12** | sebelum T2 | Murah sekarang, mahal setelah ada pengguna. |
| **9** | **C7, C8** | selama R0 | Perlu diselesaikan bersamaan dengan implementasi real-time & pencarian. |

**Rekomendasi tegas:** jangan mulai menulis kode sebelum **1, 2, 3, 4** selesai sebagai dokumen. Empat dokumen itu (masing-masing 2–4 halaman) menentukan bentuk kode yang akan bertahan bertahun-tahun. Sisanya bisa berjalan paralel dengan implementasi.

---

## 7. Satu hal yang tidak bisa ditutup dengan dokumen

Semua celah di atas bisa saya tutup dengan menulis dokumen. Satu hal tidak: **apakah ada orang di luar tim ini yang benar-benar akan memakai Kelindan.** Itu hanya bisa dijawab dengan 5 pilot (T2 di `decisions-r0.md`). Desain yang sempurna untuk pengguna yang tidak ada tetap gagal — dan sebaliknya, desain yang cukup baik dengan 5 pengguna nyata akan membaik dengan sendirinya.

Karena itu, dari 12 celah di atas, **tidak satu pun** lebih penting daripada menjalankan T1 (dogfood) dan merekrut T2 secepat mungkin.

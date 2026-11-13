# Analisis Celah: Apa yang Masih Kurang dari Desain Ini

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Sifat:** penilaian jujur terhadap pekerjaan sendiri. Dokumen ini tidak menambah fitur; ia menyatakan apa yang **belum ada**, seberapa mahal bila ditemukan terlambat, dan urutan penutupannya.

**Cara membaca.** Setiap celah punya: dampak bila tidak ditutup, kapan paling murah ditutup, dan apakah sudah ada keputusan yang menutupinya (bila ya, celahnya hanya "belum ditulis" — bukan "belum diputuskan"). Bedanya penting: yang kedua jauh lebih berbahaya.

**Ringkasan:** per 2026-11-12, **seluruh 12 celah sudah ditutup.** Dokumen ini tidak lagi menjadi daftar tugas; ia menjadi **catatan riwayat keputusan** — apa yang pernah kurang, bagaimana ditutup, dan apa yang secara sadar tetap terbuka.

| Celah | Ditutup oleh | Jenis |
| :--- | :--- | :--- |
| C1 migrasi | `migrations.md` | Dokumen keputusan |
| C2 kontrak API | `api-contract.md` | Dokumen keputusan |
| C3 strategi pengujian | `testing-strategy.md` | Dokumen keputusan |
| C4 email | `email.md` + ADR-021 | Dokumen keputusan |
| C5 media/lampiran | `attachments-media.md` + ADR-022 | Dokumen keputusan |
| C6 editor | `editor-decision.md` | Dokumen keputusan |
| C7 real-time per objek | `realtime-and-search.md` §1–§5 | Spesifikasi perilaku |
| C8 perilaku pencarian | `realtime-and-search.md` §6–§10 | Spesifikasi perilaku |
| C9 keamanan & supply chain | `security-policy.md` | Dokumen keputusan |
| C10 jalur dukungan | `support.md` | Dokumen operasional |
| C11 onboarding | `onboarding.md` | Spesifikasi perilaku |
| C12 i18n | `i18n.md` | Dokumen keputusan |

**Yang tetap terbuka, dan mengapa itu benar:** satu hal tidak bisa ditutup dokumen mana pun — **apakah ada orang di luar tim ini yang akan memakai Kelindan** (§7), dan **spike importer S1/S4** yang butuh berkas Jira nyata (`spike-jira-importer.md`). Keduanya bukan kelalaian dokumen; keduanya butuh data atau orang dari dunia nyata.

---

## 1. Celah yang paling berbahaya (harus ditutup sebelum kode pertama)

### ~~C1 — Skema database belum punya aturan perubahan~~ → **DITUTUP** oleh `migrations.md`

**Yang ada:** `NFR-012` (migrasi maju saja, expand/contract, tidak mengunci tabel > 5 s) — satu baris SLO.
**Yang tidak ada:** strategi migrasi, konvensi penamaan/penomoran migration, data seed (status default per tim, label awal), mekanisme backfill untuk kolom baru, dan **cara menguji migrasi** pada dataset realistis.

**Dampak:** tim 4 orang tanpa aturan migrasi akan menghasilkan migrasi yang tidak bisa dijalankan pada instalasi yang sudah berisi data — kegagalan yang khas pada produk self-host, dan penyebab nomor satu pengguna menolak upgrade. Ini **lebih mahal** daripada bug fitur mana pun, karena ia membekukan rilis.

**Kapan murah:** sekarang (menulis dokumen), sebelum ada satu migration.

**Status:** **SELESAI** — `migrations.md` v1.0: forward-only, expand/contract 3 rilis, header wajib + checksum, larangan operasi berbahaya + penggantinya, seed lewat katalog aplikasi (bukan migrasi), runner dengan preflight/dry-run, jalur upgrade self-host, dan T-MIG1…T-MIG10.

### ~~C2 — Kontrak API belum ditulis~~ → **DITUTUP** oleh `api-contract.md`

**Yang ada:** `FR-209` (API publik REST + webhook), `FR-114` (ekspor), dan ADR-015 (idempotensi/versi/konflik).
**Yang tidak ada:** bentuk konkret kontrak — konvensi error (kode, bentuk body, trace ID), bentuk paginasi (cursor), penamaan field, kebijakan versi API (`/v1`), batas rate limit per endpoint, bentuk patch (JSON Merge Patch vs daftar operasi), dan contoh request/response.

**Dampak:** tanpa ini, setiap endpoint akan punya bentuk error yang berbeda, dan API publik R1 akan menjadi kumpulan ketidakkonsistenan yang tidak bisa diperbaiki tanpa breaking change. Ini juga yang membuat integrasi pihak ketiga mahal.

**Kapan murah:** sebelum endpoint pertama ditulis.

**Status:** **SELESAI** — `docs/api-contract.md` v1.0 (bentuk respons, RFC 9457 + enum `code` tertutup, 404 vs 403, patch field-level, idempotensi wajib, paginasi cursor, dua bentuk field, real-time, lampiran 2 langkah, deprecation).

### ~~C3 — Tidak ada rencana pengujian yang mengikat~~ → **DITUTUP** oleh `testing-strategy.md`

**Yang ada:** 25 test case otorisasi (`rbac.md` §6), gate CI yang disebut di beberapa ADR, aturan "endpoint baru wajib ikut TC-14".
**Yang tidak ada:** piramida pengujian, target cakupan per lapisan, cara menguji konkurensi (yang justru inti ADR-015), cara menguji real-time (dua klien), cara menguji migrasi, uji chaos jaringan untuk optimistic UI, dan keputusan tentang environment uji (apakah ada staging? siapa yang menjalankannya?).

**Dampak:** klaim "sistem ini benar" tidak bisa dibuktikan. Dan bug yang paling mahal di arsitektur ini (konflik tulis, delta hilang, izin bocor) **hanya** muncul pada uji konkurensi dan gagal-jaringan — bukan pada uji unit.

**Kapan murah:** sebelum R0 berjalan setengah.

**Status:** **SELESAI** — `docs/testing-strategy.md` v1.0 (4 lapisan, L2 wajib memakai pooler transaction mode, uji wajib `T-SCHEMA`…`T-CHAOS`, uji performa dengan gerbang regresi 20%, gerbang rilis 7 butir, dan §9 yang menyatakan apa yang **tidak** dibuktikan).

---

## 2. Celah arsitektural (keputusan belum diambil)

### ~~C4 — Strategi email keluar tidak ada~~ → **DITUTUP** oleh `email.md`

**Yang ada:** `FR-206` (inbox, email hanya untuk mention/penugasan).
**Yang tidak ada:** provider SMTP, konfigurasi self-host, masalah deliverability (SPF/DKIM/DMARC), penanganan bounce, batas kirim, template email, dan mode "tanpa email sama sekali" untuk instalasi internal.

**Dampak:** email adalah satu-satunya jalur notifikasi ke luar aplikasi. Instalasi self-host yang emailnya masuk spam akan membuat pengguna mengira produknya rusak. Ini masalah operasional nomor dua setelah backup.

**Status:** **SELESAI** — `email.md` v1.0 + ADR-021 (tiga mode transport, preflight dengan penolakan keras `From` domain publik, batas kirim & digest, tidak ada lampiran email, tabel `email_messages`/`email_suppressions`, `T-EMAIL1…T-EMAIL11`).

### ~~C5 — Tidak ada strategi gambar/lampiran sisi klien~~ → **DITUTUP** oleh `attachments-media.md`

**Yang ada:** ADR-009 (presigned URL, batas 100 MB), batas 50 lampiran/task.
**Yang tidak ada:** kompresi gambar di klien, thumbnail (kalau tidak ada, board akan memuat file 8 MB per kartu), unggahan berlanjut (resumable) untuk file besar di jaringan buruk, dan penanganan unggahan ganda.

**Dampak:** satu screenshot 8 MB × 20 kartu = board yang tidak bisa dipakai. Ini bertabrakan langsung dengan janji kecepatan (`NFR-003`), dan akan ditemukan pada hari pertama pilot.

**Status:** **SELESAI** — `attachments-media.md` v1.0 + ADR-022 (tiga representasi, kompresi & thumbnail di klien, EXIF/GPS dihapus, HEIC→WebP, SVG tidak inline, domain storage terpisah, `complete` diverifikasi server, `T-MEDIA1…T-MEDIA12`).

### ~~C6 — Editor teks: belum dipilih~~ → **DITUTUP** oleh `editor-decision.md`

**Yang ada:** "Markdown terbatas" untuk deskripsi & komentar; ADR-015 butir 4 soal konflik editor.
**Yang tidak ada:** apakah pengguna mengetik Markdown mentah, atau WYSIWYG? Pilihan ini menentukan: model konflik (teks polos vs struktur dokumen), cara menyimpan (teks vs JSON), cara mengimpor ADF, dan biaya keseluruhan.

**Dampak:** memilih WYSIWYG setelah 6 bulan berarti migrasi data dan penulisan ulang editor. Memilih markdown mentah berarti pengguna non-IT (persona P3) menolak produk — dan P3 adalah justru pembeda produk ini.

**Status:** **SELESAI** — `editor-decision.md` v1.0: **Markdown subset + editor visual terbatas** (bukan WYSIWYG penuh, bukan Markdown mentah), `body_format` untuk migrasi format, larangan HTML mentah, konflik eksplisit tanpa merge otomatis, batas keras, `T-EDIT1…T-EDIT8`, dan triger terukur untuk pindah ke WYSIWYG.

### ~~C7 — Definisi real-time per objek belum lengkap~~ → **DITUTUP** oleh `realtime-and-search.md` §1–§5

**Yang ada:** ADR-006 (`changes` dengan `seq` per workspace), delta minimal.
**Yang tidak ada:** daftar entitas yang disiarkan (apakah `statuses`, `labels`, `teams` juga?), perilaku saat admin mengubah pengaturan tim (apakah semua klien harus reload?), dan cara klien menangani perubahan **struktur** (status dihapus saat kartu sedang ditampilkan).

**Status:** **SELESAI** — klasifikasi K1/K2/K3, matriks penyiaran per perubahan, 9 tepi kasus (status diarsipkan, akses dicabut, field terkunci lokal, delta menumpuk), notifikasi ≠ real-time, `T-RT8…T-RT12`.

### ~~C8 — Pencarian: hasil belum didefinisikan secara perilaku~~ → **DITUTUP** oleh `realtime-and-search.md` §6–§10

**Yang ada:** ADR-005/ADR-019 (mesin, batas, scope).
**Yang tidak ada:** apa yang dicari (judul saja? deskripsi? komentar? nama orang?), peringkat/bobot, perilaku untuk query kosong, dan apakah hasil pencarian menghormati toggle fitur yang mati.

**Dampak:** command palette (`Ctrl+K`) adalah fitur yang paling terasa. Hasil yang buruk = produk terasa lambat berpikir, walaupun latensinya memenuhi SLO.

**Status:** **SELESAI** — bobot sumber, perilaku query (nomor task, query kosong, stopword, salah ketik), interaksi dengan toggle & izin, urutan hasil palette, `T-SEARCH1…T-SEARCH8`.

---

## 3. Celah proses & organisasi (tidak teknis, tapi lebih sering mematikan proyek)

### ~~C9 — Tidak ada kebijakan dependency & supply chain~~ → **DITUTUP** oleh `security-policy.md`

**Yang ada:** ADR-014 (pemeriksaan kompatibilitas lisensi di CI).
**Yang tidak ada:** kebijakan menambah dependensi (siapa menyetujui, kriteria), jadwal pembaruan keamanan, cara menangani CVE, proses merilis patch keamanan untuk versi lama self-host (backport), dan SBOM.

**Dampak:** produk self-host yang tidak bisa merilis patch keamanan cepat akan ditinggalkan — bukan karena fiturnya kurang, tapi karena sysadmin tidak boleh menjalankan perangkat lunak yang tidak ditambal. Ini juga melemahkan seluruh klaim enterprise.

**Status:** **SELESAI** — versi didukung, SLA respons per tingkat (24 jam untuk kritis), alur kerentanan, gerbang dependensi, SBOM/tanda tangan image, rincian CSP, rencana insiden, dan pernyataan tegas **tanpa** klaim sertifikasi.

### ~~C10 — Tidak ada dukungan & jalur eskalasi~~ → **DITUTUP** oleh `support.md`

**Yang ada:** T1–T3 di `decisions-r0.md`.
**Yang tidak ada:** di mana pengguna melaporkan bug, SLA respons (bahkan untuk pilot), cara mengumpulkan diagnostik tanpa membocorkan data (bundle log yang disanitasi), dan siapa yang menjawab pada minggu pertama.

**Dampak:** 5 pilot tanpa jalur dukungan akan berhenti memakai produk dan tidak memberi tahu alasannya.

**Status:** **SELESAI** — kanal per audiens dengan janji respons (pilot 4 jam hari kerja), 5 kategori triase, bundle diagnostik satu klik yang **aman dibagikan publik** dengan pratinjau, larangan remote access, batas dukungan yang dinyatakan sebelum pilot, `T-SUP1…T-SUP5`.

### ~~C11 — Onboarding & data awal belum dirancang~~ → **DITUTUP** oleh `onboarding.md`

**Yang ada:** `FR-107` (template tim).
**Yang tidak ada:** apa yang dilihat pengguna pada menit pertama (empty state), apakah ada contoh data, bagaimana mengundang tim pertama, dan apa yang terjadi bila workspace kosong sepenuhnya.

**Dampak:** empty state adalah tempat produk mati. Ini murah dirancang sekarang, mahal diperbaiki setelah 100 pengguna.

**Status:** **SELESAI** — 4 jenis pengguna pertama, alur instalasi tanpa akun default, naskah empty state untuk 10 layar, pratinjau impor wajib, checklist admin maks 3 item, aturan nada penulisan, dan ukuran keberhasilan (task pertama < 60 detik).

### ~~C12 — i18n: diputuskan setengah~~ → **DITUTUP** oleh `i18n.md`

**Yang ada:** `locale` dan `timezone` pada `users`, default `id-ID`.
**Yang tidak ada:** apakah UI benar-benar multibahasa (dan siapa menerjemahkan), format tanggal/angka per lokal, dan apakah istilah produk (Goal, Cycle) diterjemahkan.

**Dampak:** setengah-setengah lebih buruk daripada satu bahasa dengan jujur. Menambah i18n setelah 50 komponen berarti menyentuh semuanya.

**Status:** **SELESAI** — satu bahasa di R0 (id-ID) tetapi **semuanya terpusat**: tidak ada string tampilan di komponen (`T-I18N1`), kunci berbasis makna, kamus per-rute (menjaga `UX-B1`), aturan format tanggal/angka/zona waktu, glosarium sebagai kontrak terjemahan, triger terukur untuk bahasa kedua, dan aturan "terjemahan parsial lebih buruk daripada tidak ada".

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
| ~~**1**~~ | ~~**C3** (strategi pengujian)~~ **SELESAI** | — | `testing-strategy.md` |
| ~~**2**~~ | ~~**C2** (kontrak API)~~ **SELESAI** | — | `api-contract.md` |
| ~~**3**~~ | ~~**C1** (aturan migrasi)~~ **SELESAI** | — | `migrations.md` |
| ~~**4**~~ | ~~**C6** (editor)~~ **SELESAI** | — | `editor-decision.md` |
| ~~**5**~~ | ~~**C4** (email)~~ **SELESAI** | — | `email.md` |
| ~~**6**~~ | ~~**C5** (gambar)~~ **SELESAI** | — | `attachments-media.md` |
| ~~**7**~~ | ~~**C9** (keamanan/supply chain)~~ **SELESAI** | — | `security-policy.md` |
| ~~**8**~~ | ~~**C10, C12**~~ **SELESAI** | — | `support.md`, `i18n.md` |
| ~~**9**~~ | ~~**C7, C8**~~ **SELESAI** | — | `realtime-and-search.md` |

**Status gerbang:** tidak ada lagi dokumen yang memblokir penulisan kode. Empat dokumen pemblokir sudah selesai dan saling merujuk. Yang tersisa: **C10** (dukungan) dan **C12** (i18n), dengan tenggat mengikuti T2/T3 di `decisions-r0.md`.

---

## 6.1 Celah yang ditutup karena tujuan produk "ramah, mudah, ringan"

Tujuan itu sebelumnya hanya kalimat. Sekarang punya hakim: `ux-principles.md`.

| Yang dulu tidak ada | Sekarang |
| :--- | :--- |
| Angka untuk "ringan" | `UX-B1…UX-B10` (bundle < 300 KB, interaksi p95 < 100 ms, memori tab < 250 MB, ≤ 3 permintaan saat buka board) — **memblokir merge** |
| Definisi "mudah" | `UX-B8` (buat task ≤ 2 interaksi) + sesi uji pengguna per rilis: **≥ 4 dari 5 tugas tanpa bantuan** oleh persona HR |
| Daftar elemen wajib | `UX-E1…UX-E10` (undo, indikator sinkronisasi, empty state, palette) |
| Anti-pola | 10 larangan eksplisit (modal untuk form panjang, toast untuk error penting, warna saja, tombol disembunyikan karena 403) |
| Konflik pintasan | Tabel kanonik; `Ctrl+K` selalu command palette, `Ctrl+Shift+K` untuk tautan |

## 7. Satu hal yang tidak bisa ditutup dengan dokumen

Semua celah di atas bisa saya tutup dengan menulis dokumen. Satu hal tidak: **apakah ada orang di luar tim ini yang benar-benar akan memakai Kelindan.** Itu hanya bisa dijawab dengan 5 pilot (T2 di `decisions-r0.md`). Desain yang sempurna untuk pengguna yang tidak ada tetap gagal — dan sebaliknya, desain yang cukup baik dengan 5 pengguna nyata akan membaik dengan sendirinya.

Karena itu, dari 12 celah di atas, **tidak satu pun** lebih penting daripada menjalankan T1 (dogfood) dan merekrut T2 secepat mungkin.

# PRD: Kelindan — Manajemen Kerja untuk Tim Campuran, Skala Enterprise

**Versi:** 1.0
**Tanggal:** 2026-11-12
**Pemilik:** btx-core
**Status:** Aktif — disetujui untuk dijadikan dasar eksekusi
**Menggantikan:** cetak biru v0 "Next-Jira" (lihat `prd-review.md` untuk kritik yang mendasarinya)

---

## 1. Ringkasan Produk

**Satu kalimat.** Kelindan adalah alat manajemen kerja open-source yang dipakai bersama oleh tim Engineering dan tim non-Engineering dalam satu workspace — cepat seperti Linear, cukup aman dan lengkap untuk perusahaan 1.000+ karyawan, dan bisa di-host sendiri dengan tiga container.

**Masalah yang diselesaikan.** Perusahaan besar menghadapi dilema: Jira cukup kuat untuk Engineering dan cukup patuh untuk IT, tapi terlalu rumit untuk HR/Marketing/Legal dan terlalu lambat untuk dipakai harian. Akibatnya perusahaan membeli dua alat (Jira + Trello/Notion/Asana), lalu kehilangan visibilitas lintas divisi. Kelindan menghapus dilema itu dengan satu model data yang sama, di mana kerumitan **dinyalakan per tim**, bukan dipaksakan ke semua orang.

**Posisi bersaing.**

| | Jira | Linear | Plane | **Kelindan** |
| :--- | :--- | :--- | :--- | :--- |
| Kuat untuk Engineering | Ya | Ya | Ya | Ya |
| Ramah tim non-IT | Tidak | Kurang | Sedang | **Ya (target utama)** |
| Self-host, tanpa vendor | Tidak | Tidak | Ya | **Ya** |
| Deployment ringan (3 container) | — | — | Sulit | **Ya** |
| Impor data Jira yang jujur | — | Terbatas | Ya | **Ya (dengan laporan kegagalan)** |

**Yang tidak diklaim.** Kelindan tidak menargetkan paritas fitur Jira. Kelindan tidak menargetkan portofolio/OKR tingkat perusahaan. Kelindan tidak menargetkan menjadi lebih cepat dari Linear pada dataset Linear. Klaim yang dipakai hanya yang bisa diuji: SLO di §7.

---

## 2. Pengguna

Setiap persona punya konsekuensi desain eksplisit. Persona tanpa konsekuensi desain dihapus dari dokumen ini.

### P1 — Rina, Engineer (pengguna harian, paling menuntut soal kecepatan)
- **Kontek:** 20–60 task aktif, hidup di keyboard, membenci mouse.
- **Butuh:** ubah status/assignee tanpa membuka detail; cari task apapun < 1 detik; notifikasi tidak menenggelamkan.
- **Konsekuensi desain:** `FR-101` (inline edit), `FR-103` (command palette), `NFR-003` (interaksi < 100 ms p95), `FR-108` (inbox, bukan email).
- **Yang membuat ia berhenti memakai:** satu spinner saat drag kartu. Ini kriteria gagal, bukan preferensi.

### P2 — Dimas, Engineering Manager
- **Kontek:** 3 tim, 45 orang, melapor ke VP tiap bulan.
- **Butuh:** lihat 300 task tanpa scroll tak berujung; tahu apa yang tertahan dan oleh siapa; angka yang bisa dipertanggungjawabkan di rapat.
- **Konsekuensi desain:** `FR-104` (list view padat + virtualisasi), `FR-203` (blokir/terblokir), `FR-302` (cycle time), **definisi metrik di §8 (wajib, bukan opsional)** — tanpa definisi, angkanya tidak dipakai.

### P3 — Sari, People Ops / HR
- **Kontek:** bukan orang teknis; kata "sprint" dan "story point" membuatnya tidak membuka alat.
- **Butuh:** membuat permintaan (onboarding karyawan, permintaan cuti alat), melihat antrean, tahu siapa yang mengerjakan.
- **Konsekuensi desain:** `FR-105` (toggle: tanpa Cycle, tanpa Effort), `FR-106` (form 3 field), glosarium §9 (tanpa jargon), `FR-107` (template tim HR).

### P4 — Yusuf, IT / Platform Admin
- **Kontek:** 2.000 akun, audit ISO, SSO wajib, tidak mau tool yang butuh 3 engineer untuk dirawat.
- **Butuh:** SSO + SCIM, audit log, backup/restore yang teruji, upgrade tanpa downtime data loss.
- **Konsekuensi desain:** `FR-303` (SSO), `FR-304` (SCIM), `FR-305` (audit), `NFR-010`–`NFR-013` (RPO/RTO, upgrade path). **Ia adalah pembeli, bukan pengguna.** Dokumen v0 mengabaikannya; PRD ini tidak.

### P5 — Nadia, Konsultan / Agensi (persona sekunder, memengaruhi prioritas)
- **Butuh:** laporkan jam kerja ke klien; beri akses baca ke klien eksternal tanpa membocorkan workspace lain.
- **Konsekuensi desain:** `FR-306` (guest terbatas), `FR-309` (time tracking — ditunda, lihat NG-06). Guest adalah pemicu ditinjau-ulangnya ADR-012 (RLS).

---

## 3. Prinsip Produk

Dipakai untuk memutuskan hal yang tidak tercakup spesifikasi. Bila dua prinsip bertabrakan, yang nomor lebih kecil menang.

1. **Kecepatan adalah fitur, bukan polish.** Interaksi yang menyentuh task tidak boleh menunggu jaringan. Ini mengikat arsitektur (ADR-001), bukan hanya frontend.
2. **Satu model data, banyak tingkat kerumitan.** Kerumitan dinyalakan per tim lewat toggle (ADR-007). Tidak ada dua produk terpisah.
3. **Default kosong lebih baik daripada default lengkap.** Layar baru harus berguna tanpa konfigurasi; setiap field yang ditampilkan harus membayar dirinya sendiri.
4. **Setiap angka manajemen harus punya definisi tertulis.** Bila definisi tidak ada, fitur laporan tidak dirilis. (§8)
5. **Kegagalan harus terlihat, bukan disembunyikan.** Sinkronisasi gagal, impor parsial, atau permission ditolak → tampilkan, jangan diam-diam membuang. Berlaku untuk UI maupun API.
6. **Jangan mengunci data pengguna.** Ekspor penuh kapan saja dalam format terbuka, termasuk riwayat.
7. **Kegagalan pemulihan belum terjadi hanya karena belum diuji.** Backup tanpa drill adalah asumsi (D-03).
8. **"Ramah, mudah, ringan" adalah angka, bukan sifat.** Setiap keputusan UI menyebut prinsip (`UX-n`) dan anggaran (`UX-B*`) yang dilayaninya; usulan tanpa itu ditolak (`ux-principles.md`).
9. **Hemat operasional adalah fitur.** Setiap container tambahan adalah biaya yang dibayar sysadmin pelanggan. Tambah komponen hanya bila ada bukti (§7.6).

---

## 4. Non-Goals

Bagian ini sama mengikatnya dengan §6. Setiap item di sini **tidak akan dikerjakan** pada R0–R2, dan sebuah PR yang mengerjakannya ditolak kecuali PRD diubah lebih dulu.

| ID | Non-goal | Alasan | Kapan boleh ditinjau |
| :--- | :--- | :--- | :--- |
| **NG-01** | Paritas fitur Jira | Menargetkan paritas berarti menargetkan kerumitan. Kita menargetkan outcome. | Tidak direncanakan. |
| **NG-02** | Portfolio / OKR tingkat perusahaan (initiative, campaign, objective berlapis 3+) | Ini domain produk berbeda (Workfront, Aha!). Cukup: Goal boleh punya parent Goal maksimal 2 level. | Bila ≥3 pelanggan memintanya dan ada desain hierarki baru. |
| **NG-03** | Workflow engine bebas (state machine yang dikonfigurasi admin tanpa batas) | Sumber utama kerumitan Jira. Kita batasi: 5 kategori tetap + status kustom di dalamnya. | Tidak direncanakan. |
| **NG-04** | Editor dokumen kaya (blok, database, halaman) | Komentar dan deskripsi task butuh editor biasa, bukan Notion. | Tidak direncanakan. |
| **NG-05** | Sub-task multi-level berstatus sendiri | Menciptakan pohon kerja di dalam task. Kita pakai **Checklist** (teks + centang + assignee opsional, tanpa status sendiri). | Bila ada bukti tim butuh pemecahan berstatus; desain baru wajib ADR. |
| **NG-06** | Time tracking & billing pada R0–R1 | Persona sekunder; menambah kompleksitas UI besar untuk pengguna utama. Tetap di rencana R2 sebagai toggle. | Triger: 3 permintaan enterprise atau 1 pelanggan agensi berbayar. |
| **NG-07** | Chat internal / pengganti Slack | Kita berintegrasi, tidak bersaing. | Tidak direncanakan. |
| **NG-08** | Mobile native (iOS/Android) | Biaya pemeliharaan 2 codebase untuk fitur yang 95% bisa dilayani web responsif. | PWA responsif wajib sejak R0 (`FR-110`). Native ditinjau setelah R2. |
| **NG-09** | Offline penuh (bekerja tanpa jaringan, bertahan berhari-hari) | Butuh sync engine + resolusi konflik penuh (ADR-001 menolaknya untuk R0–R1). | Triger terukur di ADR-001 §Revisit. |
| **NG-10** | Multi-region aktif-aktif / geo-partitioning | Satu region + replica terbaca cukup untuk target. | Bila ada pelanggan dengan tuntutan data residency ganda. |
| **NG-11** | Mesin pencari eksternal (Elasticsearch/Meilisearch) pada R0–R1 | Sumber kebenaran kedua + container tambahan, tanpa bukti bottleneck. Postgres cukup (ADR-005). | Triger terukur di ADR-005 §Revisit. |
| **NG-12** | Marketplace / plugin pihak ketiga | Ekosistem butuh fondasi stabil dulu; API publik ada di R1. | Setelah R2. |
| **NG-13** | SSO berbasis SCIM pada R0–R1 | Enterprise-only, tidak memblokir adopsi awal. Wajib di R2 (`FR-304`). | — |
| **NG-14** | Tema/white-label, kustomisasi visual tingkat organisasi | Bukan pembeda; menambah permukaan uji. | Tidak direncanakan. |

### 4.1 Non-goals yang pernah ditinjau dan dicabut

| ID | Dulu non-goal | Dicabut pada | Alasan |
| :--- | :--- | :--- | :--- |
| — | — | — | *(kosong; isi saat ada pencabutan)* |

---

## 5. Lingkup Rilis & Gate Berbasis Bukti

Tanggal diganti **gate berbasis bukti**. Rilis berikutnya tidak dimulai sebelum gate sebelumnya lulus; gate yang tidak lulus berarti lingkup dipotong, bukan tanggal digeser.

| Rilis | Isi | Gate lulus bila | Estimasi (tim 4 orang: 2 FE, 1 BE, 1 design/PM) |
| :--- | :--- | :--- | :--- |
| **R0 — Inti yang terasa cepat** | Auth, workspace, tim, task, board, list, komentar, checklist, riwayat transisi status | **Satu tim nyata (≥5 orang) memakai Kelindan sebagai alat kerja utama selama 14 hari berturut-turut**, tanpa kembali ke alat lama, `NFR-003` terpenuhi di dataset acuan §7.1, **dan satu drill restore penuh lulus** (D-03 di `decisions-r0.md`) | 10–12 minggu |
| **R1 — Perencanaan & pencarian** | Goal, Cycle, dependency, smart filter, custom view, inbox, API publik, integrasi Git | Satu tim menyelesaikan ≥2 cycle penuh dengan auto-rollover tanpa intervensi manual, dan **impor Jira nyata (≥1.000 issue) berhasil dengan laporan kegagalan < 2%** | 10–14 minggu |
| **R2 — Enterprise & skala** | SSO+SAML/OIDC, SCIM, audit log, RBAC guest, timeline, insights, template, impor Jira produksi, time tracking (toggle) | Audit keamanan eksternal lulus tanpa temuan kritis; restore backup teruji < RTO; 1 workspace 2.000 user berjalan 30 hari tanpa insiden P1 | 14–18 minggu |
| **R3 — Skala ekstrem** | Partisi `event_log`, replica terbaca, Helm autoscaling, kapasitas | Uji beban lolos §7.1 dengan p95 sesuai SLO pada 3× dataset acuan | Sesuai kebutuhan |

**Cara membaca estimasi.** Total ~34–44 minggu untuk mencapai R2 dengan tim 4 orang. Bukan 9 bulan untuk "100% paritas Jira". Angka ini adalah hasil pemotongan sadar terhadap lingkup v0, dan sudah memasukkan waktu untuk bug, review, dan dokumentasi (bukan hanya happy path).

**Yang sengaja dipotong dari R0 dibanding v0:** emoji reaction, activity stream lengkap, magic link (R0 pakai email+password dengan verifikasi), MinIO (R0: object storage S3-compatible apa pun, termasuk disk lokal), Redis (R0: Postgres `LISTEN/NOTIFY`), search engine eksternal (R0: Postgres FTS), sub-task berstatus, custom field.

---

## 6. Requirement Fungsional

Format: `ID — pernyataan` lalu **AC** (acceptance criteria yang bisa diuji) dan **Konsekuensi data/otorisasi** (ID dari dokumen lain).

### 6.1 R0 — Inti

**FR-101 — Inline editing tanpa membuka halaman.**
Mengubah judul, assignee, prioritas, tanggal jatuh tempo, dan effort dapat dilakukan langsung dari Board dan List.
- AC: perubahan terlihat di UI < 100 ms p95 tanpa indikator loading; persist ke server < 2 s p95; jika gagal, nilai kembali ke semula **dan** muncul notifikasi kegagalan yang bisa di-retry.
- Konsekuensi: `AC-07`, `INV-04`, ADR-015 (konflik per-field).

**FR-102 — Board drag-and-drop dengan status kustom.**
Memindahkan kartu antar kolom mengubah status; kolom mengikuti status tim, bukan daftar tetap.
- AC: kartu berpindah instan; kolom kosong tetap terlihat (agar terbaca "ini antrean, bukan hilang"); drag lintas kategori (mis. `In Progress` → `Canceled`) meminta konfirmasi bila task punya sub-progress.
- Konsekuensi: `ENT-07` (status), ADR-015.

**FR-103 — Command palette (`Ctrl/Cmd+K`).**
Membuat task, berpindah tim, mencari task, mengubah status, membuka view tersimpan.
- AC: hasil pencarian task muncul < 300 ms p95 untuk dataset §7.1; item yang baru dibuat langsung dapat ditemukan (konsistensi baca-setelah-tulis, lihat ADR-005).
- Konsekuensi: ADR-005 (konsistensi pencarian).

**FR-104 — List view padat dengan virtualisasi.**
Tabel baris rapat, dikelompokkan per status, mendukung 10.000 baris dalam satu view tanpa membekukan browser.
- AC: scroll pada 10.000 task mempertahankan ≥ 50 fps; waktu render awal < 1 s; filter diterapkan < 200 ms di klien.
- Konsekuensi: paginasi berbasis cursor (`INV-11`), bukan `OFFSET`.

**FR-105 — Toggle fitur per tim.**
Saklar per tim: Cycles, Goals, Effort, Timeline, Time Tracking, Releases, Capacity.
- AC: mematikan toggle menyembunyikan UI **tanpa menghapus data**; menyalakan kembali memulihkan data apa adanya; task yang punya nilai pada fitur yang dimatikan tetap menyimpan nilai itu (dan ditampilkan sebagai read-only pada detail).
- Konsekuensi: `ENT-04` (kolom `feat_*`), `INV-10`, ADR-007.

**FR-106 — Form pembuatan task minimal.**
Hanya Judul (wajib), Deskripsi (opsional), Kategori (default: Task). Field lain tersedia sebagai pill yang bisa diklik.
- AC: membuat task dari palette selesai dalam ≤ 2 interaksi; task tanpa deskripsi valid; field tambahan tidak memblokir penyimpanan.
- Konsekuensi: `ENT-08` (semua kolom opsional kecuali judul, kategori, status).

**FR-107 — Template tim.**
Membuat tim dari template (Engineering, HR, Marketing, Software House) yang membawa set status, label awal, dan toggle default.
- AC: tim baru dari template "HR" tidak menampilkan Cycle/Effort; template "Engineering" menampilkan keduanya; template dapat diubah setelah dibuat (salinan, bukan referensi hidup).
- Konsekuensi: `ENT-04`, `ENT-07`, `ENT-09`, ADR-007.

**FR-108 — Komentar dengan mention.**
Komentar Markdown terbatas (tebal, miring, tautan, kode inline, code block, daftar), dengan `@mention` anggota workspace.
- AC: mention menghasilkan notifikasi in-app < 5 s p95; komentar yang diedit menampilkan tanda "diedit" + waktu; menghapus komentar menyisakan placeholder (riwayat tidak hilang).
- Konsekuensi: `ENT-12`, `ENT-13`, `AC-35`, `AC-36`.

**FR-109 — Checklist di dalam task.**
Item checklist: teks, tercentang, assignee opsional, tanggal opsional. **Tidak punya status sendiri.**
- AC: mencentang item checklist tidak mengubah status task; progress checklist (`3/7`) terlihat di kartu board; checklist bisa diubah menjadi task baru (sekali jalan) dengan riwayat tertaut.
- Konsekuensi: `ENT-11`, NG-05.

**FR-110 — Web responsif / PWA dasar.**
Bisa dipakai di layar 375 px untuk melihat task, mengubah status, dan berkomentar.
- AC: tidak ada horizontal scroll pada 375 px di Board, List, dan detail task; target sentuh ≥ 44 px.
- Konsekuensi: NG-08.

**FR-111 — Riwayat perubahan task yang bisa dibaca manusia.**
Setiap perubahan status, assignee, prioritas, judul, dan tanggal tercatat dengan pelaku dan waktu.
- AC: riwayat tidak dapat diedit pengguna; menghapus task menyembunyikan task tetapi **mempertahankan** riwayatnya; urutan riwayat stabil (tidak ada duplikat/urutan terbalik setelah refresh).
- Konsekuensi: `ENT-15`, `INV-07`, `INV-14`, ADR-004. **Ini prasyarat seluruh fitur insights R2.**

**FR-112 — Autentikasi email + verifikasi.**
Daftar dengan email+password (Argon2id), verifikasi email, reset password. Sesi berumur terbatas dan bisa dicabut dari pengaturan.
- AC: sesi dicabut berlaku < 60 s di semua klien; password tidak pernah muncul di log; percobaan login dibatasi (lihat `NFR-014`).
- Konsekuensi: `ENT-02`, `ENT-18`, `INV-01`, `AC-01`.

**FR-113 — Workspace & tim.**
Workspace berisi tim; satu user bisa menjadi anggota beberapa workspace dan beberapa tim dengan peran berbeda.
- AC: memindahkan task antar tim **ditolak** (task memiliki tim, bukan pindah bebas); memindahkan task antar workspace ditolak.
- Konsekuensi: ADR-002, `INV-01`, `INV-02`.

**FR-114 — Ekspor data penuh.**
Admin workspace dapat mengekspor seluruh data (JSON + CSV, termasuk komentar dan riwayat) dalam satu paket.
- AC: ekspor dapat diimpor ulang oleh versi yang sama tanpa kehilangan data selain ID internal; ekspor berjalan sebagai job latar dengan progres dan tautan unduh berumur terbatas.
- Konsekuensi: prinsip §3.6, `AC-10`, `ENT-20` (`jobs`), format ekspor masih terbuka (`data-model.md` §9 butir 4).

**FR-116 — Lampiran & media dengan kompresi di klien.**
Gambar dikompresi dan dibuatkan thumbnail sebelum diunggah; board tidak pernah memuat berkas asli.
- AC: thumbnail ≤ 30 KB & versi tampil ≤ 400 KB untuk gambar 4 MB; EXIF/GPS terhapus; board 200 task bergambar tidak memicu satu pun permintaan berkas asli; unggahan gagal tidak menghilangkan berkas dari klien.
- Konsekuensi: `attachments-media.md`, ADR-022, `T-MEDIA1…T-MEDIA12`.

**FR-117 — Email sebagai jalur sekunder yang jujur.**
Tiga mode transport (`none`/`smtp`/`relay`); alur inti tidak gagal saat email mati.
- AC: mode `none` tidak membuat job email dan banner admin tampil; aktivasi ditolak bila `From` memakai domain email publik; 40 perubahan status pada satu task menghasilkan ≤ 1 email per 15 menit; tidak ada lampiran email; subjek tidak memuat isi pekerjaan.
- Konsekuensi: `email.md`, ADR-021, `T-EMAIL1…T-EMAIL11`, `ENT-32`/`ENT-33`.

**FR-115 — Tautan source code (kewajiban AGPL §13).**
UI menampilkan tautan "Source code" yang menunjuk ke source versi yang sedang berjalan.
- AC: tautan ada di setiap halaman (footer atau menu bantuan) tanpa perlu login; versi yang berjalan dapat diidentifikasi (commit/tag) dari UI dan endpoint kesehatan; tautan dapat dikonfigurasi operator dan **tidak boleh** bisa dikosongkan tanpa peringatan saat build produksi.
- Konsekuensi: ADR-014, `NFR-018` (identitas versi).

### 6.2 R1 — Perencanaan & pencarian

**FR-201 — Goal (wadah kerja lintas tim) dan Goal bersarang maksimal 2 level.**
**FR-202 — Cycle dengan auto-rollover dan snapshot scope.** (Definisi di §8.2 — wajib.)
**FR-203 — Dependency satu relasi berarah, terdeteksi siklus.** `INV-05`.
**FR-204 — Smart filter: kondisi UI (field, operator, nilai), AND/OR satu tingkat.**
**FR-205 — Custom View tersimpan dan dibagikan** (per tim, dengan izin lihat/ubah).
**FR-206 — Inbox notifikasi** dengan status dibaca/snooze; email hanya untuk mention dan penugasan (bukan setiap perubahan).
**FR-207 — Status kustom di dalam 5 kategori.** `ENT-07`.
**FR-208 — Integrasi Git:** branch/PR dengan kunci task memindahkan status sesuai aturan yang dapat dimatikan; merge ke branch default → `Done` hanya bila PR menutup task (bukan sekadar menyebut).
**FR-209 — API publik REST** (OpenAPI) + webhook keluar dengan retry dan signing secret.
**FR-210 — Importer Jira (beta).** Melaporkan setiap item yang gagal dipetakan; **tidak pernah** gagal diam-diam. Lihat ADR-013.

### 6.3 R2 — Enterprise & skala

**FR-301 — Timeline/Gantt** dengan dependency dan drag tanggal.
**FR-302 — Insights zero-config:** burndown, burnup, velocity, cycle time, lead time, deteksi status-lama. Semua memakai definisi §8 dan **menyatakan jumlah sampel** (jangan tampilkan grafik dari 2 task).
**FR-303 — SSO:** SAML 2.0 + OIDC, dengan break-glass admin lokal.
**FR-304 — SCIM 2.0** untuk provisioning/deprovisioning.
**FR-305 — Audit log** (akses terbatas admin workspace): login, perubahan permission, ekspor, penghapusan, perubahan SSO.
**FR-306 — Guest terbatas:** akses baca/komentar pada satu tim atau satu Goal, tanpa melihat workspace.
**FR-307 — Custom field sederhana** (teks, angka, pilihan, tanggal) dengan aturan wajib-per-kategori.
**FR-308 — Template workspace** (salinan set tim + status + label + custom field).
**FR-309 — Time tracking (toggle per tim).**
**FR-310 — Kapasitas per Cycle** (effort tersedia per orang/minggu vs beban terjadwal).
**FR-311 — Release/versi** dengan catatan rilis otomatis.

---

## 7. Non-Functional Requirements & SLO

### 7.1 Dataset acuan

Semua angka performa di dokumen ini diukur terhadap dataset ini. Klaim tanpa dataset acuan dianggap tidak valid.

| Parameter | Nilai acuan |
| :--- | :--- |
| Workspace | 2.000 user terdaftar, 300 pengguna aktif harian, **150 konkuren puncak** |
| Tim per workspace | 40 (1 tim Engineering besar, sisanya 5–50 orang) |
| Task aktif | 500.000 per workspace; 250.000 di antaranya belum `Done` |
| Board terbesar | 1 tim dengan 10.000 task (satu view) |
| Riwayat transisi | 3.000.000 event/tahun/workspace |
| Komentar | 1.500.000 |
| Lampiran | 20 GB, file tunggal ≤ 100 MB |
| Lingkungan ukur | 1 node aplikasi 4 vCPU / 8 GB, 1 Postgres 8 vCPU / 32 GB, latensi jaringan klien 40 ms |

### 7.2 SLO yang mengikat

| ID | SLO | Target | Cara ukur |
| :--- | :--- | :--- | :--- |
| **NFR-001** | Ketersediaan (profil Standar, single node) | 99,5% / bulan | Probe eksternal 60 s |
| **NFR-002** | Ketersediaan (profil HA) | 99,9% / bulan | Probe eksternal 30 s |
| **NFR-003** | Latensi interaksi UI (aksi task: ubah status/assignee/prioritas) | **p95 < 100 ms, p99 < 250 ms** | Pengukuran klien: waktu dari input sampai frame berubah |
| **NFR-004** | Latensi API baca (`GET` board/list, 100 item) | p95 < 200 ms, p99 < 500 ms | Metrik server, tanpa cache klien |
| **NFR-005** | Latensi API tulis (mutasi task) | p95 < 300 ms, p99 < 800 ms | Metrik server |
| **NFR-006** | Pencarian (palette, ≤ 5.000 hasil, dataset §7.1) | p95 < 150 ms, p99 < 400 ms | Metrik server-side |
| **NFR-007** | Propagasi real-time (user A ubah → user B lihat) | p95 < 1 s, p99 < 3 s | Uji dua klien terjadwal |
| **NFR-008** | Waktu muat awal (cold, PWA, jaringan 40 ms) | p75 < 2,5 s *interactive*, bundle awal < 300 KB gzip | Lighthouse/CI budget |
| **NFR-009** | Render List 10.000 baris | ≥ 50 fps saat scroll; render awal < 1 s | Uji performa CI |
| **NFR-010** | RPO | ≤ 5 menit untuk PostgreSQL (WAL archiving); **lampiran ≤ 60 menit** (siklus sinkronisasi bucket) — pengecualian dinyatakan, tidak disembunyikan | Uji restore |
| **NFR-011** | RTO | ≤ 2 jam (profil Standar), ≤ 30 menit (HA) | Uji restore kuartalan, **wajib lulus sebelum R2** |
| **NFR-012** | Upgrade versi tanpa kehilangan data | Migrasi maju saja; setiap rilis punya jalur rollback data terdokumentasi; tidak ada migrasi yang mengunci tabel > 5 s pada dataset acuan | Uji upgrade CI pada dataset sintetis penuh |
| **NFR-013** | Retensi & hapus | Task terhapus: soft delete 30 hari lalu purge; audit log 400 hari; riwayat transisi disimpan selama task ada; data ekspor berumur 24 jam | Job verifikasi |
| **NFR-014** | Rate limit | Login 10/menit/IP, API 600/menit/token, tulis 120/menit/user; 429 dengan `Retry-After` | Uji beban |
| **NFR-015** | Aksesibilitas | WCAG 2.2 AA untuk alur inti (buat task, ubah status, komentar, navigasi keyboard penuh) | Audit otomatis + manual sebelum R2 |
| **NFR-016** | Ukuran deployment minimum (profil Minimal) | 2 vCPU / 4 GB total, seluruh layanan | Uji di VM 2 vCPU |
| **NFR-017** | Budget query | Tidak ada endpoint yang menjalankan > 20 query per request; tidak ada query tanpa index pada tabel > 100k baris | `EXPLAIN` gate di CI |
| **NFR-006a** | Pencarian istilah sangat umum (> 50% baris) | Dibatasi: hanya dengan scope tenant+tim, hasil maks 50/halaman; batas dinyatakan: > 500 ribu baris/tim akan melampaui NFR-006 (ADR-019) | Uji pada dataset §7.1 |
| **NFR-019** | Koneksi & pooling | Profil Minimal: 1 instance, maks 10 koneksi DB. Standar/HA: pooler wajib, 20 koneksi/instance; pool habis → antre maks 5 s lalu error jelas (bukan menggantung) | `pg_stat_activity` + uji beban |
| **NFR-018** | Observability | Setiap request punya trace ID; error rate, latensi per endpoint, dan lag sinkronisasi terekspos di `/metrics` | Standar rilis |

### 7.3 Target yang **tidak** dijanjikan

Dihapus dari dokumen v0 karena tidak dapat dipertanggungjawabkan:

- "0 milidetik" → diganti `NFR-003`.
- "10x lebih cepat dari Jira" → diganti `NFR-003`/`NFR-004` yang bisa diuji. Perbandingan kompetitor hanya boleh dipublikasikan bila metodologi ikut dipublikasikan.
- "pencarian < 50 ms untuk jutaan task" → diganti `NFR-006` dengan dataset eksplisit.
- "85–90% paritas fungsional Jira Premium" → dihapus. Diganti §6 (daftar nyata) + §4 (non-goals). Persentase paritas tidak bermakna tanpa bobot dan tanpa definisi.
- "100% paritas dengan 5 modul tambahan" → dihapus, alasan sama.

### 7.4 Anggaran performa & batas keras

| Batas | Nilai | Konsekuensi bila dilanggar |
| :--- | :--- | :--- |
| Task per view | 10.000 (dipaksa paginasi di atas itu) | UI menolak, menyarankan filter |
| Koneksi real-time per user | 5 | Koneksi lama diputus |
| Ukuran deskripsi task | 100 KB teks | Ditolak dengan pesan jelas |
| Lampiran per task | 50 file / 100 MB per file | Ditolak |
| Kedalaman Goal | 2 level | Ditolak (NG-02) |
| Panjang rantai dependency | 200 node | Peringatan + tampilan terpotong |
| Anggota workspace | tidak dibatasi secara artifisial; diuji sampai 10.000 | — |

### 7.5 Matriks kompatibilitas

Browser: 2 versi terakhir Chrome, Edge, Firefox, Safari (desktop + iOS Safari). Tidak ada dukungan IE/legacy. Node/Postgres versi minimum ditetapkan di ADR-010 dan ADR-005.

### 7.6 Aturan menambah komponen infrastruktur

Komponen baru (search engine, message broker, cache, queue) hanya boleh ditambahkan bila **salah satu** terpenuhi:

1. SLO di §7.2 gagal pada dataset §7.1 **dengan bukti metrik**, dan
2. Alternatif di dalam Postgres sudah diuji dan didokumentasikan gagal, **atau**
3. Ada kebutuhan fungsional yang mustahil dipenuhi Postgres (mis. vektor/geo tingkat lanjut).

Keputusan menambah komponen dicatat sebagai ADR. Ini aturan pengikat, bukan saran — ia ada karena dokumen v0 menambahkan 4 komponen infrastruktur tanpa satu pun pengukuran.

---

## 8. Definisi Metrik (wajib sebelum FR-302 dirilis)

Tanpa bagian ini, grafik di R2 adalah dekorasi. Semua definisi di bawah mengasumsikan sumber data `ENT-15` (riwayat transisi, append-only) — bukan kolom `status` saat ini.

### 8.1 Kategori status

5 kategori tetap: `Antrean` (belum dijadwalkan), `Siap` (dijadwalkan, belum mulai), `Dikerjakan`, `Selesai`, `Dibatalkan`. Status kustom selalu berada di dalam salah satu kategori (`ENT-07`).

### 8.2 Snapshot scope Cycle — mengapa auto-rollover tidak boleh menghapus baseline

Auto-rollover (FR-202) memindahkan task yang belum selesai ke cycle berikutnya. Bila scope dibiarkan mengalir tanpa jejak, **velocity mustahil dihitung** (penyebutnya berubah tiap saat).

Aturan:
- Saat Cycle dimulai, sistem mencatat **scope awal** (daftar task + total effort) sebagai snapshot beku.
- Task yang ditambahkan setelah mulai ditandai `ditambahkan_setelah_mulai`.
- Task yang dibawa ke cycle berikutnya ditandai `carried_over` pada cycle asalnya.
- **Velocity** = total effort task yang berstatus `Selesai` **dan** berada di scope cycle asalnya (bukan carry-over), dibagi jumlah cycle.
- **Throughput** = jumlah task selesai per cycle, termasuk carry-over. Dilaporkan terpisah, tidak dicampur dengan velocity.
- **Burndown** dihitung terhadap scope awal; garis "scope berubah" ditampilkan terpisah agar pembaca tahu baseline digeser.

Konsekuensi: `ENT-15` menyimpan `cycle_id` pada setiap event, dan snapshot disimpan eksplisit (`ENT-23` `cycle_scope`, R1).

### 8.3 Metrik lain

| Metrik | Definisi tepat | Sumber |
| :--- | :--- | :--- |
| **Cycle time** | median waktu dari transisi pertama ke kategori `Dikerjakan` sampai transisi pertama ke `Selesai` (bila bolak-balik, dihitung sekali dari masuk pertama); task tanpa `started_at` dikecualikan dan jumlahnya ditampilkan. | `ENT-15` |
| **Lead time** | median waktu dari `created_at` sampai transisi pertama ke `Selesai`. | `ENT-15` |
| **Effort selesai** | jumlah `effort` task yang mencapai `Selesai` dalam periode; task tanpa effort **dikecualikan** dan jumlah pengecualian ditampilkan. | `ENT-08` |
| **Waktu mengendap (bottleneck)** | median durasi tinggal di satu status, per status, untuk task yang **sudah selesai** (agar tidak bias oleh task yang masih berjalan). | `ENT-15` |
| **Goal progress** | jumlah task `Selesai` / jumlah task aktif di Goal. Task `Dibatalkan` dikeluarkan dari penyebut, dan jumlahnya ditampilkan. | `ENT-08` |

Aturan tampilan: setiap grafik menampilkan jumlah sampel; grafik dengan < 5 sampel tidak digambar (tampilkan teks "data belum cukup").

---

## 9. Glosarium (final — menggantikan tabel "de-Jirafication" v0)

| Konsep | Istilah UI (ID) | Istilah UI (EN) | Definisi tegas | Perbaikan terhadap v0 |
| :--- | :--- | :--- | :--- | :--- |
| Unit kerja | **Tugas** | Task | Satu item kerja, milik tepat satu tim. | Tetap. |
| Jenis tugas | **Kategori** | Category | 4 nilai tetap: `Tugas`, `Bug`, `Permintaan`, `Insiden`. Menentukan ikon dan aturan field wajib (R2). | **Dipisah dari Label.** v0 meleburnya dan itu kesalahan termahal di dokumen. |
| Tag bebas | **Label** | Label | Tag berwarna, bebas dibuat per tim. Tidak menentukan perilaku. | Dipisah. |
| Wadah lintas tim | **Goal** | Goal | Kumpulan tugas untuk satu hasil, **milik workspace** (bukan tim), boleh menyentuh banyak tim, boleh punya parent (maks 2 level). | v0 membuat Goal milik tim sekaligus lintas tim — kontradiktif. |
| Periode kerja | **Siklus** | Cycle | Rentang waktu dengan scope beku + snapshot. Opsional per tim. | Tetap, plus aturan snapshot §8.2. |
| Estimasi | **Beban** | Effort | Angka Fibonacci 1,2,3,5,8 atau S/M/L/XL. Satu skala per tim. | Tetap. |
| Antrean kerja | **Antrean** | Backlog | Tugas belum dijadwalkan. | **Bukan "Inbox".** v0 memakai "Inbox" untuk antrean *dan* notifikasi. |
| Notifikasi | **Kotak Masuk** | Inbox | Hanya notifikasi. Tidak pernah berisi pekerjaan. | Disambiguasi. |
| Pencarian bersyarat | **Filter** | Filter | Kondisi eksplisit (field, operator, nilai). | v0 menyebut "Smart Filter" untuk hal yang tidak pintar; istilah "smart" dihapus. |
| Filter tersimpan | **Tampilan Tersimpan** | Saved View | Filter + pengurutan + pengelompokan, dapat dibagikan. | Diperjelas. |
| Pemecahan tugas | **Checklist** | Checklist | Item teks dengan centang + assignee opsional. **Tanpa status.** | v0 menyebutnya sub-task berstatus — itu hierarki baru. |
| Relasi penghambat | **Ketergantungan** | Dependency | Satu relasi berarah: A menghambat B. UI menampilkan kedua sisi, data hanya satu. | v0 menyebutnya "dua status" — duplikasi data. |
| Pengaturan status+form | **Template Tim** | Team Template | Salinan set status, label, toggle, custom field. | Tetap, dinaikkan menjadi `FR-107`. |
| Pengelompokan modul | — | — | **Dihapus.** Dihapus karena v0 memperkenalkannya lalu tidak pernah memakainya. Bila dibutuhkan di R2, pakai Label. | Dihapus dari lingkup. |
| Milestone | — | — | **Dihapus sebagai konsep terpisah.** Tanggal target adalah properti Goal. | v0 menyamakan Epic dengan "Goal/Milestone"; dua konsep berbeda. |

**Aturan penamaan:** tidak ada istilah yang dipakai untuk dua konsep berbeda di seluruh produk dan dokumentasi. Penambahan istilah baru wajib diperiksa terhadap tabel ini.

---

## 10. Asumsi & Risiko

| ID | Risiko/asumsi | Dampak | Mitigasi | Pemilik |
| :--- | :--- | :--- | :--- | :--- |
| **RK-01** | Importer Jira lebih mahal dari perkiraan (ADF lossy, API berubah, Jira Server berbeda). | Gate R1 gagal; migrasi pelanggan tertunda. | Spike wajib di minggu 1–3 R0 (`ADR-013`). Hasil spike boleh mengubah skema sebelum migration pertama ditulis final. | Backend |
| **RK-02** | Optimistic UI + WebSocket menghasilkan bug konsistensi (task "hidup kembali", duplikat). | Kepercayaan pengguna hilang — kegagalan paling fatal untuk produk yang menjual kecepatan. | ADR-015: idempotency key, versi per entitas, resync berbasis cursor; uji chaos jaringan (putus/nyambung) di CI. | Backend |
| **RK-03** | Cache lokal + permission = kebocoran data antar-tenant. | Insiden keamanan; deal enterprise gugur. | Model ancaman di `architecture.md` §5, `INV-12`, TC-14…TC-17, eviction saat logout/cabut akses. | Backend + Security |
| **RK-04** | AGPL menakuti pelanggan enterprise yang ingin memodifikasi internal. | Adopsi lebih lambat. | Dokumen "AGPL untuk pengguna": modifikasi internal tidak wajib dibuka; hanya distribusi/hosting publik (§13). Siapkan jalur lisensi komersial bila perlu. | PM |
| **RK-05** | Go-to-market: bersaing dengan Plane (gratis, komunitas besar). | Proyek tidak mendapat pengguna. | **Diputuskan** (`decisions-r0.md` D-04/D-05): peluncuran publik ditunda sampai importer Jira terbukti; kalimat diferensiasi tunggal; 5 pilot wajib punya Jira + alat kedua; larangan bersaing pada jumlah fitur/bintang. | Product owner |
| **RK-06** | Tim 4 orang tidak sanggup memelihara 40+ fitur R2. | Kualitas turun, SLO gagal, maintainer kelelahan. | Gate berbasis bukti (§5) + non-goals mengikat + aturan §7.6. Lingkup dipotong, bukan tanggal. **Empat peran operasional + aturan pengganti** (`decisions-r0.md` D-02). | Product owner |
| **RK-07** | Postgres `LISTEN/NOTIFY` + FTS tidak cukup pada skala target. | SLO gagal di R0/R1. | Diukur terhadap §7.1 sejak R0; jalur keluar sudah dirancang (ADR-005 §Revisit) sehingga migrasi tidak invasif. | Backend |
| **RK-09** | Data loss: backup ada tapi restore belum pernah terbukti. | Insiden yang tidak bisa dipulihkan; kepercayaan hilang permanen. | D-03: WAL archiving + verifikasi restore otomatis bulanan + drill kuartalan; **gate R0 mensyaratkan drill lulus**, bukan sekadar konfigurasi backup. | Operator |
| **RK-10** | ~~Nama proyek bentrok~~ → **Ditutup.** Nama diputuskan: **Kelindan**. Tidak ditemukan kolisi paket/proyek perangkat lunak. | Sisa risiko: domain & merek dagang belum dipesan. | Selesaikan pendaftaran domain/merek sebelum T3; lihat `naming-and-validation.md` §1. | Product owner |
| **RK-08** | Satu maintainer (bus factor). | Proyek mati bila orang itu berhenti. | Dokumen keputusan (direktori ini), ADR, dan aturan "tidak ada pengetahuan yang hanya ada di kepala". **Setiap peran wajib punya pengganti yang sudah menjalankan tugasnya minimal sekali sebelum R0 selesai** (D-02). | Product owner |

---

## 11. Ketergantungan & Urutan Kerja

Urutan ini mengikat karena beberapa hal di R0 menentukan R2 secara ireversibel.

| # | Pekerjaan | Mengapa urutannya begini |
| :--- | :--- | :--- |
| 1 | **Spike Importer Jira** (1–2 minggu, R0) | Hasilnya menentukan bentuk `ENT-08` (tasks), `ENT-12`/`ENT-13` (komentar & revisi), `ENT-14` (lampiran). Menulis migration tasks sebelum spike = menulis ulang. |
| 2 | **Migrasi skema inti + `ENT-15` (`task_events`)** | Riwayat transisi tidak bisa di-backfill. Menambahkannya di R2 = kehilangan seluruh data historis R0–R1. |
| 3 | **Middleware otorisasi + matriks RBAC** | Menambal otorisasi setelah ada 30 endpoint adalah sumber kebocoran. Matriks ditulis sebelum endpoint pertama. |
| 4 | **Jalur tulis (ADR-015)** | Idempotency dan versi entitas menentukan kontrak API; menambahkannya belakangan merusak semua klien. |
| 5 | **Frontend shell + command palette + jalur baca cepat** | Menetapkan SLO sejak awal; performa tidak bisa "ditambahkan". |
| 6 | **Board + List + inline edit** | Inti nilai R0. |
| 7 | **Backup/restore teruji (NFR-010/011)** | Wajib sebelum ada pengguna nyata, bukan sebelum R2. Gate R0 tanpa ini tidak sah. |
| 8 | Sisanya mengikuti §5. | |

---

## 12. Log Perubahan

| Versi | Tanggal | Perubahan | Alasan |
| :--- | :--- | :--- | :--- |
| 0 | — | Cetak biru "Next-Jira" | Dokumen awal. |
| 1.0 | 2026-11-12 | PRD eksekutabel. Lisensi MIT → AGPL-3.0-only. Hierarki Goal diputuskan milik workspace. Kategori dipisah dari Label. "Inbox" hanya untuk notifikasi. Sub-task berstatus → Checklist. Semua persentase paritas dihapus. SLO Terukur §7. Dataset acuan §7.1. Definisi metrik §8. Non-goals §4. Gate berbasis bukti §5. Estimasi realistis §5. Komponen infra dikurangi (Postgres-only di R0–R1). MinIO dihapus. | Kritik di `prd-review.md`. |

---

## 13. Rujukan

- `architecture.md` — ADR-001…ADR-016, topologi, profil deployment, model ancaman cache.
- `data-model.md` — kamus data siap-DDL Fase 1 + forward-compat Fase 2.
- `rbac.md` — katalog aksi, peran, matriks, kasus uji.
- `decisions-r0.md` — model operasi, peran, backup/restore, go-to-market, batas open-core.
- `repo-layout.md` — tata letak repo, batas modul, kontrak perintah, definisi "selesai".
- `versioning.md` — SemVer, saluran rilis, catatan rilis, deprecation, kontribusi.
- `support.md` — kanal dukungan, triase, bundle diagnostik.
- `i18n.md` — kebijakan bahasa & format.
- `security-policy.md` — versi didukung, SLA kerentanan, kebijakan dependensi, artefak rilis.
- `onboarding.md` — menit pertama, empty state, pratinjau impor.
- `realtime-and-search.md` — perilaku real-time & pencarian.
- `spike-jira-importer.md` — rancangan spike importer (S1–S6).
- `email.md` — email keluar: transport, deliverability, batas kirim (ADR-021).
- `attachments-media.md` — unggah, kompresi, thumbnail, tampilan lampiran (ADR-022).
- `ux-principles.md` — prinsip UX + anggaran "ringan" terukur (`UX-*`).
- `editor-decision.md` — format & pengalaman menulis (Markdown subset + editor visual).
- `migrations.md` — aturan migrasi & jalur upgrade.
- `api-contract.md` — kontrak API v1 (bentuk, error, idempotensi, paginasi, real-time).
- `testing-strategy.md` — uji wajib, gerbang rilis, uji konkurensi/chaos/performa.
- `naming-and-validation.md` — keputusan nama (Kelindan) + hasil validasi skema pada PostgreSQL nyata.
- `import-contract.md` — kontrak importer Jira (pemetaan, taksonomi kegagalan L1–L5, kolom wajib skema).
- `prd-review.md` — kritik yang mendasari perubahan v0 → v1.0.

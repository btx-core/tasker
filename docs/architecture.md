# Arsitektur: Kelindan

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Ruang lingkup:** keputusan teknis yang mengikat untuk R0–R2. Setiap ADR menyatakan keputusan, alasan, konsekuensi, dan **syarat untuk meninjau ulang** (agar keputusan bisa diuji, bukan diperdebatkan).

Aturan: ADR tidak dihapus. Bila berubah, ADR baru ditulis dan yang lama ditandai "Digantikan oleh". Nomor yang sudah dipakai tidak didaur ulang.

---

## 1. Bentuk sistem

```
                       ┌──────────────────────────────────────────┐
   Browser (PWA)       │  Next.js (App Router) + React            │
   ┌───────────────┐   │  shell SPA untuk area kerja              │
   │ UI  (React)   │◄──┤  Server Components hanya untuk halaman   │
   │               │   │  auth/marketing; area kerja = klien      │
   │ Cache memori  │   │                                          │
   │ (in-memory)   │   │  API: route handlers (BFF tipis)         │
   └──────┬────────┘   └────────────┬─────────────────────────────┘
          │ WS (delta, cursor)      │ HTTP (mutasi + baca)
          │                         │
   ┌──────▼─────────────────────────▼─────────────────────────────┐
   │  Aplikasi (Node/TypeScript, Fastify)                          │
   │   - otorisasi terpusat (RBAC)      - mutation handler         │
   │   - realtime hub (WS)              - job runner (in-process)   │
   └──────┬───────────────────────────────────┬───────────────────┘
          │                                   │
   ┌──────▼───────────┐              ┌────────▼─────────────────┐
   │ PostgreSQL 18+   │              │ Object storage (S3 API)  │
   │ satu sumber      │              │ S3 / R2 / Ceph / Garage  │
   │ kebenaran        │              │ (dev: disk lokal)        │
   │ + outbox + FTS   │              └──────────────────────────┘
   └──────────────────┘
```

**Empat komponen runtime pada R0.** Tidak ada Redis, tidak ada message broker, tidak ada search engine terpisah. Alasan ada di ADR-005 dan ADR-008.

**Batas kepercayaan.** Satu-satunya sumber kebenaran adalah PostgreSQL. Semua yang lain — cache klien, cache proses, indeks pencarian, outbox — adalah turunan yang boleh dibuang dan dibangun ulang.

---

## 2. Keputusan Arsitektur

### ADR-001 — Arsitektur data klien: cache-kanonik + optimistic write, bukan local-first

**Status:** Diterima (menggantikan klaim "local-first" v0).

**Konteks.** v0 menulis "local-first, IndexedDB, UI 0 ms, kirim ke server belakangan" sekaligus merekomendasikan "TanStack Query / RxDB". Keduanya berbeda orde besaran biaya. Klaim kecepatan adalah janji produk utama, jadi keputusan ini tidak boleh ambigu.

**Keputusan.**

Untuk R0–R1: **cache-kanonik di klien + optimistic mutation**, dengan tiga properti:

1. **Server adalah sumber kebenaran.** Cache klien adalah salinan berumur pendek dengan masa berlaku eksplisit, bukan basis data primer.
2. **Mutasi optimistik dengan antrean berurutan.** Perubahan diterapkan ke cache lokal segera, diberi `operation_id` (ULID, dibuat klien), dikirim ke server, lalu **direkonsiliasi dengan respons kanonik server** (server mengembalikan entitas lengkap beserta `version` baru). Bila gagal: rollback ke nilai kanonik terakhir + permukaan error yang bisa di-retry.
3. **Tanpa mode offline tulis.** Bila mutasi gagal karena jaringan, antrean menyimpan operasi dan mengulanginya **hanya selama tab hidup** dan **hanya bila pengguna masih di konteks yang sama**. Tidak ada antrean persisten lintas sesi. Ini yang membedakannya dari local-first (NG-09).

Mekanisme yang **tidak** dipakai pada R0–R1: IndexedDB sebagai basis data kanonik, CRDT, replikasi PouchDB/CouchDB, PowerSync, Zero, ElectricSQL.

**Kenapa bukan local-first sekarang.** Linear memakai sync engine in-house: bootstrap parsial, delta, antrean mutasi, dan resolusi konflik yang menyentuh setiap fitur. Itu pekerjaan bertahun-tahun oleh tim yang sudah punya fondasi. Untuk tim 4 orang dengan gate R0 berdurasi 10–12 minggu, sync engine akan menggeser seluruh anggaran dari produk ke infrastruktur — dan produk yang belum terbukti butuh itu. Klaim "local-first" juga tidak bisa ditepati sebagian; produk yang mengklaimnya lalu hanya punya optimistic UI akan kehilangan kredibilitas lebih besar daripada tidak mengklaim sama sekali.

**Yang tetap kita raih.** SLO `NFR-003` (p95 < 100 ms) tercapai karena UI tidak menunggu jaringan; target mutasi `NFR-005` dicapai dengan satu round-trip. Yang **tidak** kita raih: memuat aplikasi di pesawat, dan membuka view tanpa request pertama. Ini dinyatakan terbuka di NG-09.

**Konsekuensi.**

- Cache di memori saja (hilang saat reload). Reload = bootstrap ulang dari server. Karena itu bootstrap harus cepat: `NFR-008`.
- Setiap mutasi wajib idempoten di server (`operation_id` disimpan, lihat ADR-015). Tanpa ini, retry menghasilkan duplikat.
- Rekonsiliasi harus menyertakan `version` per entitas; tanpa itu, respons server yang datang terlambat bisa menimpa perubahan yang lebih baru.
- Tidak ada penulisan lintas-tab. Tab kedua membaca dari server; perubahan tab pertama sampai lewat realtime (`NFR-007`), bukan lewat storage bersama.

**Revisit (triger terukur).** Boleh dirancang ulang sebagai local-first bila **dua** hal terpenuhi: (a) ≥ 15% pengguna aktif melaporkan bekerja di jaringan tidak stabil sebagai kebutuhan utama, **dan** (b) ada ADR baru yang menjelaskan biaya pemeliharaan sync engine, resolusi konflik (termasuk editor teks), serta strategi migrasi data klien yang sudah beredar. Sampai itu terjadi, jawaban atas permintaan "offline" adalah: view read-only dari cache saat jaringan putus, bukan antrean tulis.

---

### ADR-002 — Hierarki: Workspace → Team → Task; Goal milik Workspace

**Status:** Diterima (memperbaiki kontradiksi v0).

**Konteks.** v0 menyatakan `Workspace → Team → Goal → Task → Sub-task`, lalu menyatakan Goal "bisa lintas tim", lalu menyarankan Goal bersarang. Tiga pernyataan itu tidak bisa benar bersamaan, dan semuanya menentukan bentuk tabel.

**Keputusan.**

```
Workspace  (batas tenant & batas billing)
├── Team   (unit kepemilikan, unit permission, unit toggle fitur)
│   └── Task  (milik TEPAT SATU team; tidak bisa dipindah antar workspace)
│       └── ChecklistItem (teks, tanpa status)
└── Goal   (milik WORKSPACE; boleh menautkan task dari banyak team; parent maks 2 level)
```

Aturan tegas:

1. **Task selalu milik satu team.** "Sepakati antar tim" dilakukan lewat Goal, bukan dengan task tanpa pemilik.
2. **Goal tidak dimiliki team.** Goal punya `owner_team` opsional (siapa yang mengurus), tetapi keanggotaannya adalah daftar task lintas tim. Ini yang membuat Goal lintas divisi mungkin tanpa melanggar aturan 1.
3. **Kedalaman Goal maksimal 2 level.** Level 3 ditolak (NG-02).
4. **Tidak ada sub-task berstatus.** Pemecahan di dalam task = Checklist (NG-05).
5. **Task tidak bisa pindah team** (FR-113). Kebutuhan "pindah" diselesaikan dengan membuat task baru di tim tujuan yang menautkan asal, atau memindahkan seluruh Goal. Alasan: task yang pindah team mengubah otorisasi, status set (status tim asal mungkin tidak ada di tim tujuan), dan riwayat sekaligus — tiga sumber bug dengan manfaat kecil.

**Konsekuensi.** Tabel `tasks` membawa `team_id` (wajib) dan `workspace_id` (denormalisasi untuk isolasi dan index). `goals` membawa `workspace_id` (wajib) dan `owner_team_id` (opsional). Relasi task↔goal adalah tabel penghubung, bukan kolom di `tasks` — karena satu task bisa berada di beberapa Goal? **Tidak**: satu task berada di maksimal satu Goal aktif (menghindari progress ganda). Keputusan: relasi 1:N (`tasks.goal_id` nullable), bukan N:N. Bila nanti butuh banyak Goal, itu ADR baru.

**Revisit.** Bila ada pelanggan yang membutuhkan satu task di beberapa Goal secara sah (mis. task dipakai dua program), naikkan ke N:N dengan ADR baru — biayanya adalah progress Goal yang tidak lagi eksklusif.

---

### ADR-003 — Otorisasi: RBAC dua tingkat, ditegakkan di satu titik

**Status:** Diterima.

**Konteks.** v0 punya dua definisi RBAC yang berbeda (`Admin/Member/Commenter/Viewer` per proyek vs `Workspace Admin/Team Admin/Member/Guest`). Middleware yang dibangun di atas ambiguitas ini adalah sumber kebocoran yang paling umum.

**Keputusan.**

1. Dua tingkat keanggotaan: **workspace role** dan **team role**. Keduanya eksplisit, tidak ada "inherit" implisit kecuali yang tertulis di `rbac.md`.
2. Satu fungsi otorisasi: `can(actor, action, resource)`. Tidak ada pengecekan izin ad-hoc di handler. Setiap endpoint menyatakan aksi yang dibutuhkan sebagai deklarasi, bukan `if` tersebar.
3. **Deny by default.** Aksi yang tidak ada di katalog `rbac.md` **ditolak** — termasuk aksi baru yang lupa didaftarkan. Ini mencegah "fitur baru otomatis bisa diakses".
4. Isolasi tenant adalah lapisan terpisah dari RBAC. RBAC menjawab "boleh atau tidak", isolasi tenant menjawab "objek ini milik tenant siapa". Keduanya wajib. Rincian di `architecture.md` §5 dan `INV-12`.
5. Guest (R2) punya peran sendiri yang **tidak** merupakan bagian dari hierarki workspace: ia hanya bisa melihat objek yang secara eksplisit dibagikan.

Detail matriks ada di `rbac.md`. ADR ini hanya menetapkan strukturnya.

**Konsekuensi.** Setiap endpoint butuh (a) aksi, (b) pemetaan objek→kepemilikan. Middleware yang lupa (b) adalah bug keamanan; karena itu ada test `TC-14…TC-17` yang mencoba akses lintas-tenant pada **setiap** endpoint secara otomatis.

---

### ADR-004 — Riwayat sebagai log append-only, bukan tabel audit generik

**Status:** Diterima.

**Konteks.** Insights R2 (burndown, cycle time, bottleneck) **tidak bisa dihitung dari state saat ini**. v0 menyebut `activity_logs` hanya sebagai beban partisi, bukan sebagai sumber data metrik. Bila tidak dirancang di R0, seluruh data historis R0–R1 hilang permanen.

**Keputusan.**

1. `task_events` — append-only, berisi perubahan **atribut task** (status, assignee, prioritas, judul, tanggal, effort, cycle, goal) beserta `from`/`to`, pelaku, waktu, dan `cycle_id` pada saat event terjadi.
2. `audit_events` — terpisah, berisi aksi **administratif dan keamanan** (login, perubahan permission, ekspor, hapus, perubahan SSO). Berbeda tabel karena berbeda retensi (`NFR-013`), berbeda akses, dan berbeda volume.
3. Tidak ada UPDATE/DELETE pada kedua tabel. Koreksi dilakukan dengan event kompensasi.
4. Riwayat task **tidak dihapus** saat task dihapus (soft delete 30 hari, `NFR-013`); setelah purge, event tetap disimpan tanpa PII melebihi kebutuhan metrik.

**Alasan pemisahan.** Menyatukan keduanya memaksa audit 400 hari ikut menanggung volume 3 juta event/tahun/workspace, dan memaksa query metrik menyaring noise administratif. Volume dan pembaca berbeda → tabel berbeda.

**Konsekuensi.** Setiap mutasi task wajib menulis event **dalam transaksi yang sama** dengan mutasi. Ini menambah satu insert per mutasi; diukur di `NFR-005`. Bila kelak jadi bottleneck, jalur keluarnya adalah outbox + worker (ADR-008), bukan menghapus event.

---

### ADR-005 — Pencarian: PostgreSQL (FTS + trigram) sampai ada bukti

**Status:** Diterima (menggantikan "Meilisearch wajib di Fase 2" v0).

**Konteks.** v0 mewajibkan Meilisearch/Elasticsearch di Fase 2. Itu menambah sumber kebenaran kedua, satu container, dan pipeline reindex — untuk kebutuhan yang belum diukur.

**Keputusan.**

1. R0–R1: pencarian memakai PostgreSQL full-text search (`tsvector` tersimpan, GIN index) + `pg_trgm` untuk pencarian substring dan toleransi salah ketik.
2. Pencarian **selalu transaksional dengan penulisan**, sehingga `FR-103` (item yang baru dibuat langsung ditemukan) terpenuhi tanpa sinkronisasi.
3. Cakupan: judul task (bobot tertinggi), deskripsi, komentar, nama orang, nama tim/goal (bobot rendah).
4. Batas yang dinyatakan: hasil dibatasi (mis. 50 per halaman, maks 5.000 kandidat) dan query selalu ter-scope ke team/workspace pengguna — bukan pencarian global lintas tenant.

**Yang kita terima sebagai kompromi.** Pencarian semantik ("login bermasalah") tidak berfungsi baik; pencarian berbasis relevansi tidak seluwes mesin khusus; pencarian di 5 juta dokumen akan melambat pada dataset di atas §7.1.

**Revisit (triger terukur).** Pindah ke mesin pencari terpisah hanya bila `NFR-006` gagal pada dataset §7.1 **setelah** query dan index Postgres dioptimalkan dan hasilnya terdokumentasi, atau bila dibutuhkan pencarian semantik/vektor. Bila pindah, bentuknya adalah **indeks turunan yang bisa dibangun ulang** (bukan sumber kebenaran), dengan antrean outbox dan tombol "rebuild index" — agar pelanggan self-host tidak pernah terjebak indeks rusak.

---

### ADR-006 — Real-time: WebSocket dengan log delta ber-cursor, bukan Pub/Sub fire-and-forget

**Status:** Diterima.

**Konteks.** v0 menyebut "WebSocket + Redis Pub/Sub". Redis Pub/Sub tidak durable: klien yang putus 5 detik kehilangan event selamanya, dan tidak ada cara mengetahui apa yang terlewat.

**Keputusan.**

1. Transport: WebSocket tunggal per tab, autentikasi via sesi, langganan per team (bukan per task) untuk mengurangi fan-out.
2. **Setiap mutasi menulis baris ke `changes` (outbox/log perubahan) dengan `seq` monoton per workspace**, dalam transaksi yang sama. Klien menyimpan `seq` terakhir.
3. Saat klien tersambung ulang, ia mengirim `since_seq` dan menerima **semua delta yang terlewat** dari tabel, bukan hanya event baru. Bila jeda terlalu besar atau log sudah dipangkas, server merespons "butuh bootstrap ulang" dan klien memuat snapshot bersih — ini jalur pemulihan yang eksplisit, bukan kegagalan diam-diam.
4. Skala keluar: pada R0–R1 satu proses aplikasi memegang koneksi; untuk lebih dari satu instance, transport antar-node memakai `LISTEN/NOTIFY` Postgres. Bila jumlah koneksi menuntut, jalur keluar adalah menambah node hub khusus yang membaca `changes` — kontraknya sama, jadi tidak invasif.
5. Presence ("sedang dilihat siapa") **tidak durable** dan tidak memakai `changes`; ia ephemeral dan boleh hilang.

**Konsekuensi.** Urutan dijamin per workspace (`seq`), bukan per task — cukup untuk UI yang menampilkan entitas. Duplikat mungkin terjadi (at-least-once); klien wajib idempoten saat menerapkan delta (dijaga oleh `version` per entitas, ADR-015).

**Reconnect storm.** Saat deploy, semua klien tersambung ulang serentak. Mitigasi wajib: backoff dengan jitter, dan `since_seq` membuat penyambungan ulang murah (satu query rentang), bukan beban bootstrap penuh.

---

### ADR-007 — Toggle fitur per team, bukan dua produk

**Status:** Diterima (dinaikkan dari "ide di lampiran" v0 menjadi prinsip inti).

**Keputusan.**

1. Satu set tabel; toggle adalah **pengaturan tampilan dan validasi**, bukan perbedaan skema.
2. Mematikan toggle **tidak menghapus data**. Data tetap ada, tersembunyi dari UI, dan dipertahankan saat toggle dinyalakan lagi (`INV-10`).
3. Toggle yang diakui (R0–R2): `cycles`, `goals`, `effort`, `timeline`, `time_tracking`, `releases`, `capacity`, `dependencies`.
4. API **tidak** menyembunyikan data hanya karena toggle mati; API tetap mengembalikan data dan menandai toggle. Menyembunyikan di server akan membuat toggle menjadi operasi destruktif yang tidak bisa dibatalkan, dan mematikan kemungkinan integrasi.

**Konsekuensi.** UI wajib menangani "data ada, fitur mati" (tampil read-only di detail task). Ini disengaja: lebih baik daripada membuat toggle yang menghapus data pengguna.

---

### ADR-008 — Latar belakang: outbox di Postgres, bukan Redis/BullMQ

**Status:** Diterima.

**Konteks.** v0 memakai BullMQ/Asynq berbasis Redis. Itu komponen tambahan (bertentangan dengan §7.6 PRD dan target 3 container).

**Keputusan.**

1. Tabel `jobs` di Postgres dengan `SELECT … FOR UPDATE SKIP LOCKED`. Runner berjalan in-process (satu goroutine/worker loop per instance) pada R0–R2.
2. Job wajib idempoten dan punya `attempts`, `run_after` (backoff eksponensial), `locked_until`.
3. Perubahan yang perlu dipropagasikan (webhook, notifikasi, indeks) ditulis ke `changes` dalam transaksi yang sama, lalu worker memprosesnya. Ini pola transactional outbox: tidak ada pesan hilang bila proses mati setelah commit.

**Konsekuensi.** Throughput job terbatas pada kapasitas Postgres — cukup untuk target §7.1 (volume job = notifikasi + webhook + rollover cycle, bukan streaming). Bila jumlah job melebihi ~50/1000/detik secara konsisten, jalur keluar adalah worker terpisah yang membaca tabel yang sama (bukan broker baru), atau broker sungguhan bila terpaksa — dengan ADR baru.

---

### ADR-009 — Lampiran: object storage S3-compatible, MinIO bukan default

**Status:** Diterima (menggantikan "MinIO" v0).

**Konteks.** Per 2026 MinIO Community Edition telah dinyatakan tidak dirawat lagi, image Docker resminya dihentikan (Okt 2025), dan console adminnya dihapus dari edisi gratis. Merekomendasikannya untuk produk self-hosted baru berarti menyerahkan patch keamanan pelanggan ke proyek yang sudah arsip.

**Keputusan.**

1. Antarmuka: **S3 API**. Implementasi tidak diikat.
2. Target yang didokumentasikan untuk self-host: **Ceph RGW**, **Garage**, **SeaweedFS**, atau S3/R2/GCS terkelola.
3. Profil **Minimal** (R0, satu node): penyimpanan disk lokal di belakang abstraksi yang sama, dengan batas ukuran dan peringatan eksplisit bahwa ini bukan untuk produksi multi-node.
4. Unggahan langsung dari klien via **presigned URL** dengan masa berlaku pendek; server tidak pernah menjadi proksi byte lampiran (melindungi memori dan `NFR-016`).
5. Keamanan lampiran: validasi tipe & ukuran, `Content-Disposition` attachment untuk tipe berbahaya, tautan berumur pendek, pemindaian malware **opsional** (dokumentasikan sebagai tanggung jawab operator, bukan janji produk).

**Konsekuensi.** Backup harus mencakup bucket, bukan hanya Postgres; prosedur restore mencakup keduanya (`NFR-011`).

---

### ADR-010 — Stack: TypeScript end-to-end, Postgres 18+, satu bahasa

**Status:** Diterima (memutuskan menu pilihan v0).

**Keputusan.**

- **Bahasa:** TypeScript di klien dan server. Alasan yang dipakai: model data Task kompleks (attribute, kategori, toggle, riwayat) dan tipe bersama menghilangkan kelas bug kontrak antara klien/server; satu bahasa menurunkan biaya tim 4 orang; server-side rendering untuk halaman auth mempercepat muat awal.
- **Frontend:** Next.js (App Router) + React. Area kerja adalah aplikasi klien (bukan SSR per navigasi) agar SLO `NFR-003` tercapai; SSR dipakai hanya untuk halaman publik/auth.
- **Backend:** Node + Fastify, dipisah dari route handler Next agar bisa diskalakan terpisah dan dipakai oleh WebSocket hub. Tidak memakai framework berat dengan banyak lapisan abstraksi.
- **PostgreSQL 16 minimum** (dikoreksi dari 18 — lihat ADR-018). UUIDv7 dibuat di aplikasi, jadi tidak ada ketergantungan pada fungsi DB yang baru ada di 18. Operator self-host boleh memakai 16 atau 17; 18 didukung tetapi bukan syarat.
- **Validasi:** satu skema (mis. satu definisi tipe yang menghasilkan validator request/response) untuk mencegah kontrak ganda.
- **Tidak dipakai pada R0–R2:** GraphQL (REST cukup dan lebih mudah di-cache/di-rate-limit), microservices, Kubernetes sebagai prasyarat.

**Alasan kenapa bukan Go.** Go lebih baik untuk koneksi WebSocket masif dan hemat memori, tetapi keuntungannya baru terasa di R3, sementara biaya dua bahasa (tipe ganda, dua toolchain, dua budaya review) dibayar sejak hari pertama oleh tim 4 orang. Bila hub WebSocket menjadi bottleneck, komponen itu bisa dipecah ke Go **tanpa mengubah bahasa inti** — dan itu keputusan terpisah, bukan keputusan stack.

**Revisit.** Bila profil HA perlu > 20.000 koneksi WebSocket per node secara konsisten, pecah hub ke bahasa yang lebih hemat memori.

---

### ADR-011 — Primary key UUIDv7, dengan alasan yang benar

**Status:** Diterima (alasan v0 dikoreksi).

**Keputusan.**

1. Semua entitas memakai `uuid` versi 7 sebagai PK, dibuat **selalu oleh aplikasi** (bukan default kolom, bukan fungsi DB). Alasan: ID harus tersedia sebelum commit (optimistic UI, `changes`, outbox), pengujian unit tidak butuh DB, dan minimum PostgreSQL turun ke 16 (ADR-018). Tidak ada dua sumber pembuatan ID yang boleh hidup bersamaan.
2. Alasan yang **benar**: (a) insert cenderung ke ujung kanan B-tree sehingga mengurangi page split dan fragmentasi dibanding UUIDv4; (b) ID bisa dibuat di klien untuk entitas yang dibuat di klien (komentar, checklist item) tanpa round-trip; (c) ID tidak dapat ditebak dan tidak membocorkan volume data seperti integer.
3. Alasan yang **bukan** dasar keputusan: "memudahkan sharding/partitioning". Partitioning ditentukan oleh *partition key* (`workspace_id`, atau bulan untuk event), bukan oleh tipe PK. UUIDv7 membantu **locality insert**, bukan partisi.
4. Alternatif yang ditolak: `bigint` auto-increment global (membocorkan volume, menyulitkan pembuatan ID di klien, menyulitkan penggabungan data impor), `bigint` per-tenant (menambah kompleksitas routing).

**Konsekuensi.** PK 16 byte (vs 8 byte bigint) → index lebih besar. Diterima karena dataset §7.1 masih nyaman; diukur di `NFR-017`. Kolom `seq` (bigint) tetap dipakai untuk urutan, karena UUIDv7 tidak menjamin urutan mutlak di bawah konkurensi tinggi.

---

### ADR-012 — Isolasi tenant: satu database, `workspace_id` wajib, RLS sebagai lapisan kedua (ditunda ke R2)

**Status:** Diterima dengan syarat.

**Konteks.** v0 tidak mendefinisikan isolasi tenant sama sekali, padahal produk ini akan menyimpan data banyak perusahaan.

**Keputusan.**

1. **Satu database, satu skema.** Bukan database-per-tenant (biaya migrasi dan operasional meledak untuk self-host kecil dan tidak membantu isolasi secara fundamental bila kode aplikasi salah).
2. Setiap tabel milik tenant wajib membawa `workspace_id`, walaupun redundan dengan join. Ini membuat setiap query bisa difilter tanpa join tambahan, dan membuat index komposit `(workspace_id, …)` mungkin.
3. **Lapisan 1 (R0, wajib):** otorisasi aplikasi terpusat (ADR-003) + aturan repository yang **menolak query tanpa `workspace_id`** pada tabel milik tenant. Ini ditegakkan oleh tipe/lint dan test, bukan disiplin.
4. **Lapisan 2 (R2):** PostgreSQL Row-Level Security untuk tabel paling sensitif (tasks, comments, attachments, audit), dengan `SET LOCAL app.workspace_id` per transaksi. RLS dianggap **pertahanan berlapis**, bukan pengganti lapisan 1 — RLS yang salah dikonfigurasi memberi rasa aman palsu.
5. Keputusan menunda RLS ke R2 eksplisit: menuliskan RLS untuk 20 tabel di R0 memperlambat gate R0 tanpa menghasilkan nilai bagi pengguna tunggal-tenant, tetapi RLS **wajib sebelum ada pelanggan multi-tenant yang nyata** (`FR-306` guest adalah pemicunya).

**Revisit.** RLS wajib selesai sebelum rilis R2, tanpa pengecualian. Bila ada pelanggan enterprise yang meminta isolasi fisik (dedicated database), jalur keluarnya adalah deploy terpisah per pelanggan — bukan perubahan arsitektur.

---

### ADR-013 — Importer Jira: spike di R0, konversi lossy yang dilaporkan

**Status:** Diterima.

**Konteks.** v0 menyebut "wizard, masukkan API Key, semua tersedot otomatis". Kenyataannya: endpoint `/rest/api/3/search` sudah dihapus dan diganti `/rest/api/3/search/jql` dengan paginasi token dan tanpa total count; deskripsi/komentar Jira v3 memakai ADF (bukan Markdown); Jira Server/DC berbeda API. Konversi ADF→Markdown **lossy**.

**Keputusan.**

1. **Spike wajib di minggu 1–3 R0** (sebelum migration task inti difinalkan). Deliverable spike: fixture data Jira nyata + laporan apa yang hilang saat konversi + keputusan bentuk kolom deskripsi/komentar.
2. Importer mendukung dua jalur: **file ekspor (JSON/CSV) lebih diutamakan** daripada API langsung, karena tidak bergantung pada perubahan API Atlassian dan tidak memerlukan kredensial pelanggan di server kami.
3. Pemetaan v1: Project→Team, Epic→Goal, Sprint→Cycle, Issue→Task, Issue Type→**Kategori** (bukan Label — koreksi terhadap v0), Comment→Comment, Attachment→Attachment, Status→Status kustom di dalam 5 kategori, Custom Field tak dikenal→**field "data Jira mentah"** (JSON) yang tetap terlihat, bukan dibuang.
4. **Semua kegagalan dipetakan dan dilaporkan** per item, dengan kemampuan unduh laporan CSV. Impor parsial adalah hasil yang sah; impor yang diam-diam membuang data bukan.
5. Impor bersifat idempoten per `jira_issue_key` sehingga menjalankan ulang tidak menggandakan data. Impor tidak menimpa perubahan lokal setelah impor (lihat `ENT` di `data-model.md`).

**Konsekuensi.** Estimasi minimum 6–8 minggu kerja untuk importer yang jujur pada R2, bukan "wizard satu klik". Gate R1 mensyaratkan impor 1.000 issue nyata dengan kegagalan < 2%.

---

### ADR-014 — Lisensi AGPL-3.0-only dan konsekuensi produknya

**Status:** Diterima.

**Keputusan.** Proyek dilisensikan **AGPL-3.0-only**.

**Alasan.** Mencegah pihak ketiga menawarkan Kelindan sebagai layanan hosted tanpa berkontribusi balik, tanpa melarang perusahaan memakai dan memodifikasi untuk internal. Ini pilihan yang konsisten dengan positioning "open-source yang tidak bisa di-wholesale oleh hyperscaler".

**Konsekuensi yang mengikat desain produk.** Pasal 13 mewajibkan pengguna yang berinteraksi lewat jaringan dapat memperoleh source. Maka:

1. **UI wajib menampilkan tautan "Source code"** (footer, halaman tentang, atau menu bantuan) yang menunjuk ke repositori atau arsip source versi yang berjalan. Ini requirement, bukan nice-to-have: tercatat sebagai `FR-115` di `prd.md` §6.1.
2. **Versi harus dapat diidentifikasi** di UI dan di `/health` (commit/tag), karena source yang ditawarkan harus sesuai dengan versi yang berjalan.
3. **Build wajib reproducible** untuk rilis rilis resmi, agar pihak ketiga dapat memverifikasi bahwa binary/image berkorespondensi dengan source.
4. **Dependensi** harus AGPL-kompatibel. Lisensi yang tidak kompatibel (mis. komponen proprietary, atau pustaka berlisensi yang membatasi) dilarang ditambahkan tanpa pemeriksaan. Daftar dependensi diperiksa otomatis di CI.
5. **Tidak ada CLA yang memaksa** penyerahan hak cipta; kontribusi masuk dengan lisensi yang sama (DCO). Ini mencegah ketidakmampuan relicensing di masa depan — tetapi juga berarti **relicensing ke lisensi non-AGPL kelak praktis tidak mungkin**. Keputusan ini final dan disengaja.
6. **Jalur komersial** (open-core) harus dirancang agar tidak menciptakan versi yang lebih kuat dari versi AGPL untuk fitur inti. Modul opsional harus berupa integrasi/hosting/layanan, bukan pemotongan fitur inti.

**Revisit.** Tidak direncanakan.

---

### ADR-015 — Konsistensi tulis: idempotensi, versi entitas, konflik per-field

**Status:** Diterima. **Ini ADR yang paling sering dilupakan produk sejenis, dan sumber bug paling mahal.**

**Konteks.** Dengan optimistic UI + WebSocket + retry (ADR-001, ADR-006), tiga masalah muncul pasti terjadi: (1) mutasi ganda, (2) respons datang tidak berurutan, (3) dua pengguna mengedit field berbeda pada task yang sama.

**Keputusan.**

1. **Idempotensi.** Setiap mutasi membawa `operation_id` (ULID dari klien). Server menyimpan `(actor_id, operation_id)` unik selama 24 jam; permintaan duplikat mengembalikan hasil yang sama, bukan menerapkan dua kali.
2. **Versi entitas.** Setiap entitas punya `version` (integer, naik satu setiap mutasi). Klien mengirim `expected_version` pada mutasi opsional; bila tidak cocok, server mengembalikan **409 dengan state kanonik terbaru**, dan klien merekonsiliasi, bukan menimpa.
3. **Konflik per-field, bukan per-entitas.** Karena mutasi dikirim sebagai patch field-level, dua orang mengedit field berbeda pada task yang sama **tidak** saling menimpa. Untuk field yang sama, kebijakan adalah **last-write-wins dengan deteksi**: server menerapkan nilai terakhir yang tiba, tetapi menulis event di `task_events` yang mencatat nilai sebelumnya — sehingga kehilangan data selalu dapat dilihat dan dipulihkan lewat riwayat.
4. **Editor teks (deskripsi/komentar).** LWW saja **tidak cukup** untuk teks panjang: pengguna bisa kehilangan paragraf. Karena itu editor wajib melakukan: (a) simpan otomatis versi draf lokal, (b) bila `expected_version` tidak cocok saat menyimpan, tampilkan konflik eksplisit ("perubahan orang lain") dengan pilihan lihat/gabung, bukan menimpa diam-diam. CRDT tidak dipakai (ADR-001).
5. **Urutan penerapan delta realtime.** Klien menerapkan delta hanya bila `version` delta > `version` lokal; delta yang lebih tua diabaikan (idempoten).
6. **Resync.** Bila klien mendeteksi celah (`seq` melompat), ia tidak menebak: ia meminta rentang delta; bila tidak tersedia, bootstrap ulang.

**Konsekuensi.** Setiap handler mutasi wajib: validasi → cek idempotensi → cek versi → terapkan patch → tulis event → tulis `changes` → commit. Urutan ini baku dan menjadi template tunggal (tidak boleh ada handler yang menyimpang). Ini juga alasan `INV-04` (versi) dan `ENT-19` (`idempotency_keys`) bersifat wajib, bukan opsional.

---

### ADR-016 — Deployment: tiga profil, satu basis kode

**Status:** Diterima.

**Profil yang didukung dan diuji di CI:**

| | **Minimal** | **Standar** | **HA** |
| :--- | :--- | :--- | :--- |
| Untuk | ≤ 50 user, evaluasi | ≤ 2.000 user (target §7.1) | 10.000+ user |
| Container | app + postgres + storage(minimal) | app + postgres + storage | app ×N + postgres primer+replica + storage + load balancer |
| Real-time | satu proses | satu proses | hub per instance + `LISTEN/NOTIFY` |
| Job runner | in-process | in-process | in-process per instance (SKIP LOCKED) |
| Backup | `pg_dump` harian | WAL archiving + `pg_dump` | WAL + PITR + uji restore kuartalan |
| Target | `NFR-016` (2 vCPU / 4 GB) | `NFR-001`, `NFR-003` | `NFR-002` |

**Aturan.** Setiap profil **wajib diuji di CI** pada setiap rilis (bukan hanya profil HA). Dokumen v0 hanya menyebut `docker-compose up -d` dan Helm; tanpa profil Minimal yang benar-benar diuji di VM kecil, klaim "mudah di-deploy" tidak bisa dipertanggungjawabkan.

**Migrasi.** Maju saja (forward-only); setiap migration harus (a) kompatibel dengan versi aplikasi sebelumnya selama satu rilis (expand/contract), (b) tidak mengunci tabel besar > 5 s (`NFR-012`), (c) punya catatan rollback data. Tidak ada downgrade otomatis.

---

### ADR-017 — Batas payload `NOTIFY`: hanya pointer, bukan isi

**Status:** Diterima. **Mengoreksi ADR-006 dan ADR-008** yang menyiratkan payload delta/outbox dikirim lewat `NOTIFY`.

**Konteks (temuan validasi, `naming-and-validation.md` V8).** Diukur pada PostgreSQL nyata: `pg_notify` menerima 7.999 byte dan **gagal pada 8.000 byte** dengan `ERROR: payload string too long`. Karena `NOTIFY` dieksekusi **di dalam transaksi**, kegagalan ini bukan cuma "delta hilang" — seluruh mutasi task ikut rollback. Satu patch deskripsi panjang sudah cukup untuk memicunya.

**Keputusan.**

1. Payload `NOTIFY` **hanya** `(workspace_id, seq)` — di bawah 64 byte, tidak pernah memuat entitas.
2. Penerima (instance lain, atau klien setelah reconnect) membaca baris dari `changes` berdasarkan `seq`. `NOTIFY` adalah **bel**, bukan kurir.
3. `changes.payload` dibatasi **4 KB**, tidak boleh memuat `description`/`comment.body` (sudah berlaku di ADR-006, sekarang menjadi batas keras yang diuji).
4. Pelanggaran batas saat menulis `changes` → **500 dengan trace ID**, bukan pemotongan diam-diam. Data task tetap tersimpan; hanya delta yang gagal, dan itu terlihat.
5. Uji wajib: mutasi task dengan deskripsi 100 KB (batas §7.4) harus berhasil menyimpan dan menyiarkan delta < 4 KB.

**Konsekuensi.** Ada satu query tambahan per penerima NOTIFY (baca `changes`). Murah, dan jauh lebih aman daripada alternatif "kirim semuanya lewat NOTIFY".

---

### ADR-018 — Minimum PostgreSQL 16, UUIDv7 selalu di aplikasi

**Status:** Diterima. **Menggantikan ketetapan versi di ADR-010 dan mengoreksi ADR-011 butir 1.**

**Konteks (V9).** ADR-010 menetapkan PostgreSQL 18 karena `uuidv7()` native. Kenyataannya: lingkungan PostgreSQL yang tersedia dan paling umum di self-host masih 16/17; `uuidv7()` baru ada di 18 (rilis Sep 2025). Menetapkan minimum 18 mempersempit adopsi tanpa manfaat — karena ADR-011 memang sudah memutuskan ID dibuat di aplikasi agar tersedia sebelum commit.

**Keputusan.**

1. Minimum **PostgreSQL 16**. Diuji di 16 dan 17; 18 didukung.
2. `uuidv7()` **tidak** dipakai dari DB. Aplikasi membuat UUIDv7; ada test yang memverifikasi versi=7 dan urutan monoton dalam satu milidetik.
3. Ekstensi yang wajib tersedia: `pgcrypto` (untuk `gen_random_uuid()` bila aplikasi tidak membuat ID), `citext` (email case-insensitive), `pg_trgm` (pencarian judul toleran salah ketik). `btree_gist` tidak diperlukan.
4. Dokumen deployment wajib menyatakan versi minimum dan memeriksanya saat start (gagal cepat dengan pesan jelas, bukan error aneh di tengah jalan).

**Konsekuensi.** Kehilangan satu optimasi kecil (pembuatan ID di DB), mendapat audiens self-host yang jauh lebih besar. Ini pertukaran yang benar untuk produk yang menjual kemudahan deploy.

---

### ADR-019 — Batas pencarian teks: filter wajib, hasil dibatasi, batas dinyatakan

**Status:** Diterima. **Menajamkan ADR-005.**

**Konteks (V10).** Diukur: GIN FTS dipakai untuk istilah selektif (0,15 ms), tetapi untuk istilah yang ada di hampir semua baris planner memilih **Seq Scan** (0,7 ms pada 50 ribu baris). Biaya itu tumbuh linear terhadap jumlah baris — pada 500 ribu baris menjadi puluhan milidetik, dan pada jutaan baris melewati `NFR-006`.

**Keputusan.**

1. Setiap query pencarian **wajib** menyertakan scope tenant + tim (konsisten dengan INV-12). Pencarian lintas tenant tidak disediakan.
2. Hasil dibatasi (maks 50 per halaman, kandidat maks 5.000) dan **selalu** halaman pertama yang diprioritaskan latensinya.
3. Daftar stopword bahasa Indonesia dipakai agar istilah umum tidak menjadi query FTS yang tidak selektif.
4. Batas yang dinyatakan terbuka: pencarian istilah sangat umum pada > 500 ribu baris per tim **akan** melampaui `NFR-006`. Ini triger terukur untuk revisit ADR-005 (mesin pencari terpisah), bukan kejutan yang ditemukan di produksi.
5. Untuk pencarian judul (jalur tercepat, dipakai command palette), gunakan trigram + prefix match pada kolom judul saja — bukan FTS gabungan — agar `NFR-006` bisa dipenuhi untuk kasus 80% teratas.

---

### ADR-020 — Connection pooling wajib pada profil Standar & HA

**Status:** Diterima.

**Konteks (V11).** Lingkungan uji nyata memakai `max_connections = 60`, dengan 15 koneksi sudah terpakai sebelum aplikasi berjalan. Model koneksi "satu koneksi per request" akan menghabiskan kuota ini pada belasan pengguna konkuren, apalagi 150 (`prd.md` §7.1).

**Keputusan.**

1. **Profil Minimal:** satu instance aplikasi, pool internal dibatasi eksplisit (**maks 10 koneksi DB**), `NFR-016` tetap terpenuhi.
2. **Profil Standar & HA:** **wajib** memakai pooler (PgBouncer atau setara) dalam mode transaction. Batas koneksi aplikasi→pooler ditetapkan per instance (default 20) dan didokumentasikan.
3. Migrasi dan job latar memakai koneksi terpisah dengan kuota sendiri, agar tidak menghabiskan pool saat migrasi berjalan.
4. Konsekuensi yang dinyatakan: mode transaction **melarang** `SET` sesi, prepared statement lintas transaksi, dan advisory lock yang bergantung pada sesi. Semua kode harus mengasumsikan koneksi berpindah antar transaksi. Ini aturan pengkodean, bukan preferensi.
5. `NFR-019` ditambahkan di `prd.md`: jumlah koneksi per instance dan perilaku saat pool habis (antre dengan timeout 5 s + error yang jelas, bukan menggantung).

---

## 3. Aliran data utama

### 3.1 Mutasi task (jalur paling kritis)

```
klien: patch optimistik ke cache (frame berubah, NFR-003)
  → HTTP PATCH dengan operation_id + patch field-level (+ expected_version opsional)
  → server: authz(ADR-003) → idempotensi → versi → patch → task_events → changes → commit
  → respons: entitas kanonik + version
  → klien: rekonsiliasi
  → realtime: hub membaca changes → push delta ke pelanggan team lain (NFR-007)
```

Catatan penting: **UI tidak menunggu langkah 2–6.** Bila langkah 2–6 gagal, UI kembali ke state kanonik terakhir, dan kegagalan ditampilkan (prinsip §3.5 PRD).

### 3.2 Baca board/list

- Query selalu ter-scope `(workspace_id, team_id)` + filter; paginasi **cursor** berbasis `(sort_key, id)`, bukan offset (`INV-11`).
- Endpoint board mengembalikan ringkasan task (bukan deskripsi penuh) agar payload kecil; deskripsi dimuat saat detail dibuka.
- Cache proses (in-memory, per instance) hanya untuk data yang jarang berubah dan tidak rahasia-per-user (mis. definisi status, toggle tim). TTL pendek + invalidasi lewat `changes`.

### 3.3 Alur tulis admin (audit)

Aksi administratif (ubah permission, hapus tim, ekspor, ubah SSO) menulis `audit_events` **dalam transaksi yang sama** dengan perubahannya. Tidak ada aksi admin yang berhasil tanpa jejak audit (TC-13).

---

## 4. Observability

- **Trace:** setiap request membawa trace ID dari klien (`NFR-018`); diteruskan ke log dan query DB (diberi komentar/atribut).
- **Metrik minimum yang wajib ada sebelum R0 dirilis:** latensi per endpoint (histogram), error rate, jumlah koneksi WebSocket aktif, lag real-time (selisih waktu commit `changes` vs push), umur job tertua, koneksi pool DB terpakai, durasi query > 1 s.
- **Log:** terstruktur; **tidak boleh** memuat isi komentar/deskripsi, token, atau PII lebih dari ID. Aturan ini diuji dengan canary string di CI.
- **Audit trail untuk developer:** setiap 5xx menyertakan trace ID di UI agar pengguna bisa melaporkan satu ID, bukan cerita.

---

## 5. Model ancaman (ringkas — fokus pada yang baru diciptakan arsitektur ini)

| # | Ancaman | Vektor | Mitigasi | Uji |
| :--- | :--- | :--- | :--- | :--- |
| T1 | **Kebocoran lintas-tenant** | ID objek ditebak/dioper; query lupa filter workspace | `INV-12`, aturan repository wajib `workspace_id`, test otomatis lintas-tenant per endpoint | TC-14 |
| T2 | **Kebocoran lewat cache klien** | Browser bersama; user logout lalu user lain login; guest melihat data tim lain | Cache di memori (bukan IndexedDB), dihapus saat logout/ganti user, cache di-scope `(user, workspace)`, tidak ada cache lintas-workspace; realtime langganan per-team dan server memfilter per langganan | TC-15, TC-16 |
| T3 | **Eskalasi lewat langganan realtime** | Klien meminta langganan team yang bukan haknya | Otorisasi saat berlangganan (bukan hanya saat HTTP), dan filter per event | TC-17 |
| T4 | **Eskalasi lewat API token** | Token dibuat user dengan scope lebih besar dari haknya; token bocor | Token membawa scope eksplisit ≤ hak pembuatnya; bisa dicabut; rotasi | TC-18 |
| T5 | **Kebocoran lewat ekspor/impor** | Ekspor mencakup data di luar hak admin kompartemen; impor menulis ke tim yang tidak berhak | Ekspor hanya lingkup workspace dan tercatat di audit; impor memerlukan izin tulis per tim tujuan | TC-13 |
| T6 | **SSRF lewat integrasi keluar** | Webhook URL / URL Jira mengarah ke jaringan internal | Allowlist skema https, resolusi DNS diperiksa (tolak IP privat/link-local), timeout, tanpa redirect | TC-19 |
| T7 | **Kebocoran lewat lampiran** | Presigned URL dibagikan ke luar; lampiran berisi malware | URL berumur pendek + terikat objek; `Content-Disposition`; pemindaian opsional terdokumentasi | TC-20 |
| T8 | **Amplifikasi lewat mention/notifikasi** | Pesan massal ke seluruh workspace | Batas penerima per mention (mis. 50) + peringatan; rate limit notifikasi | TC-21 |
| T9 | **Kehilangan data lewat toggle** | Admin mematikan fitur lalu data dianggap hilang | `INV-10`: toggle tidak menghapus data; API tetap mengembalikan | TC-22 |
| T10 | **Penyalahgunaan IDOR pada checklist/komentar** | Objek anak tanpa cek induk | Semua objek anak diotorisasi lewat induknya; `INV-13` | TC-23 |

**Di luar lingkup eksplisit.** Perlindungan terhadap operator server yang berbahaya (self-host = operator memegang database), serangan fisik, dan kepatuhan regulasi spesifik per negara. Ini dinyatakan agar tidak ada ekspektasi salah.

---

## 6. Hal yang secara sadar belum diputuskan

Kejujuran tentang yang belum ada lebih berguna daripada keputusan palsu. Item di bawah **dilarang dikerjakan** sebelum ditulis ADR-nya:

1. Bentuk konkret CRDT untuk kolaborasi editor real-time (ditolak untuk R0–R2).
2. Strategi sharding horizontal bila satu workspace melebihi kapasitas satu Postgres.
3. Model harga/open-core (menyentuh ADR-014).
4. Format API versi berikutnya (v2) dan kebijakan deprecation.
5. Desain mobile native (NG-08).
6. Data residency multi-region (NG-10).

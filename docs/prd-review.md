# Review Kritis: Dokumen Cetak Biru "Next-Jira"

**Status:** Review, bukan approval.
**Verdict singkat:** Dokumen ini sangat bagus sebagai *dokumen visi & penjual ide* (pitch deck dalam bentuk teks). Ia buruk sebagai **PRD** dan **berbahaya** sebagai **cetak biru teknis**, karena beberapa keputusan arsitektur paling mahal justru ditulis sebagai "wajib sejak hari pertama" padahal belum ada dasar, dan beberapa fakta teknis di dalamnya sudah kedaluwarsa per 2026.

---

## 1. Skor per Dimensi

| Dimensi | Skor | Catatan |
| :--- | :---: | :--- |
| Kejelasan visi & positioning | 4/5 | "Kekuatan enterprise Jira + kecepatan Linear" adalah posisi yang jelas dan bisa dijual. |
| Bukti riset pengguna | 1.5/5 | Semua keluhan Jira adalah asersi tanpa satu pun data primer, kutipan wawancara, atau sumber. |
| Penyederhanaan istilah (de-Jirafication) | 3/5 | Arahnya benar, eksekusinya ada 3 tabrakan semantik yang akan jadi utang produk. |
| Model data & hierarki | 2/5 | Hierarki berubah-ubah antar bab; Goal diperlakukan sebagai milik Team sekaligus lintas Team. |
| Arsitektur teknis | 2.5/5 | Istilah teknisnya benar, tapi ini kumpulan *buzzword*, bukan desain. Tidak ada kontrak data, konflik, atau konsistensi. |
| Keamanan & kesiapan enterprise | 2/5 | SSO/Audit Log disebut, tapi justru bagian yang paling menentukan pembelian enterprise tidak dibahas. |
| Keterukuran (metrics/SLO) | 1/5 | "0 ms", "10x", "<50 ms" — tanpa definisi p95, ukuran dataset, atau kondisi pengukuran. |
| Realisme estimasi | 1/5 | Fase 1 (3 bulan) berisi ~6 bulan pekerjaan untuk tim 4–6 orang. Fase 1–3 (9 bulan) untuk menyaingi Jira Premium adalah fantasi. |

---

## 2. Yang Sudah Benar dan Harus Dipertahankan

Jangan buang bagian-bagian ini saat revisi:

1. **Positioning "kesederhanaan tanpa kehilangan kekuatan"** — itu wedge yang tepat, dan sudah dibuktikan Linear & Plane.
2. **Penolakan terhadap 7 lapis "Scheme" Jira.** Ini keluhan paling nyata dan paling mahal di dunia Jira. Menggantinya dengan *template yang menempel di team* adalah keputusan produk yang benar.
3. **Modular toggle per team (Cycles, Goals, Time Tracking, Releases, Capacity).** Ini insting terbaik di seluruh dokumen: menyelesaikan dilema "HR tidak butuh Sprint, Engineering butuh" tanpa memaksa dua produk berbeda. Pertahankan, dan naikkan dari "ide di bagian akhir" menjadi **prinsip arsitektur inti**.
4. **Command palette + inline editing + form 3 field.** Ini yang membuat Linear terasa cepat. Benar.
5. **Inbox sebagai pengganti email spam.** Benar dan sering diremehkan kompetitor.
6. **Jira importer sebagai senjata migrasi.** Benar secara strategi — tapi lihat §3.5, biayanya jauh lebih besar dari yang dokumen bayangkan.
7. **Zero-config insights.** Benar: 90% tim tidak pernah mengatur gadget Jira.

---

## 3. Kesalahan Faktual & Klaim yang Tidak Valid

### 3.1 MinIO sudah tidak layak jadi rekomendasi default (per 2026)

Dokumen merekomendasikan MinIO sebagai "alternatif S3 open-source". Kondisinya sekarang:

- Mei 2025: admin console dihapus dari Community Edition (hanya jadi object browser).
- Oktober 2025: MinIO berhenti menerbitkan image Docker resmi & binary Community Edition.
- Desember 2025: README menyatakan "maintenance mode".
- Februari 2026: README diubah menjadi "THIS REPOSITORY IS NO LONGER MAINTAINED" [2](https://www.cloudhim.com/server-setup/minio-community-edition-archived-what-to-do) [1](https://www.blocksandfiles.com/ai-ml/2025/06/19/minio-users-complain-after-admin-ui-removed-from-community-edition/1610856)

Merekomendasikan MinIO untuk produk baru yang menjual *self-hosting jangka panjang* adalah risiko supply-chain: sysadmin pelanggan tidak akan mendapat patch keamanan.

**Perbaikan:** abstraksikan ke "S3-compatible object storage", lalu tawarkan target konkret: Ceph RGW, Garage, SeaweedFS, atau langsung S3/R2. Jangan mengikat arsitektur ke satu vendor yang sedang mati.

### 3.2 Jira Importer: API yang jadi sandaran sudah dihapus

Dokumen menulis importer cukup "masukkan API Key Jira". Kenyataannya:

- `GET/POST /rest/api/3/search` di Jira Cloud sudah dihapus/diganti; endpoint baru `POST /rest/api/3/search/jql` memakai paginasi `nextPageToken` **dan tidak lagi mengembalikan total count** [2](https://github.com/felixgeelhaar/jirasdk/blob/main/MIGRATION_GUIDE.md) [3](https://github.com/dnguyenminh/Jira-MCP-Extension/issues/2)
- Deskripsi & komentar Jira v3 memakai **ADF (Atlassian Document Format)**, bukan Markdown. Konversi ADF → Markdown **lossy** (panel, table dengan merged cell, mentions, macros, embedded smart links).
- Jira Server/Data Center memakai API berbeda dan tidak punya `/search/jql`.

**Implikasi:** importer ini bukan "wizard satu klik", tapi **proyek tersendiri 2–4 bulan** dengan suite test terhadap fixture data Jira nyata, plus halaman "masalah migrasi" untuk item yang gagal dipetakan. Dokumen salah menempatkannya sebagai fitur kecil di Fase 3. Ia justru perlu **spike riset di Bulan 1**, karena struktur data importer 90% menentukan skema database Anda.

### 3.3 UUIDv7 - alasannya salah, walaupun pilihannya benar

Dokumen: *"Gunakan UUIDv7 ... untuk memudahkan sharding/partitioning nantinya."*

- Pemilihan UUIDv7 itu benar (index locality, aman dibuat di client — penting untuk optimistic UI dan mutation queue offline).
- Tapi alasannya keliru: UUIDv7 membantu **locality insert**, bukan **partitioning**. Partitioning ditentukan oleh *partition key* (`workspace_id`), bukan oleh tipe PK.
- Catatan implementasi: PostgreSQL 18 punya `uuidv7()` native beserta `uuid_extract_timestamp()` [1](https://www.postgresql.org/docs/current/release-18.html) [2](https://guidgenerator.com/uuids-in-databases/uuid-v7-in-postgresql-native-support-extensions-and-benchmarks). Ini menghapus kebutuhan library aplikasi — tapi juga menaikkan versi minimum Postgres yang harus didukung. Dokumen tidak menyebut versi minimum apa pun.

### 3.4 "Wajib Table Partitioning sejak awal" — premature optimization yang justru berbahaya

Kalimatnya: *"Wajib menggunakan Table Partitioning (berdasarkan ID Organisasi/Workspace) karena jumlah Task akan mencapai jutaan baris."*

- Jutaan baris **bukan** masalah untuk PostgreSQL. Itu nyaman tanpa partisi, dengan composite index yang benar (`(workspace_id, team_id, status, updated_at)`).
- Partisi berdasarkan `workspace_id` merusak query lintas-workspace (dashboard admin, reindex search, analytics, importer) dan menyulitkan uniqueness constraint global.
- Partisi yang ditambahkan belakangan = migrasi tabel besar = downtime, yang bertentangan dengan janji "docker-compose up -d".
- Partitioning baru relevan di puluhan juta baris **atau** saat butuh retensi/drop data cepat (mis. `activity_logs` per bulan). Itu kasus `activity_logs`, bukan `tasks`.

**Perbaikan:** tulis sebagai keputusan bertahap — "desain kolom partition key sejak awal, **aktifkan partisi hanya untuk `activity_logs`** (per bulan), dan siapkan runbook untuk partisi `tasks` bila >50 juta baris."

### 3.5 Klaim angka 85–90% / 100% paritas

Tidak ada satu pun metodologi. Tidak ada definisi "nilai fungsional", tidak ada bobot per fitur, tidak ada sample pengguna. Angka seperti `✅ 100% Ada (Fase 1 & 2)` untuk "Scrum & Kanban Boards" adalah **self-assessment yang tidak bisa diverifikasi** — dan untuk stakeholder teknis, tabel itu salah satu hal yang paling merusak kredibilitas dokumen.

Hal yang sama untuk:
- *"UX dan kecepatan 10x lipat"* — 10x dari apa, diukur bagaimana?
- *"0 milidetik"* — tidak ada UI yang 0 ms. Yang bisa dijanjikan: **p95 interaction latency < 100 ms** (optimistic) dan **p95 API < 200 ms**.
- *"pencarian jutaan task di bawah 50 ms"* — tanpa menyebut jumlah dokumen, jumlah filter, dan jumlah tenant.

**Perbaikan:** ganti semua persentase dengan **peta fitur + status jujur** (`sudah ada / setara / lebih sederhana / belum ada / sengaja tidak dibuat`), dan ganti semua angka performa dengan **SLO yang bisa diuji**.

### 3.6 "SSO tidak gratis di Jira Premium"

Arahnya benar (SAML SSO untuk Jira Cloud memang butuh Atlassian Guard sebagai add-on berbayar), tapi kalimat "**Unggul!**" mengabaikan biaya nyata: SSO self-hosted bukan gratis juga — Anda harus mendukung SAML, OIDC, SCIM provisioning, dan *break-glass admin*. Dokumen tidak pernah menyebut **SCIM**, padahal untuk 10.000 karyawan, provisioning/deprovisioning otomatis adalah **syarat lolos procurement**, bukan fitur nice-to-have.

---

## 4. Masalah Arsitektur yang Serius

### 4.1 Kontradiksi inti: "Local-first" vs "optimistic UI" — dokumen tidak memilih

Ini kelemahan terbesar dokumen. Ia menulis:

> *"Tirulah arsitektur Linear atau Figma ... IndexedDB ... UI berubah instan ... baru mengirim data ke server"*

lalu di tech stack menulis:

> *"TanStack Query / RxDB"*

**TanStack Query dan RxDB bukan pilihan yang setara.** TanStack Query = cache HTTP dengan invalidasi; RxDB = sync engine penuh dengan replikasi, konflik, dan skema lokal. Biayanya berbeda satu orde besaran.

Yang juga tidak diakui: Linear memang membangun **sync engine in-house** (partial sync, delta bootstrap, mutation queue, resolusi konflik) — itu kerja bertahun-tahun, dan menyentuh *setiap* fitur [1](https://www.reddit.com/r/nextjs/comments/1ote6ss/how_to_achieve_snappy_instant_experience_like_in/) [2](https://shivekkhurana.com/blog/sync-engines/). Untuk Fase 1 yang diberi jatah 3 bulan, itu tidak mungkin.

**Rekomendasi tegas:**

| Tahap | Pendekatan | Biaya |
| :--- | :--- | :--- |
| Fase 1 | Optimistic mutation (TanStack Query) + WebSocket *invalidation* (kirim `entity_id + version`, klien refetch) | Rendah, cukup untuk klaim "tanpa spinner" |
| Fase 2 | Tambahkan delta sync per-team (bootstrap snapshot + cursor `updated_at`), tetap bukan offline penuh | Sedang |
| Fase 3+ | Evaluasi sync engine siap pakai (Zero, ElectricSQL, PowerSync) **atau** in-house, dengan ADR tertulis | Tinggi |

**Jangan menulis "local-first" di PRD kalau tidak siap membiayainya.** Ini akan jadi janji yang tidak bisa ditepati ke pengguna awal.

### 4.2 Cache lokal + RBAC = risiko kebocoran data (tidak disinggung sama sekali)

Ini kritik paling tajam untuk dokumen ini. Kalau klien mengunduh sebagian data ke IndexedDB:

- Filtering permission harus terjadi **saat bootstrap dan saat delta sync**, bukan hanya di lapisan API.
- Data harus **dihapus dari IndexedDB saat user dicabut aksesnya** (login sebagai user lain di browser yang sama, atau device bersama).
- Fase 3 menyebut **Guest/Viewer eksternal (klien)**. Guest + cache lokal = jalan pintas kebocoran data antar-tenant.

Dokumen menjual "aman untuk 10.000 karyawan" tapi mendesain arsitektur yang punya kelas bug baru khusus untuk kebocoran data.

**Perbaikan:** tambahkan seksi "Permission-aware caching": scope lokal = `(user_id, workspace_id)`, eviction on logout, tidak ada cache lintas-workspace, dan uji otomatis "cache poisoning".

### 4.3 Real-time: WebSocket + Redis Pub/Sub bukan arsitektur, hanya transport

Yang hilang dari dokumen:

1. **Redis Pub/Sub tidak durable.** Klien yang putus 5 detik kehilangan event selamanya. Anda butuh endpoint *resync* / cursor per entity (`version` / `updated_at`), atau beralih ke Redis Streams / NATS JetStream.
2. **Kebijakan konflik tidak ada.** Dua orang mengedit deskripsi yang sama — hasilnya apa? Perlu keputusan eksplisit: *field-level last-write-wins* dengan `updated_at` + `version` (paling murah), atau CRDT untuk editor (mahal). Dokumen tidak menyebut konflik sama sekali — padahal ini pertanyaan pertama setiap engineer yang membaca "real-time".
3. **Idempotensi mutation queue.** Optimistic UI + offline queue tanpa `operation_id` akan menghasilkan duplikat saat retry.
4. **Ordering.** Tanpa sequence number per workspace, urutan event bisa terbalik antar pod.
5. **Fan-out.** 50 orang membuka board yang sama = 50 koneksi; untuk 10.000 karyawan, hitung kebutuhan koneksi WebSocket per pod dan strategi reconnect storm (thundering herd saat deploy).
6. **Presence / "sedang dilihat Budi"** tidak dibahas, padahal itu yang membuat aplikasi kolaboratif terasa hidup.

### 4.4 Search engine: konsistensi dan multi-tenancy tidak dibahas

- Meilisearch "di bawah 50 ms" untuk jutaan dokumen **multi-tenant dengan filter permission** hampir pasti butuh index per tenant, atau filterable attributes yang sangat besar. Itu tidak gratis dari sisi RAM (Meilisearch berbasis memory-mapped index).
- **Eventual consistency:** berapa detik task baru muncul di hasil pencarian? Command palette (`Ctrl+K`) bergantung pada search ini — kalau user membuat task lalu mencari namanya, dan belum terindeks, itu bug yang sangat terlihat.
- Menambah search engine = **sumber kebenaran kedua** + pipeline reindex + biaya operasional untuk self-hoster (satu container lagi di `docker-compose`).

**Rekomendasi:** Fase 1–2 cukup **PostgreSQL FTS + `pg_trgm`** (sanggup untuk ratusan ribu task, zero infra tambahan, transaksional sehingga selalu konsisten), baru pindah ke Meilisearch/OpenSearch bila ada data yang membuktikan bottleneck. Dokumen menempatkan search engine di Fase 2 sebagai keharusan — itu terlalu cepat.

### 4.5 Read replica tidak menyelesaikan masalah yang disebutkan

Dokumen: *"memisahkan database untuk membaca dan menulis agar tidak terjadi bottleneck saat ribuan orang bekerja di jam 9 pagi."*

Pada aplikasi kolaboratif, beban jam 9 pagi adalah **write contention** (row lock pada task yang sama, insert activity log, fan-out notifikasi) dan **koneksi**, bukan volume read. Read replica juga menambah bug *read-your-own-writes* (user menyimpan task, refresh, task hilang — karena replika tertinggal). Dokumen tidak menyebut satu pun solusi untuk write path: connection pooling (PgBouncer), batching activity log, atau partisi `activity_logs`.

### 4.6 Tidak ada satu pun non-functional requirement yang bisa diuji

Tidak ada: SLO availability, RPO/RTO backup, target upgrade path, batas ukuran lampiran, retensi audit log, batas rate limit, ukuran dataset acuan (berapa task/workspace untuk klaim performa), atau target browser/mobile.

Tanpa ini, "siap enterprise" hanya slogan.

---

## 5. Masalah Produk & Model Data

### 5.1 Tiga tabrakan semantik di tabel "De-Jirafication"

**(a) `Issue Type → Label` — ini kesalahan paling mahal.**

Jira memisahkan **Type** (menentukan workflow, field wajib, ikon, kategori laporan) dari **Label** (tag bebas). Meleburnya jadi satu menghilangkan kemampuan "Bug punya alur berbeda dari Feature", yang justru kebutuhan inti tim software — pembeli utama Anda.

Buktinya ada di dokumen sendiri: Fase 3 menambahkan *Custom Fields* dan *Template tim*. Begitu Anda butuh field wajib untuk tipe tertentu, **Issue Type akan lahir kembali** — tapi kali ini sebagai tambalan di atas model label, bukan sebagai konsep bersih.

**Perbaikan:** pertahankan dua konsep, beri nama manusiawi: `Kategori` (kaku, 3–4 nilai: Task / Bug / Permintaan / Insiden, menentukan workflow opsional) dan `Label` (bebas, berwarna).

**(b) `Epic → Goal / Milestone` — dua konsep berbeda disamakan.**

Milestone = **titik waktu** (tanggal rilis). Epic/Goal = **wadah pekerjaan**. Menyatukan keduanya membuat "Goal tanpa tanggal" dan "Milestone tanpa isi" jadi ambigu. Pilih **Goal** saja; milestone bisa jadi properti tanggal pada Goal.

**(c) `Backlog → Inbox` — bertabrakan dengan fitur lain di dokumen yang sama.**

Bab 2: `Backlog → Inbox / Antrean`.
Fase 2: **"Inbox (Pusat Notifikasi Cerdas)"**.

Satu kata, dua konsep yang sama sekali berbeda, dalam satu dokumen. Ini yang akan terjadi di UI: user bingung antara "antrean kerja" dan "kotak notifikasi".

**Perbaikan:** Backlog → **Backlog** atau **Antrean**. Notifikasi → **Inbox** (pakai untuk satu hal saja).

Tambahan: `Components → Sub-Team / Modul` diperkenalkan lalu **hilang total** dari model data Fase 1–3. Fitur yang dijanjikan tapi tidak pernah dibangun.

### 5.2 Hierarki tidak konsisten — dan ini memblokir skema database

- Bab 3A: `Workspace → Team → Goal → Task → Sub-task`.
- Fase 2: Goal *"bisa lintas tim"*.
- Bagian akhir (fitur yang belum ada): menyarankan **nested Goals** (Goal di dalam Goal).

Ketiganya tidak bisa benar bersamaan. Kalau Goal milik Team tapi berisi Task dari Team lain, siapa yang boleh mengedit? Siapa yang muncul di laporan Team?

**Perbaikan (harus diputuskan sebelum menulis DDL):**

```
Workspace
├── Team            (unit kepemilikan kerja & permission)
├── Goal            (milik WORKSPACE, boleh menyentuh banyak Team, boleh punya parent Goal)
└── Task            (milik satu Team, boleh dikaitkan ke nol/beberapa Goal)
```

Dengan kata lain: **Goal bukan milik Team.** Dokumen harus menyatakannya eksplisit, karena ini menentukan tabel join dan aturan RBAC.

### 5.3 Sub-task = checklist, tapi juga punya assignee + status → itu Task

Dokumen: *"Sub-tasks: Bisa dibuat langsung di dalam Task seperti membuat checklist, namun setiap item bisa diberi Assignee dan Status sendiri."*

Itu bukan checklist. Itu **Issue dengan hierarki**, yaitu hal yang baru saja Anda klaim ingin disederhanakan. Bahkan Jira membatasi sub-task satu level.

**Perbaikan:** pilih salah satu dan tulis batasnya — (a) checklist murni: hanya teks + centang, atau (b) sub-task satu level dengan assignee/status, tapi **tidak bisa punya sub-task lagi dan tidak muncul sebagai kartu di board**. Jangan biarkan ambigu.

### 5.4 Dependency: konsepnya ditulis salah

> *"Cukup dua status: 'Menunggu (Blocked by)' dan 'Menghambat (Blocking)'"*

Itu **bukan dua status**, itu **dua sisi dari satu relasi berarah**. "Task A blocked-by B" identik dengan "B blocks A". Menyebutnya dua status akan menghasilkan bug duplikasi relasi sejak hari pertama.

Yang juga tidak dibahas: **deteksi siklus** (A menghambat B menghambat C menghambat A), dan apa yang terjadi bila task penghambat dibatalkan/dihapus.

### 5.5 Auto-rollover Cycle vs Velocity/Burndown — kontradiksi metodologi

Fase 2: *"otomatis memindahkan Task yang belum selesai ke Cycle berikutnya (Auto-rollover). Tidak ada lagi ritual penutupan Sprint."*
Fase 3: *"Team Velocity ... Burnup/Burndown Chart ... melihat apakah Cycle akan selesai tepat waktu."*

Kalau scope terus mengalir otomatis tanpa penutupan, **velocity jadi tidak bermakna** (penyebutnya berubah: committed scope tidak pernah difiksasi) dan **burndown kehilangan baseline**. Anda menjual metrik manajemen, lalu merancang proses yang membuat metrik itu tidak bisa dipercaya.

**Perbaikan:** rollover otomatis **boleh**, tapi sistem harus tetap mencatat **snapshot scope di awal Cycle** dan **scope yang dibawa (carried over)** secara terpisah. Bedakan "velocity" (hanya item yang selesai di dalam cycle asalnya) dari "throughput". Dokumen perlu satu paragraf tentang definisi metrik — ini yang diminta CTO/VP, dan jawabannya bukan grafik, tapi **definisi**.

### 5.6 Insights "zero-config" butuh event log, bukan tabel `tasks`

Burndown/burnup/cycle-time/lead-time **tidak bisa dihitung dari state saat ini**. Anda butuh riwayat transisi status per task (kapan masuk `In Progress`, kapan `Done`, berapa kali bolak-balik). Kalau hanya menyimpan `status` + `updated_at`, semua grafik itu mustahil atau salah.

Dokumen menyebut `activity_logs` hanya sebagai beban partisi, bukan sebagai **sumber data metrik**. Perlu satu tabel eksplisit (`task_status_transitions` atau event stream append-only) sejak Fase 1 — kalau tidak, Fase 3 akan memaksa backfill yang datanya sudah hilang permanen.

**Ini adalah perubahan skema yang harus masuk Fase 1, bukan Fase 3.**

### 5.7 RBAC punya dua definisi berbeda dalam satu dokumen

- Bab 5C.2: *"Cukup 4 Role per proyek: Admin, Member, Commenter, Viewer."*
- Fase 3: *"RBAC Sederhana (4 Peran): Workspace Admin, Team Admin, Member (Edit), Guest/Viewer."*

Dua model otorisasi berbeda (per-project vs per-workspace+team, dengan `Commenter` hilang di versi kedua). Untuk sebuah PRD, ini bukan detail kecil — ini menentukan desain tabel `memberships` dan seluruh middleware.

**Perbaikan:** definisikan matriks permission eksplisit (baris = peran, kolom = aksi), dengan dua tingkat keanggotaan (`workspace_role`, `team_role`) dan satu daftar aksi yang bisa diuji.

### 5.8 AI search: bertentangan dengan nilai jual privasi, dan buruk untuk filter berulang

*"Pengguna mengetik 'Tugas Budi yang telat minggu ini', sistem otomatis memfilter."*

- **Privasi:** produk ini menjual "self-hosted, aman untuk enterprise". Mengirim isi task/query ke API LLM pihak ketiga membatalkan itu. Dokumen tidak menyebut apakah LLM lokal, data apa yang dikirim, atau bagaimana opt-out. Untuk pembeli enterprise, satu kalimat "data Anda dikirim ke vendor AI" bisa menggugurkan seluruh deal.
- **Determinisme:** filter yang dipakai berulang (mis. "Bug saya yang urgent") tidak boleh berubah hasilnya karena model menghalusinasi. Pola yang benar: **AI mengusulkan filter → user melihat chip filter yang eksplisit → user menyimpan sebagai Custom View.** AI tidak boleh menjadi jalur eksekusi langsung.

### 5.9 Fitur penting yang absen total

Daftar ini sama pentingnya dengan daftar fitur yang ada, dan tidak satu pun muncul di 3 fase:

| Yang hilang | Kenapa krusial |
| :--- | :--- |
| **Mobile / PWA** | 10.000 karyawan akan menuntut ini di minggu pertama. Nol kata tentang ini di seluruh dokumen. |
| **SCIM provisioning** | Syarat procurement enterprise untuk 1000+ user; tanpa ini, deprovisioning manual = risiko keamanan. |
| **Export data / portability** | Anda menjual "tidak terkunci seperti Jira" — tapi tidak ada fitur ekspor. Audit log bahkan menyebut "siapa mengunduh data" untuk fitur yang tidak pernah didefinisikan. |
| **Upgrade path self-hosted** | Biang kerok produk self-hosted: migrasi DB antar versi. Tidak disebut sama sekali. |
| **Backup/restore + RPO/RTO** | Alasan nomor satu perusahaan besar tidak memakai tool self-hosted kecil. |
| **i18n / lokalisasi** | Dokumen ditulis dalam Bahasa Indonesia untuk pasar Indonesia, tapi UI hanya diasumsikan Inggris. |
| **Aksesibilitas (WCAG 2.2 AA)** | Sering jadi blocker procurement; juga bertentangan dengan klaim "bisa dipakai tim HR/Legal". |
| **Keamanan lampiran** | Signed URL, scan malware, batas ukuran, retensi. |
| **Notifikasi email yang bisa dikirim** | Deliverability SMTP (SPF/DKIM) untuk self-host adalah masalah nyata; "inbox menggantikan email" tetap butuh email untuk mention. |
| **Onboarding / data awal** | Apa yang dilihat user pertama kali? Empty state adalah tempat produk mati. |
| **Biaya & ukuran tim** | Tidak ada estimasi tim, biaya infra, atau model bisnis. Siapa yang membayar pengembangan bulan ke-10? |

---

## 6. Masalah Strategi & Eksekusi

### 6.1 Timeline 9 bulan tidak realistis

Fase 1 dalam dokumen berisi: auth (email + magic link + 2 OAuth), workspace, teams, task CRUD dengan rich text (tabel, code block, drag-drop upload), sub-task dengan assignee, kanban, list, komentar dengan mention + reaction, activity stream, command palette, optimistic UI, WebSocket + Redis, MinIO, desain skema UUIDv7, dan Docker Compose.

Itu **minimum 9–12 bulan untuk tim 4–6 orang yang sudah berpengalaman**, dan belum termasuk bug, deployment, dan dokumentasi. Referensi nyata: Plane sudah punya 62 ribu bintang GitHub dan dibangun bertahun-tahun oleh tim puluhan orang [1](https://api.github.com/repos/makeplane/plane); Huly bahkan memilih EPL-2.0 dan butuh bertahun-tahun.

**Perbaikan:** potong Fase 1 menjadi **"satu tim, satu board, task + komentar, cepat"** dalam 6–8 minggu. Yang dihapus dari Fase 1 (bukan dihapus dari produk): reaction, activity stream lengkap, list view advanced, magic link, MinIO (pakai disk lokal dulu), Redis (pakai Postgres LISTEN/NOTIFY dulu).

### 6.2 Tech stack belum diputuskan — padahal ini PRD, bukan menu

*"Opsi 1: Go. Opsi 2: NestJS."* PRD yang baik **memutuskan** dan mencatat alasannya. Argumen "Node.js punya komunitas OSS terbesar untuk kontributor" lemah: Huly dan Plane sama-sama TypeScript-heavy, dan kontributor Go untuk proyek devtool juga besar.

**Kriteria yang seharusnya dipakai:** bahasa yang dikuasai tim saat ini, ketersediaan talenta di pasar target Anda, dan apakah satu bahasa untuk frontend+backend menurunkan biaya (TypeScript end-to-end = tipe bersama untuk model Task — keuntungan nyata untuk produk dengan model data kompleks).

### 6.3 `docker-compose up -d` untuk 8 service ≠ mudah

Auth + Postgres + Redis + Meilisearch + MinIO + worker + backend + frontend = 8 container. Untuk sysadmin yang tidak punya tim platform, itu bukan "satu perintah", itu **enam keputusan konfigurasi dan satu sumber kegagalan baru**. Dokumen tidak menyebut kebutuhan RAM/CPU minimum, atau opsi "single-binary / monolith mode" untuk deployment kecil.

### 6.4 Lisensi: dokumen menyarankan AGPL, repo ini MIT

`LICENSE` di repo ini adalah **MIT** (`Copyright (c) 2026 btx-core`), sementara dokumen mempertimbangkan AGPLv3 untuk mencegah hyperscaler.

Ini bukan detail: **relicensing setelah ada kontributor luar hampir tidak mungkin** tanpa CLA. Keputusan harus diambil **sekarang**, sebelum commit publik pertama, bukan di Fase 3. Dokumen juga tidak membahas **open-core** (bagaimana proyek dibiayai kalau fitur enterprise gratis?) — pertanyaan yang menentukan apakah proyek ini hidup di tahun kedua.

### 6.5 Tidak ada strategi go-to-market

"Open-source, ratusan ribu bintang, perusahaan pindah dari Jira" bukan strategi. Yang tidak dijawab: siapa 10 pengguna pertama? Dari mana migrasi pertama datang? Bagaimana mengalahkan Plane yang sudah ada dan gratis? Apa yang membuat orang memilih proyek tanpa komunitas dibanding Plane yang punya 62 ribu bintang?

---

## 7. Yang Harus Diperbaiki, Berurut Prioritas

### P0 — Putuskan sebelum menulis satu baris kode

1. **Pilih satu arsitektur data klien.** Optimistic UI (murah) vs sync engine (mahal). Tulis ADR-nya.
2. **Tetapkan hierarki final**: Goal milik Workspace, Task milik Team, sub-task maksimal 1 level.
3. **Satu definisi RBAC** dengan matriks permission yang bisa diuji.
4. **Putuskan lisensi dan model bisnis** (MIT/open-core/AGPL) sekarang.
5. **Rancang tabel riwayat transisi status di Fase 1** — tanpa ini, seluruh Fase 3 metrics mustahil.

### P1 — Perbaiki dokumen

6. Ganti semua persentase paritas dengan **peta fitur berstatus jujur**. Hapus "100%", "10x", "85–90%" kecuali ada metodologi.
7. Ganti semua klaim performa dengan **SLO terukur** (p95, ukuran dataset, kondisi).
8. Perbaiki tabel istilah: pisahkan `Kategori` dan `Label`; hapus "Milestone" sebagai sinonim Goal; jangan pakai "Inbox" untuk dua hal.
9. Tulis **seksi konflik & konsistensi** (LWW per field, `version`, idempotency key, resync endpoint).
10. Ganti MinIO dengan "S3-compatible" + daftar target; turunkan Meilisearch & Redis dari "wajib sejak awal" ke "aktifkan saat ada bukti".
11. Tulis seksi **keamanan cache klien** (permission-aware, eviction, no cross-workspace).
12. Tambahkan **non-goals** — hal yang secara sadar TIDAK akan dibangun (mis. tidak ada portfolio/OKR penuh, tidak ada multi-level sub-task, tidak ada workflow engine bebas).

### P2 — Perbaiki rencana

13. Ubah fase berdasarkan **bukti**, bukan tanggal: "Fase 1 selesai bila 1 tim nyata memakai board ini 2 minggu berturut-turut", bukan "Bulan 1–3".
14. Jadikan **Jira importer sebagai spike riset di Bulan 1**, karena hasilnya menentukan skema.
15. Tambahkan estimasi **tim, peran, dan biaya infra** per fase.
16. Pindahkan "modular toggle per team" dari lampiran ide ke **prinsip inti** di bab 1.

---

## 8. Ringkasan Satu Paragraf

Dokumen ini punya **visi yang benar dan insting produk yang sering tepat** (menolak scheme berlapis, toggle per tim, inbox, command palette), tapi ia **belum layak disebut PRD**: tidak ada persona dengan bukti, tidak ada non-goals, tidak ada acceptance criteria, tidak ada SLO, dan tidak ada definisi metrik — sementara beberapa klaim teknisnya (MinIO, Jira search API, "wajib partitioning", "SSO lebih unggul") sudah kedaluwarsa atau terlalu percaya diri. Kelemahan paling serius bukan pada daftar fitur, melainkan pada **tiga keputusan fondasi yang dibiarkan menggantung**: local-first vs optimistic UI, hierarki Goal/Team, dan satu-satunya definisi RBAC. Ketiganya murah diputuskan sekarang dan sangat mahal diubah setelah 6 bulan. Angka "100% paritas Jira Premium dalam 9 bulan" sebaiknya dihapus dari dokumen sebelum ada engineer yang mempercayainya.

---

## 9. Sumber Verifikasi

- MinIO Community Edition tidak dirawat lagi, image Docker dihentikan, console admin dihapus: [cloudhim.com](https://www.cloudhim.com/server-setup/minio-community-edition-archived-what-to-do), [blocksandfiles.com](https://www.blocksandfiles.com/ai-ml/2025/06/19/minio-users-complain-after-admin-ui-removed-from-community-edition/1610856)
- Jira Cloud `/rest/api/3/search` dihapus → `/rest/api/3/search/jql` dengan `nextPageToken`, tanpa `total`: [jirasdk migration guide](https://github.com/felixgeelhaar/jirasdk/blob/main/MIGRATION_GUIDE.md), [issue 410 Gone](https://github.com/dnguyenminh/Jira-MCP-Extension/issues/2)
- PostgreSQL 18 `uuidv7()` native: [postgresql.org release 18](https://www.postgresql.org/docs/current/release-18.html), [benchmark & ext](https://guidgenerator.com/uuids-in-databases/uuid-v7-in-postgresql-native-support-extensions-and-benchmarks)
- Linear memakai sync engine in-house (bukan optimistik biasa): [diskusi reverse-engineering](https://www.reddit.com/r/nextjs/comments/1ote6ss/how_to_achieve_snappy_instant_experience_like_in/), [sync engine contract](https://shivekkhurana.com/blog/sync-engines/)
- Skala proyek pembanding (Plane ±62k stars, lisensi AGPLv3): GitHub API `makeplane/plane`

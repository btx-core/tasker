# Model Data: Kamus Data Siap-DDL (R0, dengan forward-compat R1–R2)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Tujuan:** dokumen ini memuat **semua** keputusan skema sehingga penulisan migration menjadi transkripsi mekanis, bukan desain. Tidak ada kode di sini; bentuknya kamus data (nama, tipe, nullability, default, constraint, index, invariant).

**Cara pakai.** Setiap entitas punya: tujuan, kolom (tabel), constraint, index (dengan alasan), dan invariant. Bila implementasi membutuhkan kolom yang tidak ada di sini, **ubah dokumen ini lebih dulu** — bukan menambah kolom diam-diam.

---

## 1. Prinsip Skema

| # | Prinsip | Konsekuensi konkret |
| :--- | :--- | :--- |
| S1 | **Satu sumber kebenaran** (Postgres). Tidak ada tabel yang "nanti disinkronkan ke search engine". | Pencarian memakai indeks Postgres (ADR-005). |
| S2 | **`workspace_id` wajib pada semua tabel milik tenant**, walau redundan. | Index komposit selalu diawali `workspace_id`. Isolasi tenant bisa ditegakkan tanpa join (ADR-012). |
| S3 | **PK `uuid` v7**, dibuat seragam oleh satu mekanisme (diputuskan: **aplikasi** membuat UUIDv7, bukan default kolom). Minimum **PostgreSQL 16** (ADR-018) — `uuidv7()` native PG 18 sengaja tidak dipakai. | Alasan: ID tersedia sebelum commit (optimistic UI, `changes`, outbox), pengujian unit tidak butuh DB, dan audiens self-host di 16/17 tidak dikecualikan. Ada test yang memverifikasi version=7. |
| S4 | **Enum tidak dipakai sebagai tipe Postgres.** Nilai tetap disimpan sebagai `smallint` + CHECK, dengan peta nilai di dokumen ini. | `ALTER TYPE … ADD VALUE` tidak bisa dibatalkan dan menyulitkan rollback migrasi. |
| S5 | **Waktu:** semua `timestamptz`, disimpan dalam UTC. Tidak ada kolom tanggal tanpa zona untuk data sistem. Tanggal jatuh tempo adalah `date` (tanggal kalender, disengaja tanpa zona). | Menghindari bug DST pada due date. |
| S6 | **Soft delete hanya untuk entitas berisi pekerjaan** (task, komentar, goal, tim, workspace). Relasi dan event tidak di-soft-delete. | `NFR-013`. |
| S7 | **Append-only untuk riwayat** (`task_events`, `audit_events`, `changes`). Tidak ada UPDATE/DELETE. | ADR-004, ADR-006. |
| S8 | **Tidak ada `ON DELETE CASCADE` pada data yang diaudit.** Penghapusan adalah operasi eksplisit dengan urutan yang ditulis di §6. | Mencegah kehilangan riwayat tak sengaja. |
| S9 | **Constraint ditegakkan di DB, bukan hanya aplikasi.** Bila sebuah aturan bisa dinyatakan sebagai CHECK/UNIQUE/FK, ia harus ada di DB. | Aplikasi punya bug; DB adalah pertahanan terakhir. |
| S10 | **Semua DDL di dokumen ini sudah dieksekusi minimal sekali pada PostgreSQL nyata** (17.11), kecuali yang ditandai belum. | Mencegah "desain yang tidak bisa dibuat". Lihat `naming-and-validation.md` §2 untuk hasil per asumsi. |

---

## 2. Keputusan Model yang Menyimpang dari v0 (dan alasannya)

| # | v0 | Keputusan v1 | Alasan |
| :--- | :--- | :--- | :--- |
| M1 | Assignee "1 orang atau lebih" | **Satu assignee** (`tasks.assignee_id`) pada R0–R2; penanggung jawab tambahan = kolom "pengikut" (follower) tanpa hak edit khusus | Multi-assignee menggandakan ambiguitas pada metrik (siapa yang dihitung beban kerjanya?), notifikasi, dan filter. Bila dibutuhkan, ADR baru + tabel `task_assignees`. |
| M2 | Epic → Goal/Milestone | Goal saja; milestone = properti tanggal | Dua konsep berbeda dipisah (lihat `prd.md` §9). |
| M3 | Issue Type → Label | **Kategori** (4 nilai tetap, tabel terpisah dari label) | PRD §9, FR-307 membutuhkan field wajib per kategori. |
| M4 | Sub-task berstatus | `checklist_items` tanpa status | NG-05. |
| M5 | Dependency = "dua status" | **Satu tabel relasi berarah** | v0 akan menduplikasi relasi. |
| M6 | Partitioning `tasks` berdasarkan workspace sejak awal | **Tidak ada partisi pada R0–R2**; partisi hanya untuk `task_events`/`changes` bila ambang terlampaui | Jutaan baris bukan masalah; partisi dini merusak query lintas-tenant dan menambah biaya migrasi. |
| M7 | `activity_logs` generik | **`task_events`** (atribut task, untuk metrik) + **`audit_events`** (administratif, untuk kepatuhan) | Volume, pembaca, dan retensi berbeda (ADR-004). |

---

## 3. Katalog Entitas

Legenda fase: **R0** = wajib di migration pertama. **R1/R2** = tabel belum dibuat, tetapi kolom penghubung yang murah sudah disiapkan di R0 agar tidak perlu menulis ulang data.

| ID | Entitas | Fase | Tujuan |
| :--- | :--- | :--- | :--- |
| ENT-01 | `workspaces` | R0 | Batas tenant. |
| ENT-02 | `users` | R0 | Identitas global (lintas workspace). |
| ENT-03 | `workspace_members` | R0 | Peran user di workspace. |
| ENT-04 | `teams` | R0 | Unit kerja & permission; pemegang toggle fitur. |
| ENT-05 | `team_members` | R0 | Peran user di tim. |
| ENT-06 | `team_keys` | R0 | Penomoran manusiawi (`ENG-123`) + counter. |
| ENT-07 | `statuses` | R0 | Status per tim di dalam 5 kategori tetap. |
| ENT-08 | `tasks` | R0 | Unit kerja. |
| ENT-09 | `labels` | R0 | Tag bebas per tim. |
| ENT-10 | `task_labels` | R0 | Relasi task↔label. |
| ENT-11 | `checklist_items` | R0 | Pemecahan task tanpa status. |
| ENT-12 | `comments` | R0 | Diskusi pada task. |
| ENT-13 | `comment_revisions` | R0 | Riwayat edit komentar (agar "diedit" bisa dibuktikan). |
| ENT-14 | `attachments` | R0 | Metadata lampiran (byte di object storage). |
| ENT-15 | `task_events` | R0 | **Riwayat transisi append-only — prasyarat seluruh metrik.** |
| ENT-16 | `audit_events` | R0 | Jejak administratif & keamanan. |
| ENT-17 | `changes` | R0 | Log delta real-time ber-`seq`. |
| ENT-18 | `sessions` | R0 | Sesi login & pencabutan. |
| ENT-19 | `idempotency_keys` | R0 | Idempotensi mutasi (ADR-015). |
| ENT-20 | `jobs` | R0 | Outbox/antrean latar (ADR-008). |
| ENT-21 | `goals` | R1 | Wadah kerja lintas tim. |
| ENT-22 | `cycles` | R1 | Siklus kerja + snapshot scope. |
| ENT-23 | `cycle_scope` | R1 | Snapshot scope awal cycle (definisi metrik §8.2 PRD). |
| ENT-24 | `task_dependencies` | R1 | Relasi berarah. |
| ENT-25 | `saved_views` | R1 | Filter tersimpan. |
| ENT-26 | `notifications` | R1 | Kotak masuk. |
| ENT-27 | `api_tokens` | R1 | Token API publik. |
| ENT-28 | `custom_fields` + `task_custom_values` | R2 | Field per tim. |
| ENT-29 | `time_entries` | R2 | Time tracking (toggle). |
| ENT-30 | `guest_grants` | R2 | Akses guest terbatas. |
| ENT-31 | `imports` | R0 | Riwayat impor + laporan L1–L5 sebagai artefak produk (`import-contract.md` §6). |

---

## 4. Definisi Tabel (R0)

Format kolom: `nama — tipe — null? — default — catatan`.

### ENT-01 `workspaces`

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app: uuidv7) | PK |
| `name` | text | tidak | — | 1–80 karakter |
| `slug` | text | tidak | — | unik global, 3–40, `[a-z0-9-]` |
| `created_at` | timestamptz | tidak | now() | |
| `updated_at` | timestamptz | tidak | now() | |
| `version` | integer | tidak | 1 | ADR-015 |
| `seq_next` | bigint | tidak | 1 | counter delta real-time (ENT-17); satu-satunya penjaga urutan per workspace |
| `deleted_at` | timestamptz | ya | null | soft delete 30 hari (`NFR-013`) |
| `settings` | jsonb | tidak | `'{}'` | Hanya preferensi non-kritis (mis. format tanggal). **Tidak** untuk data yang difilter/otorisasi. |

**Constraint:** `slug` UNIQUE (parsial, hanya baris `deleted_at IS NULL`) agar slug bisa dipakai ulang setelah workspace dihapus.
**Index:** `(deleted_at)` parsial untuk job purge.

---

### ENT-02 `users`

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK |
| `email` | citext | tidak | — | unik; normalisasi lowercase |
| `email_verified_at` | timestamptz | ya | null | |
| `display_name` | text | tidak | — | 1–100 |
| `password_hash` | text | ya | null | Argon2id; null bila hanya SSO/OAuth (R2) |
| `avatar_url` | text | ya | null | |
| `locale` | text | tidak | `'id-ID'` | i18n |
| `timezone` | text | tidak | `'Asia/Jakarta'` | IANA; untuk batas hari pada due date |
| `created_at` / `updated_at` | timestamptz | tidak | now() | |
| `version` | integer | tidak | 1 | |
| `deleted_at` | timestamptz | ya | null | |
| `external_identity` | text | ya | null | Pemetaan identitas dari sistem lain (mis. email Jira); dipakai importer untuk menautkan akun (`import-contract.md` IC-1) |
| `is_placeholder` | boolean | tidak | false | true = akun dibuat importer tanpa kredensial; tidak bisa login sampai diklaim admin |
| `session_epoch` | integer | tidak | 0 | Dinaikkan saat "cabut semua sesi"; sesi dengan epoch lebih lama ditolak (`FR-112`). |

**Constraint:** `email` UNIQUE. `CHECK` panjang `display_name` 1–100.
**Index:** `email` (unik), `(email_verified_at)` parsial null untuk job pengingat verifikasi.
**Catatan keamanan:** `password_hash` dan `email` **tidak boleh** muncul di log (`architecture.md` §4).

---

### ENT-03 `workspace_members`

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK |
| `workspace_id` | uuid | tidak | — | FK → workspaces |
| `user_id` | uuid | tidak | — | FK → users |
| `role` | smallint | tidak | — | 1=owner, 2=admin, 3=member (`rbac.md`) |
| `created_at` | timestamptz | tidak | now() | |
| `revoked_at` | timestamptz | ya | null | Dicabut ≠ dihapus, untuk audit |

**Constraint:** UNIQUE `(workspace_id, user_id)`. CHECK `role IN (1,2,3)`.
**Invariant INV-01:** setiap workspace punya ≥ 1 baris `role=1` yang `revoked_at IS NULL`. Ditegakkan oleh operasi aplikasi + job pemeriksa; **tidak** bisa dinyatakan sebagai CHECK sederhana.
**Invariant INV-02:** user yang `workspace_members.revoked_at IS NOT NULL` tidak boleh punya `team_members` aktif di workspace itu. Ditegakkan saat pencabutan (transaksi yang sama).

---

### ENT-04 `teams`

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK |
| `workspace_id` | uuid | tidak | — | FK |
| `name` | text | tidak | — | 1–80 |
| `key` | text | tidak | — | 2–6 huruf besar, bagian dari `ENG-123` |
| `description` | text | ya | null | |
| `feat_cycles` | boolean | tidak | false | Toggle (ADR-007) |
| `feat_goals` | boolean | tidak | true | |
| `feat_effort` | boolean | tidak | false | |
| `feat_dependencies` | boolean | tidak | true | |
| `feat_timeline` | boolean | tidak | false | R2 UI |
| `feat_time_tracking` | boolean | tidak | false | R2 |
| `feat_releases` | boolean | tidak | false | R2 |
| `feat_capacity` | boolean | tidak | false | R2 |
| `effort_scale` | smallint | tidak | 1 | 1=fibonacci(1,2,3,5,8), 2=kaos(S,M,L,XL) |
| `created_at` / `updated_at` | timestamptz | tidak | now() | |
| `version` | integer | tidak | 1 | |
| `deleted_at` | timestamptz | ya | null | |

**Constraint:** UNIQUE `(workspace_id, key)` parsial `deleted_at IS NULL`. `CHECK` `key ~ '^[A-Z]{2,6}$'`. `CHECK` `effort_scale IN (1,2)`.
**Index:** `(workspace_id)` untuk daftar tim.
**Catatan:** toggle disimpan sebagai kolom eksplisit (bukan jsonb) agar bisa di-query dan di-index; menambah toggle = migrasi aditif (expand), bukan perubahan jsonb yang tak terlihat.

---

### ENT-05 `team_members`

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK |
| `workspace_id` | uuid | tidak | — | denormalisasi |
| `team_id` | uuid | tidak | — | FK |
| `user_id` | uuid | tidak | — | FK |
| `role` | smallint | tidak | — | 1=admin_tim, 2=member, 3=commenter, 4=viewer |
| `created_at` | timestamptz | tidak | now() | |
| `revoked_at` | timestamptz | ya | null | |

**Constraint:** UNIQUE `(team_id, user_id)`. CHECK `role IN (1,2,3,4)`.
**Invariant INV-03:** `team_members` hanya boleh ada bila user punya `workspace_members` aktif di workspace yang sama. Ditegakkan aplikasi **dan** job pemeriksa harian (jangan andalkan FK lintas-tabel yang tidak bisa dinyatakan).
**Catatan:** `workspace role = admin` **tidak otomatis** menjadi admin di setiap tim untuk aksi yang ditandai "butuh keanggotaan tim" — pemetaan eksplisit di `rbac.md`. Ini mencegah admin workspace diam-diam bisa mengedit semua task tanpa jejak.

---

### ENT-06 `team_keys` (penomoran manusiawi)

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `team_id` | uuid | tidak | — | PK |
| `workspace_id` | uuid | tidak | — | |
| `next_number` | bigint | tidak | 1 | counter |
| `allocated_until` | bigint | tidak | 0 | blok yang sudah dipesan aplikasi |

**Mekanisme:** aplikasi memesan blok nomor (default 20) dengan satu `UPDATE … RETURNING` yang mengunci baris, lalu memakai nomor dari blok itu di memori. Ini menghindari `SELECT FOR UPDATE` pada setiap pembuatan task (bottleneck yang nyata saat 150 konkuren).
**Konsekuensi yang diterima:** nomor bisa bolong bila proses mati setelah memesan blok. **Diterima dan didokumentasikan** — pengguna lebih memaafkan `ENG-118` yang hilang daripada antrean pembuatan task.
**Alternatif yang ditolak:** sequence Postgres per tim (jumlah tim tidak terbatas → objek DB dinamis, menyulitkan backup/restore).

---

### ENT-07 `statuses`

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK |
| `workspace_id` | uuid | tidak | — | |
| `team_id` | uuid | tidak | — | FK |
| `name` | text | tidak | — | 1–40, unik per tim |
| `category` | smallint | tidak | — | **1=Antrean, 2=Siap, 3=Dikerjakan, 4=Selesai, 5=Dibatalkan** |
| `position` | integer | tidak | — | urutan kolom; unik per (team, category) |
| `is_default` | boolean | tidak | false | status awal task baru |
| `created_at` / `updated_at` | timestamptz | tidak | now() | |
| `archived_at` | timestamptz | ya | null | status yang tidak dipakai lagi tapi masih dipakai task lama |

**Constraint:** UNIQUE `(team_id, name)` parsial `archived_at IS NULL`. UNIQUE `(team_id, position)` parsial `archived_at IS NULL`. CHECK `category IN (1..5)`.
**Invariant INV-05:** setiap tim punya **tepat satu** `is_default = true` yang aktif. Ditegakkan oleh unique partial index `(team_id)` WHERE `is_default AND archived_at IS NULL`.
**Invariant INV-06:** status yang masih dirujuk task tidak boleh dihapus keras; hanya `archived_at`.
**Kategori tidak bisa ditambah** (NG-03). Ini yang membuat metrik lintas tim bisa dibandingkan.

---

### ENT-08 `tasks`

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK |
| `workspace_id` | uuid | tidak | — | isolasi tenant |
| `team_id` | uuid | tidak | — | FK; **tidak berubah setelah dibuat** (FR-113) |
| `number` | bigint | tidak | — | nomor dari `team_keys` |
| `title` | text | tidak | — | 1–300 |
| `description` | text | ya | null | Markdown; ≤ 100 KB (`prd.md` §7.4) |
| `description_tsv` | tsvector | ya | **generated stored** | `GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title,'') \|\| ' ' \|\| coalesce(description,''))) STORED` — **generated column, bukan trigger** (diverifikasi V7). GIN index (ADR-005). |
| `category` | smallint | tidak | 1 | **1=Tugas, 2=Bug, 3=Permintaan, 4=Insiden** |
| `status_id` | uuid | tidak | — | FK → statuses (tim yang sama) |
| `priority` | smallint | tidak | 0 | 0=tidak ada, 1=rendah, 2=sedang, 3=tinggi, 4=mendesak |
| `effort` | smallint | ya | null | Nilai sah tergantung `teams.effort_scale` (divalidasi aplikasi + CHECK gabungan) |
| `assignee_id` | uuid | ya | null | FK → users (M1) |
| `created_by` | uuid | tidak | — | FK → users |
| `due_date` | date | ya | null | tanggal kalender, tanpa zona |
| `started_at` | timestamptz | ya | null | diisi saat pertama masuk kategori 3 |
| `completed_at` | timestamptz | ya | null | diisi saat pertama masuk kategori 4 |
| `canceled_at` | timestamptz | ya | null | diisi saat masuk kategori 5 |
| `goal_id` | uuid | ya | null | ENT-21 (R1); kolom ada di R0 agar tidak migrasi ulang |
| `cycle_id` | uuid | ya | null | ENT-22 (R1) |
| `source_system` | smallint | ya | null | 1=Jira, null=dibuat di Kelindan (`import-contract.md` §6) |
| `source_instance_id` | text | ya | null | Identitas instance/expor asal; mencegah bentrok antar instance |
| `source_id` | text | ya | null | Kunci issue asal (mis. `ENG-123`) |
| `source_raw` | jsonb | ya | null | ADF/JSON mentah deskripsi — **wajib** agar konversi lossy bisa diperbaiki kelak |
| `reconstructed` | boolean | tidak | false | true bila riwayat direkonstruksi dari status saat ini, bukan changelog nyata (`import-contract.md` IC-2) |
| `imported_at` | timestamptz | ya | null | Dasar aturan "impor tidak menimpa perubahan lokal" (`import-contract.md` IC-9) |
| `created_at` / `updated_at` | timestamptz | tidak | now() | |
| `version` | integer | tidak | 1 | ADR-015 |
| `deleted_at` | timestamptz | ya | null | |

**Constraint:**
- UNIQUE `(team_id, number)`.
- CHECK `title` panjang 1–300; CHECK `priority IN (0..4)`; CHECK `category IN (1..4)`.
- CHECK `effort IS NULL OR effort > 0`.
- **CHECK konsistensi status/tim tidak bisa dinyatakan di DB** (butuh join). Ditegakkan oleh: (a) repository (status diambil via `team_id` task), (b) trigger `BEFORE INSERT/UPDATE` yang memverifikasi `statuses.team_id = tasks.team_id`. **Trigger ini wajib** karena ini termasuk kebocoran lintas-tim.
- CHECK `completed_at IS NULL OR started_at IS NOT NULL` — *tidak* dipakai: task bisa diimpor langsung selesai. Diterima, dan metrik menangani kasus tanpa `started_at` (lihat `prd.md` §8.3: cycle time hanya untuk task dengan `started_at`).

**Index (dengan alasan):**
| Index | Untuk |
| :--- | :--- |
| `(workspace_id, team_id, status_id, updated_at DESC)` | Board & List default (query paling panas, `NFR-004`). |
| `(workspace_id, assignee_id, status_id)` | Filter "tugas saya". |
| `(workspace_id, team_id, number)` unik | Resolusi `ENG-123`. |
| `(workspace_id, due_date)` parsial `deleted_at IS NULL AND completed_at IS NULL` | Tampilan tenggat & pengingat. |
| `(workspace_id, goal_id)` parsial `goal_id IS NOT NULL` | Progress Goal (R1). |
| `(workspace_id, cycle_id)` parsial `cycle_id IS NOT NULL` | Cycle view (R1). |
| GIN `description_tsv` | Pencarian (ADR-005). |
| `(title gin_trgm_ops)` | Pencarian judul dengan salah ketik. |

**Constraint tambahan (impor):** UNIQUE `(workspace_id, source_system, source_instance_id, source_id)` parsial WHERE `source_system IS NOT NULL` — idempotensi impor (`import-contract.md` IC-8).

**Invariant INV-04:** `version` naik tepat 1 pada setiap mutasi yang mengubah kolom yang dapat diedit; mutasi tanpa perubahan bersih tidak menaikkan versi (penting untuk idempotensi retry, ADR-015).
**Invariant INV-07:** `started_at`, `completed_at`, `canceled_at` bersifat *first-touch*: hanya diisi bila null, tidak pernah ditimpa.
**Catatan denormalisasi:** `workspace_id` wajib walau bisa dijoin dari `team_id` — ini disengaja (S2), dan konsistensinya dijaga trigger pembuatan task (berasal dari tim).

---

### ENT-09 `labels` & ENT-10 `task_labels`

`labels`: `id`, `workspace_id`, `team_id`, `name` (1–40, unik per tim, case-insensitive), `color` (text, 7 char hex), `created_at`, `archived_at`.
`task_labels`: `workspace_id`, `task_id`, `label_id`, `created_at`. PK gabungan `(task_id, label_id)`.
**Invariant INV-08:** label dan task harus satu tim. Ditegakkan trigger (alasan sama dengan status).
**Batas:** maks 10 label per task (validasi aplikasi; batas keras agar payload board tidak meledak).

---

### ENT-11 `checklist_items`

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK |
| `workspace_id` | uuid | tidak | — | |
| `task_id` | uuid | tidak | — | FK |
| `content` | text | tidak | — | 1–500 |
| `is_done` | boolean | tidak | false | |
| `assignee_id` | uuid | ya | null | Opsional (FR-109) |
| `due_date` | date | ya | null | |
| `position` | integer | tidak | — | unik per task |
| `created_at` / `updated_at` | timestamptz | tidak | now() | |
| `converted_task_id` | uuid | ya | null | Diisi bila item dijadikan task (FR-109) |

**Batasan yang disengaja:** tidak ada `status_id`, tidak ada checklist bersarang, kedalaman 1. Ini yang membedakannya dari sub-task (NG-05).

---

### ENT-12 `comments` & ENT-13 `comment_revisions`

`comments`: `id`, `workspace_id`, `task_id`, `author_id`, `body` (text, Markdown ≤ 16 KB), `body_tsv` (tsvector **generated stored**), `created_at`, `edited_at`, `deleted_at`, **`source_id` (text, null), `source_raw` (jsonb, null), `imported_at` (timestamptz, null)** — tiga kolom terakhir ada karena konversi ADF lossy juga berlaku pada komentar (`import-contract.md` §6).
**Constraint:** panjang body 1–16.384.
**Index:** `(task_id, created_at)` untuk thread; GIN `body_tsv`.
**Soft delete** menyisakan baris (placeholder "komentar dihapus") agar thread tidak berubah bentuk.

`comment_revisions`: `id`, `comment_id`, `workspace_id`, `body`, `edited_by`, `created_at`. Append-only. Disimpan agar klaim "diedit" bisa dibuktikan (FR-108).
**Batas:** simpan maksimum 20 revisi terakhir per komentar (job pemangkas), dengan revisi terjauh dipertahankan.

---

### ENT-14 `attachments`

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK |
| `workspace_id` | uuid | tidak | — | |
| `task_id` | uuid | tidak | — | FK |
| `comment_id` | uuid | ya | null | lampiran pada komentar |
| `uploader_id` | uuid | tidak | — | |
| `file_name` | text | tidak | — | 1–255, disanitasi |
| `content_type` | text | tidak | — | allowlist |
| `size_bytes` | bigint | tidak | — | ≤ 104.857.600 |
| `storage_key` | text | tidak | — | kunci objek di bucket; **tidak** mengekspos path internal |
| `checksum_sha256` | text | tidak | — | integritas; dipakai untuk dedup opsional |
| `source_url` | text | ya | null | URL asal saat impor |
| `import_status` | smallint | ya | null | 1=berhasil, 2=gagal sementara, 3=dilewati (mis. melebihi batas ukuran) |
| `created_at` | timestamptz | tidak | now() | |

**Constraint:** CHECK `size_bytes > 0 AND size_bytes <= 104857600`. CHECK `comment_id IS NULL OR task_id IS NOT NULL`.
**Invariant INV-09:** `storage_key` tidak pernah dikirim ke klien; klien menerima presigned URL berumur pendek (ADR-009, T7).
**Batas:** ≤ 50 lampiran per task (§7.4), divalidasi aplikasi.

---

### ENT-15 `task_events` — tabel paling penting di R0

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK |
| `workspace_id` | uuid | tidak | — | partition key masa depan |
| `team_id` | uuid | tidak | — | |
| `task_id` | uuid | tidak | — | **tanpa FK cascade** (S8) |
| `seq` | bigint | tidak | — | urut per workspace (ENT-17 punya `seq` terpisah; lihat catatan) |
| `actor_id` | uuid | ya | null | null = sistem (impor, otomasi, rollover) |
| `source` | smallint | tidak | 1 | 1=pengguna, 2=sistem, 3=impor — metrik bisa menyaring event rekonstruksi |
| `kind` | smallint | tidak | — | 1=status, 2=assignee, 3=prioritas, 4=judul, 5=due_date, 6=effort, 7=goal, 8=cycle, 9=dibuat, 10=dihapus, 11=dipulihkan, 12=label, 13=checklist |
| `from_value` | jsonb | ya | null | nilai sebelum (bentuk beragam per `kind`) |
| `to_value` | jsonb | ya | null | nilai sesudah |
| `category_from` | smallint | ya | null | **kategori status sebelum** (denormalisasi untuk metrik; hanya untuk kind=1) |
| `category_to` | smallint | ya | null | kategori setelah |
| `cycle_id` | uuid | ya | null | cycle aktif saat event (untuk §8.2) |
| `created_at` | timestamptz | tidak | now() | waktu event |

**Constraint:** CHECK `kind IN (1..13)`. CHECK `(kind = 1) = (category_to IS NOT NULL)` — agar event status selalu membawa kategori (mencegah metrik rusak karena data tidak lengkap).
**Index:** `(task_id, created_at)`; `(workspace_id, team_id, created_at)`; `(workspace_id, kind, created_at)` parsial `kind = 1` untuk query metrik; `(workspace_id, cycle_id)` parsial.
**Append-only:** hak UPDATE/DELETE pada tabel ini **tidak diberikan** ke peran aplikasi (S7). Koreksi memakai event kompensasi.
**Retensi:** disimpan selama task ada + 400 hari setelah purge (`NFR-013`), kecuali diminta lebih pendek oleh operator.

**Kenapa `category_from/category_to` didenormalisasi:** metrik tidak boleh bergantung pada tabel `statuses` yang bisa di-*archive* atau diubah namanya; dan join berlapis pada 3 juta baris/tahun terlalu mahal untuk dashboard. Ini keputusan sadar dengan biaya: bila kategori status diubah, event lama tetap menyimpan kategori historis (yang memang benar secara historis).

**Catatan `seq`:** `task_events.seq` adalah urutan per workspace yang dipakai klien untuk deteksi celah pada riwayat/detail. Untuk delta real-time, sumbernya `changes` (ENT-17) yang punya `seq` sendiri; keduanya harus dinaikkan dari counter yang sama agar urutannya konsisten. **Satu counter per workspace, bukan dua.**

---

### ENT-16 `audit_events`

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK |
| `workspace_id` | uuid | ya | null | null untuk aksi pra-login (mis. login gagal) |
| `actor_id` | uuid | ya | null | null = sistem |
| `actor_ip` | inet | ya | null | |
| `actor_user_agent` | text | ya | null | ≤ 300 char |
| `action` | text | tidak | — | ID aksi dari `rbac.md` (mis. `workspace.member.role_changed`) |
| `target_type` | text | ya | null | mis. `user`, `team`, `token` |
| `target_id` | uuid | ya | null | |
| `metadata` | jsonb | tidak | `'{}'` | **Tanpa** rahasia, tanpa isi konten pengguna |
| `created_at` | timestamptz | tidak | now() | |

**Retensi:** 400 hari (`NFR-013`). Append-only (S7).
**Index:** `(workspace_id, created_at DESC)`, `(workspace_id, action, created_at DESC)`, `(actor_id, created_at DESC)`.
**Aturan:** setiap aksi yang terdaftar di `rbac.md` §5 sebagai "diaudit" **wajib** menulis baris di sini dalam transaksi yang sama (TC-13).

---

### ENT-17 `changes` (delta real-time)

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `workspace_id` | uuid | tidak | — | bagian PK gabungan |
| `seq` | bigint | tidak | — | monoton per workspace; PK gabungan `(workspace_id, seq)` |
| `entity_type` | smallint | tidak | — | 1=task, 2=comment, 3=status, 4=team, 5=goal, 6=checklist, 7=label |
| `entity_id` | uuid | tidak | — | |
| `team_id` | uuid | ya | null | untuk filter langganan (T3) |
| `op` | smallint | tidak | — | 1=upsert, 2=delete |
| `version` | integer | ya | null | versi entitas setelah perubahan (ADR-015) |
| `payload` | jsonb | ya | null | **patch minimal**, bukan entitas penuh |
| `created_at` | timestamptz | tidak | now() | |

**Index:** PK `(workspace_id, seq)` sudah melayani `since_seq`. Index tambahan `(created_at)` untuk job pemangkas.
**Pemangkasan:** delta disimpan minimum 24 jam; lebih lama dari itu klien yang tertinggal menerima instruksi **bootstrap ulang** (bukan error).
**Aturan payload (batas keras, ADR-017):** hanya field yang berubah; **maksimum 4 KB**; tidak boleh memuat `description`/`comments.body`. Perubahan deskripsi mengirim sinyal "reload field" beserta hash, bukan isi. Alasan ada batas: `pg_notify` gagal pada payload ≥ 8.000 byte **di dalam transaksi**, sehingga dapat menggagalkan mutasi (temuan V8 di `naming-and-validation.md`).

**Aturan NOTIFY:** `pg_notify` hanya membawa `(workspace_id, seq)` ≤ 64 byte. Penerima membaca baris ini dari tabel. `NOTIFY` adalah bel, bukan kurir.

**Counter `seq`:** disimpan di `workspaces.seq_next` (kolom tambahan) dan dinaikkan dalam transaksi yang sama dengan insert `changes`. Kontensi: satu baris per workspace — dapat diterima karena semua mutasi pada workspace yang sama memang harus berurutan. Bila workspace sangat sibuk (>500 mutasi/detik), jalur keluarnya blok alokasi seperti `team_keys` (dengan konsekuensi urutan antar-blok tidak ketat, sehingga klien harus mengandalkan `version` — sudah dirancang begitu).

---

### ENT-18 `sessions`

`id` (uuid PK), `workspace_id` (ya, null untuk sesi pra-pilih workspace), `user_id`, `token_hash` (text, SHA-256 dari token acak 256-bit; **token asli tidak disimpan**), `created_at`, `last_seen_at` (diperbarui maks 1×/5 menit untuk menghindari write amplification), `expires_at`, `revoked_at`, `epoch` (integer, salinan `users.session_epoch` saat dibuat), `ip`, `user_agent`.
**Index:** `(token_hash)` unik; `(user_id, revoked_at)` untuk "cabut semua".
**Validasi:** sesi sah bila `revoked_at IS NULL AND expires_at > now() AND epoch = users.session_epoch` → pencabutan global berlaku < 60 s (`FR-112`).

---

### ENT-19 `idempotency_keys`

`actor_id` (uuid), `operation_id` (ulid disimpan sebagai text/uuid), `endpoint` (text), `request_hash` (text), `response_status` (smallint), `response_body` (jsonb), `created_at`.
**PK:** `(actor_id, operation_id)`.
**Aturan:** bila `operation_id` sama tapi `request_hash` berbeda → **409** (indikasi bug klien atau penyalahgunaan), bukan diam-diam diproses.
**Retensi:** 24 jam (job pemangkas). Index `(created_at)`.

---

### ENT-20 `jobs`

`id` (uuid PK), `workspace_id` (ya), `kind` (text, mis. `notify.mention`, `webhook.send`, `cycle.rollover`, `attachment.gc`, `export.build`), `payload` (jsonb), `run_after` (timestamptz, default now()), `attempts` (smallint default 0), `max_attempts` (smallint default 8), `locked_until` (timestamptz, null), `locked_by` (text, null), `last_error` (text, null), `created_at`, `completed_at` (ya).
**Index:** `(run_after)` parsial `completed_at IS NULL` — inti `SKIP LOCKED` poll.
**Invariant INV-10:** job wajib idempoten; setiap `kind` mendokumentasikan kunci idempotensinya di kode.
**Invariant INV-11:** paginasi seluruh API memakai cursor `(sort_key, id)`, tidak ada `OFFSET` pada tabel besar. (Dipakai board/list/riwayat.)

---

## 5. Tabel R1–R2 (bentuk kontrak, belum dibuat)

Ditulis sekarang agar kolom R0 yang menghubungkan tidak perlu diubah.

**ENT-21 `goals`** — `id`, `workspace_id`, **`owner_team_id` (null = workspace-level)**, `parent_goal_id` (null; kedalaman maks 2 — ditegakkan aplikasi + CHECK lewat trigger), `name`, `description`, `target_date` (date, null), `state` (1=aktif, 2=tercapai, 3=dibatalkan), `created_at`, `updated_at`, `version`. Task↔Goal = `tasks.goal_id` (1:N, ADR-002).

**ENT-22 `cycles`** — `id`, `workspace_id`, `team_id`, `name`, `starts_at`, `ends_at`, `state` (1=direncanakan, 2=aktif, 3=ditutup), `auto_rollover` (bool), `created_at`, `version`. UNIQUE `(team_id, starts_at)`.

**ENT-23 `cycle_scope`** — `cycle_id`, `task_id`, `effort_at_start` (smallint, null), `added_after_start` (bool), `carried_over_to_cycle_id` (uuid, null), `completed_in_scope` (bool). PK `(cycle_id, task_id)`. **Tabel ini adalah alasan velocity bisa dihitung** (PRD §8.2).

**ENT-24 `task_dependencies`** — `workspace_id`, `blocking_task_id`, `blocked_task_id`, `created_by`, `created_at`. PK `(blocking_task_id, blocked_task_id)`. CHECK `blocking_task_id <> blocked_task_id`. Siklus dicegah aplikasi (bukan DB) dengan penelusuran sebelum insert.

**ENT-25 `saved_views`** — `id`, `workspace_id`, `team_id` (null = lintas tim), `name`, `owner_id`, `filter` (jsonb, bentuk tervalidasi), `sort` (jsonb), `group_by` (text), `visibility` (1=pribadi, 2=tim), `created_at`, `version`.

**ENT-26 `notifications`** — `id`, `workspace_id`, `user_id`, `kind`, `entity_type`, `entity_id`, `actor_id`, `read_at`, `snoozed_until`, `created_at`. Index `(user_id, read_at, created_at DESC)`.

**ENT-27 `api_tokens`** — `id`, `workspace_id`, `user_id`, `name`, `token_hash`, `scopes` (text[]; subset dari hak pembuat, T4), `last_used_at`, `expires_at`, `revoked_at`.

**ENT-28 `custom_fields` / `task_custom_values`** — definisi per tim (`type` 1=teks,2=angka,3=pilihan,4=tanggal) + tabel nilai dengan UNIQUE `(task_id, field_id)`. Wajib-per-kategori (FR-307) divalidasi aplikasi.

**ENT-29 `time_entries`** — `id`, `workspace_id`, `task_id`, `user_id`, `started_at`, `duration_seconds`, `note`, `billable` (bool), `created_at`.

**ENT-31 `imports`** — `id`, `workspace_id`, `source_system` (smallint), `source_instance_id` (text), `started_at`, `finished_at` (null), `status` (1=berjalan, 2=selesai, 3=selesai-dengan-gagal, 4=dibatalkan), `counts` (jsonb: jumlah per level L1–L5 per tipe objek), `report_uri` (text, null), `created_by`. **Laporan adalah artefak produk, bukan log** — wajib dapat diunduh dari UI. Index `(workspace_id, started_at DESC)`.

**ENT-30 `guest_grants`** — `id`, `workspace_id`, `user_id`, `scope_type` (1=team, 2=goal), `scope_id`, `can_comment` (bool), `expires_at`, `revoked_at`.

---

## 6. Urutan Penghapusan (wajib, karena S8 melarang cascade)

**Hapus task (soft):** set `deleted_at`; tulis `task_events` kind=10; tulis `changes`; job menjadwalkan purge 30 hari (`NFR-013`).

**Purge task (hard, oleh job):** dalam satu transaksi berurutan: `checklist_items` → `task_labels` → `comment_revisions` → `comments` → `attachments` (baris + objek storage) → `cycle_scope` → `task_dependencies` → `tasks`. **`task_events` TIDAK dihapus** pada tahap ini (retensi 400 hari, `audit`-like). `changes` dibiarkan sampai pemangkasan alami.

**Hapus tim (soft):** `teams.deleted_at`; task di dalamnya menjadi read-only (bukan dihapus) selama 30 hari agar bisa dipulihkan; setelah itu mengikuti purge task per task. Ini eksplisit agar admin tidak bisa menghapus 10.000 task tanpa sadar.

**Hapus workspace:** memerlukan konfirmasi ketik nama workspace + peran owner; menulis `audit_events`; grace 30 hari.

**Hapus user:** anonimisasi (`display_name` → "Pengguna dihapus", `email` → hash, `password_hash` → null) **tanpa** menghapus `task_events`/`audit_events` (karena pelaku historis dibutuhkan untuk metrik & audit); `actor_id` tetap merujuk baris user yang teranonimisasi.

---

## 7. Invariant Konsolidasi

| ID | Invariant | Ditegakkan oleh | Diuji oleh |
| :--- | :--- | :--- | :--- |
| **INV-01** | Setiap workspace punya ≥ 1 owner aktif | Aplikasi + job pemeriksa | Uji integritas |
| **INV-02** | Anggota workspace yang dicabut tidak punya keanggotaan tim aktif | Transaksi pencabutan | Uji integritas |
| **INV-03** | Keanggotaan tim hanya untuk anggota workspace aktif | Aplikasi + job pemeriksa harian | Uji integritas |
| **INV-04** | `version` naik tepat 1 per mutasi bersih | Repository (satu jalur tulis) | Uji konkurensi |
| **INV-05** | Tepat satu status default aktif per tim | Unique partial index | Uji constraint |
| **INV-06** | Status yang dipakai task tidak dihapus keras | Job pencegah + FK tanpa cascade | Uji constraint |
| **INV-07** | `started_at`/`completed_at`/`canceled_at` first-touch | Trigger | Uji mutasi bolak-balik |
| **INV-08** | Label & status selalu satu tim dengan task | Trigger | Uji lintas-tim |
| **INV-09** | `storage_key` tidak pernah keluar ke klien | Serializer (allowlist field) | Uji respons API |
| **INV-10** | Toggle fitur tidak menghapus data | Tidak ada DELETE pada perubahan toggle | TC-22 |
| **INV-11** | Paginasi selalu cursor, bukan offset | Repository (tipe cursor wajib) | Uji lintas halaman |
| **INV-12** | Setiap query tabel tenant menyertakan `workspace_id` | Lint tipe + repository + RLS (R2) | TC-14 |
| **INV-13** | Objek anak diotorisasi lewat induknya | `can()` menerima resource berantai | TC-23 |
| **INV-14** | `task_events` & `audit_events` tidak bisa diubah/dihapus aplikasi | Hak DB dicabut | Uji peran DB |
| **INV-15** | Event status selalu membawa kategori | CHECK constraint | Uji constraint |
| **INV-16** | Impor tidak pernah menimpa entitas yang sudah diubah pengguna | Pemeriksaan `version`/`imported_at` di importer (IC-9) | Uji impor-ulang |
| **INV-17** | Setiap impor menghasilkan laporan L1–L5 yang dapat diunduh | `imports.report_uri` wajib terisi saat status selesai | Uji impor |

**Perubahan karena `import-contract.md`:** kolom impor (`source_*`, `imported_at`, `reconstructed`), kolom `is_placeholder`/`external_identity` pada `users`, tabel `imports` (ENT-31), dan INV-16/INV-17. Semua masuk **migration pertama**, bukan migrasi tambahan — itu inti alasan spike importer harus mendahuluinya.

---

## 8. Estimasi Ukuran (untuk memvalidasi "tidak perlu partisi")

Terhadap dataset acuan `prd.md` §7.1, per workspace per tahun:

| Tabel | Baris (perkiraan) | Ukuran baris rata-rata | Total |
| :--- | :--- | :--- | :--- |
| `tasks` | 500.000 aktif + 200.000/tahun selesai | ~1 KB (termasuk deskripsi & tsv) | ~700 MB |
| `task_events` | 3.000.000 | ~250 B | ~750 MB |
| `comments` | 500.000/tahun | ~600 B | ~300 MB |
| `changes` | 6.000.000/tahun (dipangkas 24 jam → ~40.000 hidup) | ~300 B | ~12 MB hidup |
| `audit_events` | 200.000 | ~400 B | ~80 MB |

**Kesimpulan:** satu workspace pada dataset acuan tinggal di bawah 3 GB/tahun. Postgres menangani ini tanpa partisi. **Partisi baru relevan** bila `task_events` melewati ~150 juta baris (≈ 50 workspace pada volume acuan) atau bila operator membutuhkan retensi per tahun untuk kepatuhan. Rencana partisi: `task_events` per bulan (`created_at`), `changes` tidak dipartisi (dipangkas). Ini menegaskan M6 dan menolak "wajib partitioning sejak awal" v0.

---

## 9. Yang Belum Diputuskan (dilarang dikerjakan tanpa ADR)

1. **Multi-assignee** (`task_assignees`) — ditolak untuk R0–R2 (M1). Bila dibutuhkan: ADR + definisi beban kerja per orang.
2. **Banyak Goal per task** (N:N) — ADR-002 menetapkan 1:N.
3. **Skema versi API** (`v2`) dan kebijakan deprecation.
4. **Format ekspor kanonik** yang tahan versi (FR-114) — perlu format berversi; belum dirancang. **Catatan:** importer Jira sudah punya kontrak sendiri (`import-contract.md`), jadi keduanya harus berbagi satu skema ekspor berversi agar tidak ada dua format berbeda. Pekerjaan setelah spike.
5. **Partisi `task_events`** — menunggu ambang di §8.
6. **Sharding lintas workspace** — di luar R2.

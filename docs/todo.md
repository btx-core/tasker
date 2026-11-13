# TODO Implementasi (dokumen hidup)

**Versi:** 1.0 · **Dibuat:** 2026-11-12 · **Status:** aktif
**Sifat:** dokumen **hidup**. Ia diperbarui setiap kali tugas selesai, gagal, atau berubah. Status di sini adalah sumber kebenaran progres — bukan pesan commit, bukan ingatan siapa pun.

**Cara membaca.** Setiap tugas punya ID stabil (`P1-03`), **kriteria selesai yang bisa diuji**, dan rujukan dokumen. Tugas tanpa kriteria uji tidak boleh masuk daftar ini — karena itu cara paling umum sebuah backlog menjadi daftar harapan.

---

## 0. Legenda & aturan

| Simbol | Arti |
| :--- | :--- |
| `[ ]` | belum mulai |
| `[~]` | sedang dikerjakan |
| `[x]` | selesai, kriteria terpenuhi |
| `[!]` | **terblokir** — alasan wajib ditulis di tempat |
| `[-]` | dibatalkan / ditunda — alasan wajib ditulis |

**Aturan yang mengikat dokumen ini:**

1. **Satu tugas = satu alasan untuk gagal.** Tugas yang menggabungkan "tulis endpoint + tulis UI + tulis uji" bukan tugas, itu fase.
2. **Kriteria selesai harus bisa diperiksa orang lain** tanpa bertanya kepada penulisnya.
3. **Urutan boleh berubah; kelengkapan tidak.** Menunda tugas sah, menghapus tanpa alasan tidak.
4. **Tugas baru yang muncul di tengah jalan masuk ke §8 (temuan),** diberi ID, lalu dipromosikan atau ditolak **dengan alasan**.
5. **Setiap perubahan status dicatat di §9 (log).** Tanpa log, dokumen ini berhenti bisa dipercaya setelah 20 commit.

---

## 1. Tujuan fase ini (dan apa yang **tidak** termasuk)

**Tujuan:** membuktikan **irisan vertikal** berjalan dari database sampai layar, dengan empat keputusan termahal dibuktikan sekaligus:

| Keputusan | Dibuktikan oleh |
| :--- | :--- |
| ADR-015 — idempotensi + versi + konflik per-field | `P1` |
| ADR-017 — payload `NOTIFY` hanya pointer | `P1-08`, `P3` |
| `NFR-003`/`NFR-007` — real-time + latensi | `P3` |
| `INV-12` — isolasi tenant di setiap query | `P1-03`, `P1-12` |

**Tidak termasuk fase ini** (sengaja): importer, media/lampiran, email, SSO, goals/cycles (R1), ekspor, API publik penuh, i18n kedua bahasa. Semuanya sudah dirancang; ditunda karena tidak membuktikan apa pun yang belum dibuktikan irisan ini.

**Definisi "fase selesai":** satu pengguna bisa membuat task, memindahkannya di board, dan **pengguna kedua melihat perpindahan itu tanpa memuat ulang** — dengan uji otomatis membuktikan idempotensi, konflik versi, dan isolasi tenant.

---

## P0 — Fondasi repo (target: 1 hari)

| ID | Tugas | Kriteria selesai | Rujukan |
| :--- | :--- | :--- | :--- |
| `P0-01` | `package.json` akar + workspaces (`apps/web`, `apps/server`, `packages/{shared,db,testing}`) | `npm install` bersih; 5 paket terdaftar | `repo-layout.md` §1–2 | **[x]** selesai |
| `P0-02` | `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`) + tsconfig per paket | `npm run typecheck` hijau | `repo-layout.md` §7 | **[x]** selesai |
| `P0-03` | ESLint termasuk **aturan batas modul** (`web` ✗ `db`/`server`) | Uji negatif: impor terlarang → lint **gagal** | `repo-layout.md` §3 | **[x]** selesai — `npm run lint:boundary` menjalankan 2 kasus yang **harus** ditolak |
| `P0-04` | `packages/shared/config`: skema env, **fail fast**, tanpa default untuk rahasia | Start tanpa `DATABASE_URL` → berhenti, menyebut variabel | `repo-layout.md` §5 | **[x]** selesai — 8 uji, termasuk penolakan `SESSION_SECRET` nilai contoh |
| `P0-05` | `.env.example` lengkap + `.gitignore` | `git status` bersih setelah `npm install` | `repo-layout.md` §6 | **[x]** selesai |
| `P0-06` | `docker compose` untuk Postgres **17** (port 5432) | `psql` terhubung | `repo-layout.md` §6 | **[x]** berkas siap; tidak dipakai di sandbox karena **verifikasi dilakukan lewat PGlite** (T-06) |
| `P0-07` | Runner migrasi `packages/db/migrations/*` → `schema_migrations` | Migrasi 1–20 jalan; jalan kedua = **no-op**; ubah berkas = **ditolak** | `migrations.md` §8, `T-MIG1` | **[x] SELESAI & TERUJI** pada PostgreSQL 18.6 nyata: 20 migrasi, 21 tabel, jalan kedua no-op, checksum drift ditolak, celah nomor ditolak, preflight menolak ekstensi hilang |
| `P0-08` | Preflight runner: versi Postgres, **schema ekstensi** (`pg_extension.extnamespace`), `search_path` | Instalasi dengan `citext` di schema `extensions` **berhasil** | **T1** di `demo-migrations-report.md` | **[x]** selesai di kode (preflight menolak schema ekstensi tak terjangkau, dengan pesan yang menyebut penyebabnya) |
| `P0-09` | `uuidv7()` di aplikasi + uji bentuk | Uji: versi=7, prefix waktu sama dalam 1 ms | ADR-018, `T-MIG9` | **[x]** selesai — 7 uji |

**Catatan `P0-07`:** migrasi 1–21 disalin dari `examples/migrations/` ke `packages/db/migrations/` **apa adanya**, termasuk perbaikan T2 dan T5 — bukan ditulis ulang.

---

## P1 — Endpoint mutasi task (target: 3–4 hari) · *inti ADR-015*

**Template tunggal** (ADR-015: "tidak boleh ada handler yang menyimpang"):
`authz → validasi → idempotensi → versi → patch → task_events → changes → NOTIFY → commit`

| ID | Tugas | Kriteria selesai | Rujukan |
| :--- | :--- | :--- | :--- |
| `P1-01` | `can()` tunggal: matriks peran → daftar action | Semua action dari `rbac.md` punya uji tabel (peran × action) | `rbac.md`, `T-A1` | **[x]** 6 uji; deny-by-default termasuk peran tak dikenal |
| `P1-02` | Middleware sesi (`sessions` + `epoch`) | Token dicabut → **401** < 1 permintaan | `FR-112` |
| `P1-03` | Repository bertipe: `scope: { workspaceId }` **wajib** | Tidak ada query tanpa `workspace_id` | `INV-12` | **[~]** setiap query di `write.ts` memakai `workspace_id`; penegakan tipe menyeluruh menyusul saat repository penuh ada |
| `P1-04` | Validasi body patch + `expected_version` opsional | Body salah → `validation.failed` + `field` | `api-contract.md` §5 | **[x]** 13 uji; field tak dikenal DITOLAK (bukan diabaikan) |
| `P1-05` | Idempotensi: simpan `(actor_id, operation_id)`; ulang = **hasil sama** | Kirim 2× `Idempotency-Key` sama → 1 efek | ADR-015(1), `ENT-19` | **[x]** kode + **terbukti di Postgres**: panggilan ke-2 REPLAY, versi tetap |
| `P1-06` | `operation_id` sama + **body berbeda** → **409** | 409, bukan diterapkan | `ENT-19` | **[x]** kode (hash body + `expected_version`); uji HTTP menyusul di P1-15 |
| `P1-07` | Versi: naik **tepat 1** hanya bila ada perubahan bersih; `task_events` mencatat `from_value` | No-op → versi **tidak** naik | `INV-04`, `INV-07` | **[x]** terbukti: versi=2 setelah 2 panggilan (replay tidak menaikkan); no-op tidak menaikkan; `from_value` tersimpan |
| `P1-08` | `changes` + `NOTIFY`: payload 4 KB, **NOTIFY hanya `(workspace, seq)` ≤ 64 B** | Deskripsi **100 KB** tersimpan; NOTIFY < 64 B; delta < 4 KB | ADR-017, `T-S7` | **[x]** terbukti: pointer **38 byte**, payload **53 byte tanpa isi deskripsi** |
| `P1-09` | `seq` per workspace dari `workspaces.seq_next` | `seq` naik tanpa celah | `ENT-17` | **[x]** kode (`UPDATE … RETURNING seq_next-1`); uji 100 mutasi butuh DB |
| `P1-10` | `trace_id` di setiap error + `code` katalog | Error memuat `code` + `trace_id`; `trace_id` ditemukan di log | `api-contract.md` §5.1, `T-SUP2` |
| `P1-11` | `POST /v1/teams/{id}/tasks` (buat task, nomor dari `team_keys`) | Nomor terbit unik di bawah konkurensi | `ENT-06` | belum |
| `P1-12` | **Uji isolasi tenant**: user workspace A menembak task workspace B | **404** (bukan 403) | `INV-12` | **[x]** terbukti di Postgres: NOT_FOUND, keberadaan tidak bocor |
| `P1-13` | `T-W1`: dua `PATCH` berbeda field, `expected_version` sama | Keduanya **berhasil** (per-field) | ADR-015(3) | belum — butuh **dua koneksi simultan**; PGlite satu koneksi |
| `P1-14` | `T-W2`: dua `PATCH` field **sama** | LWW + jejak nilai lama | ADR-015(3) | **[~]** jejak terbukti (`from_value` = nilai lama); konkurensi nyata belum |
| `P1-15` | Handler HTTP `PATCH /v1/tasks/{id}` memanggil `applyTaskPatch` (tanpa logika sendiri) | Uji HTTP: 400/403/404/409 dengan `code` + `trace_id` | `api-contract.md` §5 | belum |

---

## P2 — Endpoint baca board (target: 1–2 hari)

| ID | Tugas | Kriteria selesai | Rujukan |
| :--- | :--- | :--- | :--- |
| `P2-01` | `GET /v1/teams/{id}/board` — 7 kolom, ≤ 50 task/kolom | Bentuk respons sesuai `api-contract.md`; 1 query/kolom | `NFR-004` |
| `P2-02` | Cursor pagination `(sort_key, id)`, **tanpa OFFSET** | Halaman 2 tidak mengulang/melewatkan item saat ada sisipan | `INV-11` |
| `P2-03` | `GET /v1/tasks/{id}` + riwayat `task_events` | Riwayat terurut `seq`; event status membawa `category_*` | `ENT-15` |
| `P2-04` | Uji performa `T-PERF1` pada 50 rb task | p95 < 200 ms (`NFR-004`) — baseline sudah 0,23 ms | `perf-validation.md` |

---

## P3 — Real-time (target: 2–3 hari) · *inti ADR-017*

| ID | Tugas | Kriteria selesai | Rujukan |
| :--- | :--- | :--- | :--- |
| `P3-01` | WS hub: langganan **per tim**, maks 5 tim/koneksi | Tim ke-6 ditolak dengan `code` yang jelas | `realtime-and-search.md` §2 |
| `P3-02` | `LISTEN` → baca `changes` → fan-out delta | Dua instance: perubahan dari A sampai ke klien di B | ADR-006, ADR-017 |
| `P3-03` | Klien menerapkan delta hanya bila `version` > lokal | Delta lebih tua diabaikan, bukan diterapkan | ADR-015(5) |
| `P3-04` | Deteksi celah `seq` → minta rentang; bila tak ada → **bootstrap ulang** | Klien tertinggal 10 menit pulih tanpa state aneh | ADR-015(6) |
| `P3-05` | Klasifikasi **K3 tidak pernah disiarkan** (`audit_event`, `email`, `job`, `import`, `notification`) | Uji: mutasi K3 → tidak ada frame keluar | `realtime-and-search.md` §1 |
| `P3-06` | Pencabutan akses → putus koneksi < 5 s + bersihkan cache klien | Uji: user dicabut, klien berhenti menerima < 5 s | `realtime-and-search.md` §5 |

---

## P4 — Board UI (target: 3–4 hari)

| ID | Tugas | Kriteria selesai | Rujukan |
| :--- | :--- | :--- | :--- |
| `P4-01` | Klien API: `Idempotency-Key` (ULID) otomatis + retry | Retry jaringan → tidak ada duplikat | ADR-015 |
| `P4-02` | Board 7 kolom, render dari `P2-01` | Muat < 800 ms p95 pada dataset acuan | `NFR-004` |
| `P4-03` | Drag & drop → `PATCH` optimistis + rollback saat gagal | Gagal → kartu kembali + pesan, **bukan** diam | `UX-5` |
| `P4-04` | Terapkan delta WS (K1 patch, K2 entitas) | Dua jendela: perpindahan terlihat < 300 ms | `NFR-003` |
| `P4-05` | Konflik 409 → tampilkan state kanonik + pilihan, **jangan menimpa** | Uji manual: dua editor field sama | ADR-015(3) |
| `P4-06` | Tanggal/angka lewat modul format (tidak ada format manual) | `T-I18N3` | `i18n.md` §3 |
| `P4-07` | Tidak ada string UI di komponen | `T-I18N1` | `i18n.md` §2 |
| `P4-08` | Anggaran bundle `UX-B1` | `npm run bundle:check` hijau | `ux-principles.md` |

---

## P5 — Setelah irisan terbukti (belum dijadwalkan)

Dicatat agar tidak hilang, **bukan** komitmen fase ini: detail task + komentar, checklist, label, filter, kotak masuk/notifikasi, pencarian (palette), settings tim, undangan anggota, importer (menunggu berkas Jira), media, email.

Setiap item dipromosikan ke fase sendiri **setelah** `P1`–`P4` hijau — karena pola yang terbukti di irisan ini akan dipakai ulang, dan menulis 10 fitur sebelum satu pola terbukti adalah cara paling mahal untuk salah.

---

## 6. Bloker & keputusan yang masih menunggu manusia

| # | Hal | Menghalangi | Status |
| :--- | :--- | :--- | :--- |
| B1 | **Berkas ekspor Jira** (3–4, anonim boleh) | Importer `S1/S3/S4/S6`; gate `import-contract.md` §7 | `[!]` menunggu pengguna |
| B2 | **Komitmen waktu 12 bulan** | Lingkup R0 — kalau proyek sampingan, `goals`/`cycles`/media/SSO harus dipotong | `[!]` menunggu pengguna |
| B3 | **Anggaran infra ±$40–80/bln** | Tanpa ini `NFR-010` turun jujur ke RPO 24 jam | `[!]` menunggu pengguna |
| B4 | Lingkungan 50 rb baris untuk `NFR-012` | Migrasi kedua pada tabel berisi | `[ ]` bisa dibuat sendiri (dataset sudah pernah dibuat) |

**Catatan:** B1–B3 **tidak** menghalangi `P0`–`P4`. Itu sebabnya pekerjaan dimulai sekarang.

---

## 7. Uji yang wajib ada sebelum fase ini disebut selesai

| Uji | Membuktikan | Tugas |
| :--- | :--- | :--- |
| `T-W1` | Dua penulis, **field berbeda** | `P1-13` |
| `T-W2` | Dua penulis, **field sama** → LWW + jejak | `P1-14` |
| `T-S7` | Deskripsi 100 KB → NOTIFY < 64 B, delta < 4 KB | `P1-08` |
| `T-A1` | Setiap route punya uji otorisasi (peran × action) | `P1-01` |
| `T-IDEM` | `operation_id` ulang = hasil sama; body beda = 409 | `P1-05`, `P1-06` |
| `T-TENANT` | Lintas workspace → 404 | `P1-12` |
| `T-PERF1` | Board 50 rb task p95 < 200 ms | `P2-04` |
| `T-RT1` | Dua klien, delta < 300 ms | `P4-04` |

---

## 8. Temuan selama implementasi (diisi saat berjalan)

| ID | Temuan | Dampak | Keputusan |
| :--- | :--- | :--- | :--- |
| **T-01** | Lingkungan agen **tidak punya Postgres/Docker**, dan host di luar allowlist. `npm` hanya bisa memasang paket. | Uji integrasi runner & migrasi **tidak bisa dijalankan** di sini. | Uji integrasi ditulis dan **dilewati dengan laporan eksplisit** (bukan gagal diam-diam). Harus dijalankan di mesin/CI yang punya Postgres 17 sebelum `P0-07` dianggap selesai. **Bukan** alasan untuk melewati uji. |
| **T-02** | `eslint-disable` pada ignore tidak cukup: berkas probe yang di-ignore **tidak** diperiksa walau dipanggil langsung. | Uji negatif batas modul sempat **lolos palsu** (melaporkan "tidak ditegakkan"). | Perbaikan: `eslint --no-ignore` khusus untuk berkas probe. Pelajaran: **uji negatif pun bisa memberi false pass** — dan itu lebih berbahaya daripada false fail. |
| **T-03** | `npm i -D @eslint/js` memasang v10 yang menuntut eslint 10, sementara `typescript-eslint` menuntut ≤10. | Instalasi gagal `ERESOLVE`. | Pin `@eslint/js@9` sesuai eslint 9. Dicatat agar tidak diulang saat upgrade berikutnya. |
| **T-04** | Sandbox agen **tidak dapat menjangkau port 5432 keluar** (`ENETUNREACH` ke `db.*.supabase.co`), walau konektor Supabase (HTTPS) berfungsi. | `npm test` dengan `DATABASE_URL` Supabase **tidak bisa** dijalankan dari sini. | Jalur tulis diuji lewat **konektor Supabase** (SQL ekuivalen, lihat §10), bukan lewat `pg`. Uji integrasi `pg` tetap harus dijalankan di mesin/CI. **Jangan** menganggap `npm test` hijau = integrasi terbukti. |
| **T-06** | **Verifikasi nyata berhasil tanpa jaringan.** `@electric-sql/pglite` menjalankan **PostgreSQL 18.6 (WASM)** di dalam proses, dengan `citext` & `pg_trgm` asli. `write.ts` dan `migrate()` yang ASLI dieksekusi, bukan tiruan. | T-01/T-04 sebagian **teratasi**: uji integrasi kini SELALU berjalan (61 uji, 0 dilewati). | Dipakai sebagai jalur verifikasi utama. Batas dinyatakan: satu koneksi, tanpa `LISTEN/NOTIFY` antar-proses, sehingga `T-W1`/`T-W2` konkurensi nyata dan uji `pg_notify` lintas proses tetap butuh Postgres jaringan. |
| **T-07** | **Bug nyata di `preflight()`:** `SHOW server_version` mengembalikan kolom `server_version`, bukan `v`; kode membaca `rows[0].v` → `undefined` → `.split` melempar `TypeError`. Sama untuk `SHOW search_path`. | **Runner akan gagal pada Postgres sungguhan mana pun** — dan ini tidak terlihat oleh 9 uji unit karena tidak ada yang menjalankan SQL-nya. | Diganti `current_setting('server_version')` / `current_setting('search_path')`. **Ini bukti langsung bahwa uji integrasi bukan formalitas.** |
| **T-08** | **Kontradiksi desain:** preflight menuntut ekstensi `pgcrypto`, padahal **tidak satu pun** migrasi memakai `gen_random_uuid()`/`crypt()` (UUID dibuat aplikasi, ADR-018). | Instalasi tanpa `pgcrypto` akan gagal karena alasan yang tidak dibutuhkan skema — satu cara gagal yang diciptakan sendiri. | `REQUIRED_EXTENSIONS = ['citext','pg_trgm']`; `0001` tidak lagi memasang `pgcrypto`. |
| **T-09** | **Konflik kepemilikan tabel:** migrasi `0021_schema_migrations.sql` membuat tabel yang **juga** dibuat runner → `relation "schema_migrations" already exists`. | Migrasi ke-21 selalu gagal pada instalasi baru. | Migrasi `0021` **dihapus** (dari `packages/db/migrations` dan `examples/migrations`); `migrations.md` §8 diperjelas: **tabel bookkeeping adalah milik runner, tidak pernah isi migrasi**. Jadi 20 migrasi domain. |
| **T-05** | `tsc -b` memakai `tsbuildinfo` yang menunjuk berkas yang sudah tidak ada setelah commit hilang dari `.git`, sehingga build "sukses" tetapi `dist/` tidak lengkap — dan error muncul sebagai "no exported member" yang menyesatkan. | Diagnosis salah arah selama beberapa menit. | Bersihkan `dist/` + `*.tsbuildinfo` saat hasil build mencurigakan. **Sudah diperbaiki:** kedua berkas `tsconfig.tsbuildinfo` sempat ikut ter-commit (karena `.gitignore` ditambahkan bersamaan), sekarang di-`git rm --cached`. Artefak build tidak boleh masuk repositori. |

---

## 9. Log progres

| Tanggal | Perubahan |
| :--- | :--- |
| 2026-11-12 | Dokumen dibuat. `P0` siap dikerjakan. B1–B3 tercatat sebagai bloker yang **tidak** menghalangi `P0`–`P4`. |
| 2026-11-12 | **VERIFIKASI NYATA.** PGlite (PostgreSQL 18.6 WASM) dipakai untuk menjalankan `write.ts` dan `migrate()` yang ASLI: **61 uji lulus, 0 dilewati**. `P0-07` akhirnya **selesai & teruji**. Tiga bug nyata ditemukan & diperbaiki: T-07 (`SHOW` → `current_setting`), T-08 (`pgcrypto` tidak dibutuhkan), T-09 (migrasi 0021 vs runner). `P1-07`…`P1-09`, `P1-12`, `P1-14` naik dari "kode" menjadi "terbukti pada Postgres". |
| 2026-11-12 | **P1 sebagian**: `P1-01`, `P1-04`…`P1-09`, `P1-12` selesai; `P1-14` jejaknya terbukti. **9 skenario jalur tulis dibuktikan pada PostgreSQL nyata** lewat konektor (versi §10). `P1-15` (handler HTTP) ditambahkan sebagai tugas baru. Temuan T-04 & T-05 dicatat. Jalur tulis: idempotensi REPLAY, versi +1 tepat, no-op tidak menaikkan, 409 versi, 404 lintas tenant, NOTIFY 38 byte, payload 53 byte tanpa deskripsi, kategori event 1→3, `from_value` tersimpan. |
| 2026-11-12 | `P0-01`…`P0-05`, `P0-08`, `P0-09` **selesai**. `P0-07` runner selesai di kode, uji integrasi tertunda (T-01). `npm run verify` hijau: typecheck + lint + 2 uji negatif batas modul + 24 uji unit. 3 temuan dicatat (T-01…T-03). |

---

## 10. Bukti pada PostgreSQL nyata

**Status: diperbarui.** Verifikasi pertama memakai SQL ekuivalen lewat konektor Supabase (karena T-04). **Sekarang tidak perlu** — `@electric-sql/pglite` menjalankan **PostgreSQL 18.6 (WASM)** di dalam proses, sehingga **kode asli** (`applyTaskPatch`, `migrate`) dieksekusi langsung. Lihat T-06.

### 10.1 Uji otomatis (`npm test`) — 61 uji, 0 dilewati

| Berkas | Uji | Isi |
| :--- | --: | :--- |
| `write.int.test.ts` | 13 | `applyTaskPatch` pada Postgres: idempotensi replay, 409 body beda, versi +1, no-op, 409 versi, 404 lintas tenant, payload 100 KB → ≤4 KB tanpa isi, pointer < 64 B, kategori event, `from_value`, `seq` tanpa celah, 403 viewer, dan **status lintas tim ditolak trigger** |
| `migrator.int.test.ts` | 5 | `migrate()` pada Postgres: 20 migrasi, jalan kedua no-op, dry-run nol objek, checksum drift ditolak, celah nomor ditolak, preflight ekstensi hilang |
| unit (`shared`, `db`) | 43 | uuidv7, config, validator, izin, header & checksum migrasi |

### 10.2 Bukti lama (SQL ekuivalen, konektor Supabase 17.11) — tetap berlaku

Schema percobaan `p1test` sudah di-drop; 0 schema tersisa.

| # | Kasus | Hasil |
| --: | :--- | :--- |
| 1 | `T-IDEM` — `operation_id` sama dikirim 2× | **REPLAY**, versi tetap 2 |
| 2 | `INV-04` — versi naik tepat 1 | versi=2 setelah 2 panggilan |
| 3 | `INV-04` — patch tanpa perubahan bersih | **no-op**, versi tidak naik |
| 4 | `expected_version` basi | **VERSION_CONFLICT** (expected 1, aktual 2) |
| 5 | `T-TENANT` — workspace lain | **NOT_FOUND**, keberadaan tidak bocor |
| 6 | `ADR-017` — ukuran pointer `NOTIFY` | **38 byte** (< 64) |
| 7 | `ADR-017` — deskripsi 100 KB | payload `changes` **53 byte**, **tanpa** isi deskripsi |
| 8 | `V3` — event status | `category_from/to` = **1→3** |
| 9 | `T-W2` — jejak nilai lama | `from_value` = `"Judul awal"` |

**Yang TIDAK dibuktikan oleh tabel ini:** bahwa kode TypeScript `write.ts` berperilaku sama. Tabel ini membuktikan **urutannya benar dan constraint-nya bekerja**, bukan bahwa implementasi `pg` bebas bug. Untuk itu `migrator.int.test.ts` + uji integrasi `write.ts` harus dijalankan pada Postgres yang dapat dijangkau.

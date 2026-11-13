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
6. **Setiap merge memperbarui "Ringkasan status" di atas.** Ringkasan itu yang dibaca orang yang baru bergabung; §9 adalah riwayatnya. Memperbarui salah satu tanpa yang lain membuat keduanya saling bertentangan.

---

---

## Ringkasan status (diperbarui setiap merge)

Dokumen ini **hidup**. Bagian ini adalah jawaban satu layar untuk pertanyaan
"apa yang sudah, apa yang sebagian, apa yang belum" — tanpa membaca seluruh
berkas. Bagian rinci ada di §P0–§P5, temuan di §8, bukti di §10.

**Terakhir diperbarui:** 2026-11-13, setelah **PR #17 di-merge** (`76af76f`). **T-39 selesai dan terverifikasi.**

| Metrik | Nilai |
| :--- | :--- |
| Uji cepat (`npm test`) | **307 lulus**, 29 dilewati *dengan alasan tercetak* |
| Uji jaringan (`npm run test:realpg`) | **40 lulus** pada PostgreSQL 18.6 sungguhan |
| Bundel UI | **4,7 KB gzip** (anggaran 60 KB) |
| Di `main` | seluruh kode P0–P4, `docs/testing-realpg.md`, `npm run pg:up`, **CI 4 job hijau** |

### Selesai — dengan bukti yang bisa dijalankan ulang

| Fase | Isi | Bukti |
| :--- | :--- | :--- |
| **P0** | Fondasi repo, config fail-fast, runner migrasi (20 migrasi), penjaga batas modul | 61 uji + uji negatif lint |
| **P1** | Jalur tulis task: idempotensi, versi, izin per-field, isolasi tenant, handler HTTP | 19 uji HTTP + 13 uji integrasi + **28 uji PostgreSQL jaringan** |
| **P2** | Board 4 query, cursor `(sort_key, id)`, detail + riwayat, 50 rb task | p95 15 ms di PGlite; `ix_tasks_board` tanpa `Sort` |
| **P3** | WebSocket server nyata, `LISTEN`/`NOTIFY` lintas koneksi, klasifikasi K1/K2/K3, celah `seq`, pencabutan **terukur 88–91 ms** | 5 uji soket nyata + 3 uji pencabutan (`npm run test:realpg`) |
| **P4** | Board UI berjalan, klien idempoten, rollback optimistis, konflik tidak menimpa, i18n tertegak | 30 uji UI; bundel **4,7 KB gzip** |
| **B-B** | **Login/sesi (FR-112)**: scrypt, `sessions` nyata, login/logout/logout-all/me, batas laju NFR-014, halaman login | 12 uji jaringan + 16 uji HTTP + 19 uji modul; **TC-16** 1 ms, **TC-17** 90 vs 88 ms |
| **B-C** | **Komentar & checklist tulis + validasi transisi status**: 8 rute baru, matriks peran penuh, revisi komentar, soft delete placeholder, posisi checklist ternormalisasi | 15 uji modul + 15 uji integrasi + 19 uji HTTP + 7 uji transisi |
| **T-45/47** | **Penjaga i18n diperbaiki & dibuktikan**: memindai direktori `components/`, dua detektor (literal + teks-dalam-tag), uji-diri di kedua berkas | Probe `<h2>Judul Panjang Liar</h2>` & `"Simpan Perubahan Sekarang"` → suite **MERAH**, hijau setelah dihapus; 314 uji |
| **T-49** | **`Pool` + `server.busy`**: tipe `SqlClient` (bukan `Client`), `withClient` menjamin koneksi kembali, `createDbPool`, 503 `server.busy` di katalog & benar-benar terkirim | **Terukur 8 query bersamaan: 420 ms (pool=5) vs 1621 ms (pool=1)**; 503 terbukti di uji HTTP nyata; 51 uji jaringan |
| **B-D** | **Drill restore + PITR** berjalan pada PostgreSQL 18.6 sungguhan: dump `-Fc` → restore instance terpisah → sidik jari identik; PITR berhenti tepat di `drill_marker`; mode uji-diri membuktikan drill **bisa gagal** | `npm run drill:self-test` — 2 arah terbukti (normal exit 0, tamper exit 1); `docs/restore-drill.md` |
| **T-39** | **Panel detail task**: `<dialog>` modal, komentar (tulis/ubah/hapus), checklist (centang/tambah/hapus), fokus kembali ke kartu | 26 uji UI baru (panel + regresi klik kartu); diverifikasi di DOM tiruan |

### Sebagian — ada buktinya, tapi belum utuh

| # | Apa yang sudah | Apa yang belum |
| :--- | :--- | :--- |
| `P4-04` | Delta diterapkan di klien (versi, pindah kolom) | **Dua jendela nyata < 300 ms belum diukur** — butuh browser, bukan uji unit |
| **B-D** | **Drill restore jalan & lulus pada PostgreSQL sungguhan**: `npm run drill:self-test` — `pg_dump -Fc` → restore ke instance terpisah → sidik jari identik, **plus PITR** (WAL archiving + `recovery_target_name`) yang berhenti tepat di marker; dilengkapi mode uji-diri yang membuktikan drill **bisa gagal** | **NFR-010 belum tertutup**: WAL archiving ke object storage, retensi, enkripsi, dan RPO ≤ 5 menit pada beban produksi belum diukur. Butuh instance persisten — pekerjaan infra, bukan kode |
| **T-49** | **Pool koneksi ADA dan terbukti bekerja** (420 ms vs 1621 ms pada 8 query bersamaan; 503 `server.busy` terkirim) | **Belum diukur pada beban nyata**: angka di atas dari 8 query lokal, bukan 1000 pengguna. `DB_POOL_MAX` masih bawaan 10 dan belum diturunkan dari `max_connections` PostgreSQL produksi. Pool menyelesaikan koneksi **per instans**, TIDAK menyelesaikan batas laju per proses (**T-32** tetap terbuka) |
| `P1-11` | Nomor `ENG-*` unik pada 20 pembuatan bersamaan | Endpoint hapus/pulih task belum ada |
| `P3-01` | Batas 5 tim/koneksi ditegakkan | Presence (ephemeral) belum |
| `P4-03` | Pindah kartu optimistis + rollback | **Drag-and-drop native belum** (T-18) |

### Belum dikerjakan

| # | Hal | Penghalang |
| :--- | :--- | :--- |
| **B-A** | ~~CI tidak ada~~ → **selesai** (`T-25`): 3 job, termasuk matriks Postgres 16/17. Run pertama **gagal** dan menemukan `T-28` (`tsc -b` sukses palsu) — perbaikan terverifikasi lewat simulasi CI dari nol | — |
| **B-B** | ~~Login / penerbitan sesi~~ → **selesai**: sesi diterbitkan & disimpan (`sessions`), demo login sungguhan, sesi tercabut berlaku seketika | Email verifikasi & reset password belum (butuh pengirim email) → **T-33** |
| **B-C** | ~~Komentar, checklist tulis, transisi status~~ → **selesai**: `commenter` kini benar-benar bisa berkomentar; transisi status memvalidasi tim/arsip dan mengisi timestamp | UI komentar & checklist belum ada (rute sudah) → **T-39** |
| `P5`* | Importer Jira (`S1`/`S3`/`S4`/`S6`) | **B1** — berkas ekspor Jira belum ada |
| — | Media/lampiran, email, SSO, goals/cycles (R1), ekspor | Sengaja di luar irisan fase ini (§1) |
| `P2-04`* | `T-PERF1` pada **Supabase**, bukan PGlite | Butuh instance jaringan; angka PGlite **bukan** bukti `NFR-004` |
| — | Uji dua jendela browser (`NFR-003`) | Butuh browser otomatis (Playwright), belum ada |
| — | `T-11` tinjauan framework HTTP | **Wajib sebelum R0** |

### Temuan terbuka (detail di §8)

| # | Ringkas | Dampak bila dibiarkan |
| :--- | :--- | :--- |
| `T-11` | HTTP tanpa Fastify (router sendiri) | Middleware (CORS, multipart) harus ditulis sendiri; rate limit sudah ada sendiri |
| `T-32` | Batas laju disimpan **per proses**, bukan bersama | Dengan N instans, batas efektif jadi N × 10 |
| `T-33` | Verifikasi email & reset password (FR-112) belum ada | Pengguna baru tidak bisa memverifikasi dirinya |
| `T-38` | **Soft delete komentar BUKAN penghapusan data**: `ck_comments_body_len` menolak `body = ''`, jadi teks tetap tersimpan dan hanya tidak dikembalikan | Permintaan "hapus data saya" (privacy) belum bisa dipenuhi. Butuh keputusan retensi |
| `T-39` | ~~Rute ada, UI belum~~ → **selesai**: panel `<dialog>` | — |
| **T-49** | ~~`Deps.db` mengembalikan `Client`, bukan `Pool`; `server.busy` tidak pernah dikirim~~ → **selesai**: `pg.Pool` bisa dipasang, `withClient` menjamin `release`, 503 `server.busy` benar-benar dikirim | — |
| `T-18` | Kartu dipindah lewat `<select>`, bukan drag-and-drop | Pengalaman `UX-5` belum tercapai |
| `T-17`* | Jadwal pencabutan memakai jajak 1 dtk, bukan NOTIFY per-kejadian | Beban query konstan; **terukur 91 ms**, jadi bukan risiko |
| — | Bundle/UI memakai string HTML, bukan framework | Saat komponen butuh state lokal kompleks, ini akan menahan |

`*` = butuh keputusan atau sumber daya dari manusia (lihat §6).

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
| `P1-03` | Repository bertipe: `scope: { workspaceId }` **wajib** | Tidak ada query tanpa `workspace_id` | `INV-12` | **[x]** setiap query di `write.ts`, `create.ts`, dan `routes.ts` memakai `workspace_id`; uji lintas tenant lulus di ketiga lapisan |
| `P1-04` | Validasi body patch + `expected_version` opsional | Body salah → `validation.failed` + `field` | `api-contract.md` §5 | **[x]** 13 uji; field tak dikenal DITOLAK (bukan diabaikan) |
| `P1-05` | Idempotensi: simpan `(actor_id, operation_id)`; ulang = **hasil sama** | Kirim 2× `Idempotency-Key` sama → 1 efek | ADR-015(1), `ENT-19` | **[x]** kode + **terbukti di Postgres**: panggilan ke-2 REPLAY, versi tetap |
| `P1-06` | `operation_id` sama + **body berbeda** → **409** | 409, bukan diterapkan | `ENT-19` | **[x]** kode (hash body + `expected_version`); uji HTTP menyusul di P1-15 |
| `P1-07` | Versi: naik **tepat 1** hanya bila ada perubahan bersih; `task_events` mencatat `from_value` | No-op → versi **tidak** naik | `INV-04`, `INV-07` | **[x]** terbukti: versi=2 setelah 2 panggilan (replay tidak menaikkan); no-op tidak menaikkan; `from_value` tersimpan |
| `P1-08` | `changes` + `NOTIFY`: payload 4 KB, **NOTIFY hanya `(workspace, seq)` ≤ 64 B** | Deskripsi **100 KB** tersimpan; NOTIFY < 64 B; delta < 4 KB | ADR-017, `T-S7` | **[x]** terbukti: pointer **38 byte**, payload **53 byte tanpa isi deskripsi** |
| `P1-09` | `seq` per workspace dari `workspaces.seq_next` | `seq` naik tanpa celah | `ENT-17` | **[x]** kode (`UPDATE … RETURNING seq_next-1`); uji 100 mutasi butuh DB |
| `P1-10` | `trace_id` di setiap error + `code` katalog | Error memuat `code` + `trace_id`; `trace_id` ditemukan di log | `api-contract.md` §5.1, `T-SUP2` |
| `P1-11` | `POST /v1/teams/{id}/tasks` (buat task, nomor dari `team_keys`) | Nomor terbit unik | `ENT-06` | **[x]** 6 uji integrasi + 5 uji HTTP: 45 task → 45 nomor unik, blok dipakai ulang, **menyembuhkan diri** bila nomor sudah terpakai |
| `P1-12` | **Uji isolasi tenant**: user workspace A menembak task workspace B | **404** (bukan 403) | `INV-12` | **[x]** terbukti di Postgres: NOT_FOUND, keberadaan tidak bocor |
| `P1-13` | `T-W1`: dua `PATCH` berbeda field, `expected_version` sama | Tidak ada update yang hilang di bawah konkurensi | ADR-015(3) | **[x]** **PostgreSQL 18.6 nyata, dua koneksi.** Dengan `expected_version`: tepat satu menang, satu 409 (sesuai `api-contract.md` §7.3). **Tanpa** `expected_version`: keduanya bertahan, versi naik 2. 20 PATCH bersamaan → 20 perubahan bertahan. **T-W1 versi TODO bertentangan dengan kontrak — dikoreksi (T-21)** |
| `P1-14` | `T-W2`: dua `PATCH` field **sama** | LWW + jejak nilai lama | ADR-015(3) | **[~]** jejak terbukti (`from_value` = nilai lama); konkurensi nyata belum |
| `P1-15` | Handler HTTP `PATCH /v1/tasks/{id}` memanggil `applyTaskPatch` (tanpa logika sendiri) | Uji HTTP: 400/403/404/409 dengan `code` + `trace_id` | `api-contract.md` §5 | **[x]** 19 uji HTTP end-to-end pada PGlite: 401/400/403/404/409 + `trace_id` di setiap respons |

---

## P2 — Endpoint baca board (target: 1–2 hari)

| ID | Tugas | Kriteria selesai | Rujukan |
| :--- | :--- | :--- | :--- |
| `P2-01` | `GET /v1/teams/{id}/board` — 7 kolom, ≤ 50 task/kolom | Bentuk respons sesuai `api-contract.md`; **4 query total** | `NFR-004` | **[x]** 9 uji integrasi + 4 uji HTTP. Satu `LEFT JOIN LATERAL … LIMIT 51` per kolom → 4 round-trip, index-backed, `truncated` tanpa `count(*)`. Payload 7×50 = **111,6 KB** |
| `P2-02` | Cursor pagination `(sort_key, id)`, **tanpa OFFSET** | Halaman 2 tidak mengulang/melewatkan item saat ada sisipan | `INV-11` | **[x]** 16 uji: sisip 3 task + hapus 1 di antara halaman → **nol duplikat**; `NULL` `due_date` ditangani pembanding baris terpisah; cursor dari urutan lain ditolak |
| `P2-03` | `GET /v1/tasks/{id}` + riwayat `task_events` | Riwayat terurut `seq`; event status membawa `category_*` | `ENT-15` | **[x]** 6 uji integrasi + 4 uji HTTP. Riwayat diambil dari ujung TERBARU lalu dibalik; `events_truncated` jujur; event sistem (`actor` null) tetap tampil |
| `P2-04` | Uji performa `T-PERF1` pada 50 rb task | Rencana query index-backed tanpa `Sort` | `perf-validation.md` | **[x]** 5 uji pada 50.000 task: `ix_tasks_board` dipakai, **tanpa `Sort`**; p95 PGlite **15,2 ms**. Bukan bukti SLO (PGlite ≠ Supabase) — SLO tetap dari `perf-validation.md` |

---

## P3 — Real-time (target: 2–3 hari) · *inti ADR-017*

| ID | Tugas | Kriteria selesai | Rujukan |
| :--- | :--- | :--- | :--- |
| `P3-01` | WS hub: langganan **per tim**, maks 5 tim/koneksi | Tim ke-6 ditolak dengan `code` yang jelas | `realtime-and-search.md` §2 | **[x]** 12 uji: tim ke-6 masuk `rejected` (bukan diam), tim bukan anggota ditolak per-tim tanpa menggagalkan tim lain |
| `P3-02` | `LISTEN` → baca `changes` → fan-out delta | Perubahan dari koneksi A sampai ke klien di B | ADR-006, ADR-017 | **[x]** `LISTEN`/`NOTIFY` **lintas koneksi nyata**: mutasi pada koneksi penulis → frame sampai ke klien WebSocket. NOTIFY hanya pointer; deskripsi 100 KB tidak pernah masuk NOTIFY |
| `P3-03` | Klien menerapkan delta hanya bila `version` > lokal | Delta lebih tua diabaikan, bukan diterapkan | ADR-015(5) | **[x]** 3 uji: versi lebih tinggi diterapkan, versi sama/lebih tua diabaikan, perubahan `status_id` memindahkan kartu |
| `P3-04` | Deteksi celah `seq` → minta rentang; bila tak ada → **bootstrap ulang** | Klien tertinggal 10 menit pulih tanpa state aneh | ADR-015(6) | **[x]** celah seq → `resync_required: true` dan **tidak ada** delta parsial dikirim |
| `P3-05` | Klasifikasi **K3 tidak pernah disiarkan** (`audit_event`, `email`, `job`, `import`, `notification`) | Uji: mutasi K3 → tidak ada frame keluar | `realtime-and-search.md` §1 | **[x]** ditegakkan di **titik keluar** (`toFrame`), bukan hanya "tidak sengaja tidak dikirim"; entitas tanpa klasifikasi default **tidak** disiarkan |
| `P3-06` | Pencabutan akses → putus koneksi < 5 s + bersihkan cache klien | Uji: user dicabut, klien berhenti menerima | `realtime-and-search.md` §5 | **[x]** diukur: **88–91 ms** (SLA 5 000 ms). `RevocationWatcher` memantau `team_members.revoked_at` tiap 1 dtk; `revoked` diterima, delta berhenti, HTTP berikutnya 404. Restart server **tidak** memicu false positive |

---

## P4 — Board UI (target: 3–4 hari)

| ID | Tugas | Kriteria selesai | Rujukan |
| :--- | :--- | :--- | :--- |
| `P4-01` | Klien API: `Idempotency-Key` otomatis + retry | Retry jaringan → tidak ada duplikat | ADR-015 | **[x]** 5 uji: kunci **sama** di setiap percobaan, galat jaringan diulang, 409 **tidak** diulang, GET tanpa kunci |
| `P4-02` | Board 7 kolom, render dari `P2-01` | Muat < 800 ms p95 pada dataset acuan | `NFR-004` | **[x]** 7 uji render + demo berjalan di port 3000. Kolom kosong tetap tampil; judul **di-escape** |
| `P4-03` | Perpindahan kartu → `PATCH` optimistis + rollback saat gagal | Gagal → kartu kembali + pesan, **bukan** diam | `UX-5` | **[x]** 4 uji: rollback ke kolom & **indeks semula**, pesan + `trace_id`; target sama = nol request. **Drag-and-drop native belum** — kontrolnya `<select>` per kartu (T-18) |
| `P4-04` | Terapkan delta WS (K1 patch, K2 entitas) | Dua jendela: perpindahan terlihat < 300 ms | `NFR-003` | **[~]** 3 uji penerapan delta di klien (versi, pindah kolom). **Transport WS belum hidup** (T-16), jadi dua-jendela belum diuji |
| `P4-05` | Konflik 409 → tampilkan state kanonik + pilihan, **jangan menimpa** | Uji: dua editor field sama | ADR-015(3) | **[x]** kartu kembali, `mine` vs `theirs` ditampilkan **berdampingan**, state kanonik disimpan |
| `P4-06` | Tanggal/angka lewat modul format (tidak ada format manual) | `T-I18N3` | `i18n.md` §3 | **[x]** 6 uji format + 2 uji **pemindai sumber**: `getDate()`, `toFixed()`, `"+"/"+"` ditolak di komponen |
| `P4-07` | Tidak ada string UI di komponen | `T-I18N1` | `i18n.md` §2 | **[x]** 3 uji yang **membaca berkas komponen** dan gagal bila ada kalimat siap-tampil |
| `P4-08` | Anggaran bundle `UX-B1` | `npm run bundle:check` hijau | `ux-principles.md` | **[x]** **9,6 KB mentah / 3,8 KB gzip** — jauh di bawah anggaran 60 KB |

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
| **T-10** | **Alokasi nomor salah:** `allocateNumber` menaikkan `next_number` pada **setiap** panggilan, sehingga 45 task menghasilkan nomor sampai **441** — blok tidak pernah dipakai, hanya terus dipesan. | Penomoran `ENG-*` melompat jauh; pengguna akan mengira task hilang. | Ditangkap uji karena memeriksa **nomor tertinggi**, bukan hanya keunikan. Diperbaiki: pakai sisa blok bila ada, pesan blok baru bila habis — satu `UPDATE … RETURNING` sehingga baris terkunci. |
| **T-12** | ~~PGlite **satu koneksi**, sehingga `T-W1`/`T-W2` **konkurensi simultan** tidak bisa diuji~~ | ~~`FOR UPDATE` belum pernah benar-benar berlomba~~ | **SELESAI** — PostgreSQL 18.6 nyata dijalankan di sandbox (`npm run pg:up`). Lihat T-21/T-22 untuk bug yang ditemukan begitu dua koneksi benar-benar ada. |
| **T-21** | **Kontradiksi dokumen.** TODO `P1-13`/`T-W1` menuntut dua PATCH beda field dengan `expected_version` sama **keduanya berhasil**; `api-contract.md` §7.3 menuntut **409** bila `expected_version` ≠ versi server, tanpa memandang field. | Implementasi mengikuti kontrak (409). Tanpa koreksi, uji akan "gagal" selamanya atau implementasi dibengkokkan untuk memenuhi TODO. | Kriteria TODO dikoreksi: yang penting adalah **tidak ada update yang hilang**, bukan okCount. Dua uji menggantikannya: (a) `expected_version` = penjaga seluruh entitas → 409; (b) tanpa `expected_version`, dua patch beda field bertahan bersamaan. **Kontrak menang.** |
| **T-22** | **Nomor task ganda di bawah konkurensi.** `allocateNumber` menghitung `MAX(number)` di dalam statement yang SAMA dengan `UPDATE` (CTE). Pada READ COMMITTED, transaksi kedua memakai snapshot sebelum transaksi pertama commit, lalu menunggu row lock dengan `MAX` yang basi → dua task mendapat nomor sama → `uq_tasks_team_number`. | 20 pembuatan task bersamaan: **2 gagal** (18/20). Pengguna melihat galat acak pada pembuatan task saat tim ramai — bug yang mustahil ditemukan PGlite. | `SELECT ... FOR UPDATE` pada `team_keys` **sebelum** menghitung `MAX`; statement berikutnya mengambil snapshot baru. 20/20 sekarang. |
| **T-23** | **`muted frame` hilang karena race di uji**, bukan di server: pendengar `message` dipasang setelah `send`, sehingga frame `subscribed` yang cepat terlewat. | Uji gagal sesekali; orang akan menyalahkan server. | Antrean pesan dipasang **sebelum** `open`/`send`. Pelajaran sama seperti uji P2: waktu pemasangan pendengar menentukan hasil. |
| **T-24** | `scripts/realpg.sh` gagal pada `initdb`: `cannot open shared object libpq-<hash>.so`. Wheel `embedded-postgres` menaruh pustaka bersama di `embedded_postgres.libs/` **di luar** `pginstall`. | Skrip hanya bekerja di mesin tempat direktori itu kebetulan sudah ada — orang lain akan menyerah. | Skrip mengekstrak `embedded_postgres.libs/` dan menambahkannya ke `LD_LIBRARY_PATH`. **Diverifikasi dari nol** (`rm -rf` lalu `npm run pg:up`). |
| **T-12** | PGlite **satu koneksi**, sehingga `T-W1`/`T-W2` **konkurensi simultan** tidak bisa diuji: dua `PATCH` benar-benar bersamaan tidak dapat dijalankan. | `FOR UPDATE` dan `UPDATE … WHERE version = $n` di `write.ts` **belum pernah benar-benar berlomba**. Kesalahan di sini muncul sebagai kehilangan data pada pengguna nyata. | Diuji sejauh mungkin lewat HTTP (penulis kedua → 409). **Sisa risiko dinyatakan terbuka**, bukan dianggap selesai. Butuh Postgres jaringan dengan dua koneksi. |
| **T-13** | **`team_keys` bisa tertinggal dari `tasks`**: baris `team_keys` dengan `next_number=1` sementara task nomor 1 sudah ada → `uq_tasks_team_number` → **500**. Terjadi pada data impor dan pada task yang dibuat sebelum mekanisme blok ada. | Pembuatan task gagal total untuk tim tersebut. | Alokasi sekarang **menyembuhkan diri**: counter dinaikkan melewati `MAX(number)+1` dalam query yang sama. Ini kondisi yang **pasti** dihadapi importer. |
| **T-16** | ~~**WebSocket server belum hidup.**~~ **SELESAI**: `ws@8.18` ditambahkan, `hub.attach()` melakukan upgrade nyata, autentikasi **sebelum** upgrade (401 tanpa sesi), dan 5 uji soket nyata lulus. Node 22 punya `WebSocket` **global**, tetapi itu hanya sisi KLIEN. Membangun sisi SERVER (membaca frame, masking, control frame) butuh `ws` atau setara. | `P3-02`, `P3-04`, dan `P4-04` teruji **logikanya** (klasifikasi, celah seq, fan-out, penerapan delta) tetapi **belum pada soket nyata**. Dua-jendela < 300 ms belum diukur. | Sengaja tidak menambah dependensi di tengah P3 (konsisten dengan T-11). Autentikasi **sebelum** upgrade sudah ditulis & ditegakkan. **Wajib diselesaikan sebelum klaim real-time.** |
| **T-17** | ~~`LISTEN`/`NOTIFY` lintas proses **belum ada**~~ **SELESAI**: `hub.startListening()` + `pg_notify` di `write.ts` terbukti sampai ke klien WebSocket lintas koneksi. Sisa: **jadwal pencabutan** (`team_members` → `revokeTeam`) belum ada, jadi "pencabutan < 5 s" belum diukur. PGlite satu koneksi; tidak ada proses pemantau `team_members`. | Klaim "pencabutan < 5 s" (TC-15) belum diukur; `resync_required` diuji secara logika, bukan setelah retensi 24 jam nyata. | Batas dinyatakan terbuka. Butuh Postgres jaringan + dua proses. |
| **T-18** | Kontrol pindah kartu memakai `<select>` per kartu, **bukan** drag-and-drop native. | Menggerakkan kartu butuh dua Tab + Enter; bukan pengalaman `UX-5` yang dituju. | Keputusan fase: membuktikan `PATCH` optimistis + rollback + konflik lebih dahulu daripada gesture. Struktur kartu sudah `draggable="true"`, jadi DnD tinggal mengikat event. **Wajib sebelum R0 dinilai.** |
| **T-25** | **Tidak ada CI sama sekali.** `.github/workflows/` kosong sejak P0, sehingga 189 uji hanya berjalan bila seseorang ingat menjalankannya. | Kode di `main` **terlihat** teruji, dan tidak ada yang memberi tahu bahwa tidak ada yang menjaganya. Ini kelas kegagalan yang tak terlihat — karena itu paling berbahaya dari semua yang tercatat di dokumen ini. | `.github/workflows/verify.yml`: 3 job (unit, matriks Postgres 16/17, penjaga repo). `testing-strategy.md` §10 butir 6 mensyaratkan matriks 16/17; sebelumnya hanya 16.2 & 18.6 pernah dijalankan. |
| **T-26** | **Gerbang "jangan hijau palsu" saya sendiri salah dua kali.** (a) `grep skipped` tanpa angka → selalu `exit 0`. (b) `grep ... \| head -1` pada log unit membaca **7** (berkas pertama), bukan **17** (total), sehingga CI akan gagal tanpa alasan yang benar. | CI merah acak, atau lebih buruk: hijau sementara semua uji jaringan dilewati. | Diperbaiki: `scripts/assert-not-skipped.sh` mencocokkan **angka + kata** dan menolak log tanpa uji; job unit mencocokkan baris **ringkasan** dan mengharuskan tepat 17. Kedua arah diuji pada log nyata. |
| **T-29** | **Gerbang CI memberi positif palsu pada log CI yang sebenarnya.** `grep "[0-9]+ skipped"` pada SELURUH log ikut mencocokkan baris `Test Files … skipped` dan nama berkas, sehingga job database dinyatakan gagal padahal 28 uji lulus. Penyebab tambahan: di CI hanya berkas yang cocok yang dijalankan (`5 passed`), sedangkan lokal semua berkas ikut (`28 passed`). | CI merah terus-menerus → orang berhenti mempercayainya. Gerbang yang salah lebih berbahaya daripada tidak punya gerbang, karena ia mengajarkan untuk mengabaikan merah. | Dua skrip, masing-masing memeriksa **hanya baris ringkasan** (`^ *Tests`): `assert-not-skipped.sh` (job database) dan `assert-skip-count.sh` (job unit, mengharuskan tepat 17). Keduanya diuji pada **tiga** log nyata: 5-passed → lolos, 6-skipped → tolak, 189\|17 → tolak untuk gerbang database. |
| **T-30** | **Log teks dari pipe tidak bisa diandalkan di CI.** Gerbang membaca `/tmp/unit.log` hasil `\| tee`, padahal vitest menulis progres ke TTY sehingga berkasnya bisa kosong di runner. Annotation CI membuktikannya: *"tidak ada baris ringkasan uji di log"* dan *"tidak ada uji yang lulus"* — padahal 28 uji lulus. | Dua gerbang merah tanpa alasan nyata; orang akan mematikan gerbangnya. | Gerbang membaca **JSON** (`--reporter=json --outputFile`), bukan teks. `scripts/test-gate.mjs` diuji pada **empat** keadaan: 30 lulus, 0 dilewati, semua dilewati, berkas tidak ada — plus log `npm test` sebenarnya (189\|17). Tiga skrip gerbang sebelumnya dihapus agar tidak ada dua kebenaran. |
| **T-27** | Penjaga kredensial CI menandai `packages/shared/src/config.test.ts` sebagai kebocoran (`postgres://u:p@localhost/db` di fixture). | Penjaga yang memblokir setiap PR akan dimatikan orang, dan setelah dimatikan ia tidak menjaga apa pun. | Berkas uji dikecualikan. Setiap penjaga baru harus diuji pada repo **yang sudah bersih**, bukan hanya pada kasus buruk. |
| **T-28** | **`tsc -b` diam-diam tidak membangun apa pun.** `tsconfig.tsbuildinfo` dianggap bukti "project sudah dibangun", padahal `dist/` dihapus (`rm -rf dist`, `git clean`, clone + cache). `tsc -b` keluar **0** tanpa satu pun `.js`. | CI run **pertama gagal total** dengan "Failed to resolve entry for package @kelindan/db". Hijau di mesin penulis (punya `dist/`), merah di mana pun yang mulai dari nol. Ini **T-05 kambuh** dalam bentuk yang lebih berbahaya: sebelumnya itu galat palsu, sekarang **sukses palsu**. | `scripts/build.mjs`: `tsc -b --force` + **verifikasi berkas hasil** (`dist/index.js` harus ada), bukan percaya exit code. `npm run verify` **dan** CI sama-sama memakainya; `typecheck` tidak lagi dipakai sebagai langkah build di mana pun. Dampaknya juga terasa lokal: `npm run verify` melaporkan **75** uji alih-alih 189 ketika `dist/` hilang — dan itu tidak terlihat sampai dihitung. Diverifikasi dengan simulasi CI dari nol (`/tmp/ci-sim`, `node_modules` dihapus). |
| **T-19** | `apps/server` dan `packages/server` sama-sama bernama `@kelindan/server` (warisan `70049ea`). | `npm install` **apa pun** gagal dengan `EDUPLICATEWORKSPACE` — termasuk `npm ci` di CI. | Ditemukan saat mencoba menambah `esbuild`. `apps/server` di-rename `@kelindan/server-app` (composition root). **Ini bug yang akan mematikan CI hari pertama.** |
| **T-20** | `Idempotency-Key` non-UUID sampai ke PostgreSQL (`operation_id` bertipe `uuid`) → **500**, bukan 400. Ditemukan saat menjalankan demo, bukan lewat uji. | Klien yang salah melihat galat server; operator disuruh mencari log untuk kesalahan klien. | Bentuk kunci diperiksa di handler. Kontrak `api-contract.md` §6 menyebut `<ULID>` tetapi kolomnya `uuid` — **UUIDv7 yang diterima**, dicatat sebagai penyimpangan sadar. |
| **T-14** | **Index `ix_tasks_board` tidak dipakai untuk urutan board.** Index menyimpan `id` **ASC** (bawaan), sedangkan board mengurutkan `updated_at DESC, id DESC`. PostgreSQL tidak bisa memakai index untuk campuran arah → menambah `Incremental Sort` di atas **7.200 baris/kolom**. | Terukur: board 50 rb task **p95 ~900 ms**; setelah arah `id DESC` ditambahkan → **15 ms**. Pada 500 rb baris ini menjadi kegagalan `NFR-004` yang diam-diam, persis yang diperingatkan `perf-validation.md`. | Ditemukan P2-04 lewat `EXPLAIN`, bukan lewat angka. **Pelajaran: "index sudah ada" ≠ "index dipakai".** Definisi index diperbaiki di `0009_tasks.sql` + `data-model.md`. |
| **T-15** | **Window function memindai seluruh tabel.** Versi pertama `loadBoard` memakai `row_number() OVER (PARTITION BY status_id)` agar semua kolom dalam satu query. `PARTITION BY` tidak bisa berhenti lebih awal → PostgreSQL memindai **49.000 baris** untuk mengembalikan 350. | Sama seperti T-14: p95 ~900 ms pada 50 rb, gagal pada 500 rb. | Diganti `LEFT JOIN LATERAL (… ORDER BY … LIMIT 51) ON true`: satu round-trip, tiap kolom memakai index dan berhenti di 51, `LIMIT 51` memberi `truncated` tanpa `count(*)`. |
| **T-11** | Menyimpang dari `repo-layout.md` §2: HTTP memakai **router bawaan Node**, bukan Fastify. | Tidak ada middleware bawaan (CORS, rate limit, multipart). | Sengaja: fase ini membuktikan **kebenaran jalur tulis**, bukan memilih framework. Tiap dependensi menambah permukaan yang harus dipercaya sebelum ada satu pengguna. Logika ada di `routes.ts`, jadi penggantian framework tidak menyentuh rute. **Wajib ditinjau sebelum P4.** |
| **T-44** | **Klik kartu memfokuskan `<select>` status.** Perilaku ini terpasang sejak P4 dan tidak pernah diuji. | Klik untuk MELIHAT langsung menaruh fokus pada kontrol yang MENGUBAH data; satu tekan panah + Enter memindahkan task tanpa niat. Jebakan, bukan fitur. | Klik (dan Enter/Spasi) membuka panel; klik pada `select`/`button`/`input` di dalam kartu diabaikan. Diuji dengan DOM tiruan, termasuk jalur keyboard. |
| **T-45** | **Penjaga i18n memakai daftar berkas per nama.** `no-strings.test.ts` dan `no-manual-format.test.ts` menyebut `board.ts` dan `main.ts` secara eksplisit. | Berkas komponen BARU otomatis lolos dari kedua aturan — tepat ketika ia paling perlu diperiksa. Aturan yang dijaga daftar manual akan bolong setiap kali ada berkas baru. | **SELESAI.** Kedua penjaga kini memakai `apps/web/src/i18n/scan.ts` → `componentFiles()` yang memindai direktori `components/` (melewati `*.test.ts`, menambahkan `main.ts`). Ditambah `MIN_EXPECTED_FILES` agar direktori yang tiba-tiba kosong tidak menghasilkan hijau palsu. |
| **T-47** | **Penjaga "tidak ada string di komponen" hampir tidak menjaga apa pun.** Regex lama `["'\`]([A-Z][a-z]+ [a-z]+[^"'\`]*)` menaruh penutup di dalam kelas karakter yang sama dengan pembuka, sehingga **hanya bisa cocok pada satu kata**. Selain itu tidak ada detektor yang memeriksa teks **di dalam tag HTML**. | Aturan ini ada sejak P4 dan selama itu **tidak pernah bisa menangkap** `"Judul Panjang Liar"` maupun `<h2>Judul Panjang Liar</h2>` — dua bentuk yang justru paling sering muncul karena komponen di sini membangun HTML sebagai string. Guard yang selalu hijau tidak bisa dibedakan dari guard yang rusak. | **SELESAI.** Dua detektor: `PLAIN_SENTENCE` (literal berkutip) dan `HTML_TEXT` (teks di antara tag), dengan daftar putih untuk istilah teknis. Kedua berkas uji kini memuat **uji-diri** (kasus positif dan negatif) plus penegasan `files.length >= MIN_EXPECTED_FILES`. Dibuktikan dengan probe sungguhan: `zz-probe4.ts` berisi `<h2>Judul Panjang Liar</h2>` dan `zz-probe5.ts` berisi `"Simpan Perubahan Sekarang"` masing-masing membuat suite **MERAH**, lalu hijau setelah probe dihapus. |
| **T-48** | **`npm run migrate` selalu gagal.** Skrip memakai `node --experimental-strip-types packages/db/src/cli.ts`, yang hanya MEMBUANG tipe dan tidak menyelesaikan impor `./migrator.js` → `./migrator.ts`. | `migrate` adalah perintah yang dijalankan operator saat menyiapkan database — termasuk saat drill restore. Perintah yang selalu gagal dengan `ERR_MODULE_NOT_FOUND` berarti prosedur pemulihan bencana tidak bisa dijalankan mengikuti dokumentasi. Ditemukan justru **karena drill dijalankan**, bukan lewat tinjauan kode. | **SELESAI.** Skrip memakai `node packages/db/dist/cli.js` (hasil `npm run build`, sudah diverifikasi `build.mjs`). Ditambah pesan fail-fast bila `DATABASE_URL` kosong, karena tanpa itu galatnya `ECONNREFUSED` yang menyesatkan ke arah jaringan. |
| **T-50** | **`RevocationWatcher.poll()` tidak pernah melepaskan koneksi.** Ditemukan saat `npm run dev` dijalankan dengan `DATABASE_URL` (jalur yang sebelumnya belum pernah dipakai): login mengembalikan **503**. | `poll()` berjalan **tiap detik**; dengan `pg.Pool` setiap jajak menahan satu koneksi selamanya. Sepuluh detik cukup menghabiskan pool `max: 10`, dan setelah itu SEMUA endpoint 503 — dengan gejala yang menyesatkan (login gagal, padahal tidak ada hubungannya dengan pencabutan). | **SELESAI.** `release` di `finally`; tiga uji regresi (`revocation-pool.test.ts`) menghitung koneksi tertahan. Dibuktikan di server sungguhan: login 200 dan jumlah koneksi stabil di 3 setelah 12 jajak. |
| **T-51** | **`login()` membocorkan koneksi pada SETIAP kegagalan.** Klien diambil sekali, tidak pernah dikembalikan. | Jalur gagal (password salah, email belum diverifikasi) adalah yang paling sering terjadi saat penyerang menebak password — jadi pool habis tepat ketika sistem sedang diserang. Ditemukan dengan membaca ulang alur setelah `Pool` bisa dipasang. | **SELESAI.** `try/finally`; jalur galat diuji sama seriusnya dengan jalur sukses. |
| **T-52** | **`npm run dev` dengan `DATABASE_URL` tidak bisa dijalankan dua kali.** `dev-server` memakai `applyMigrations` dari `@kelindan/testing` — alat uji yang menjalankan SEMUA migrasi tanpa melacak versi. | Pada PGlite yang selalu kosong itu tidak masalah. Pada PostgreSQL yang dipakai berulang, run kedua gagal `relation "workspaces" already exists`, sehingga `npm run dev` mengharuskan database dihapus lebih dulu. Hanya terlihat dengan MENJALANKAN server. | **SELESAI.** Jalur `DATABASE_URL` memakai runner `migrate()` sungguhan. |
| **T-46** | **`el.dataset` bisa `undefined` pada target klik.** Ditemukan oleh uji DOM tiruan di handler `dismissConflict`. | Satu klik pada simpul non-elemen melempar TypeError dan **mematikan handler lain yang terpasang setelahnya** — kerusakan yang tidak terlihat sampai ada fitur yang berhenti merespons. | Optional chaining pada `dataset`. Uji regresi menambahkan store tiruan lengkap agar kegagalan muncul karena perilaku, bukan karena tiruan yang kurang. |
| **T-40** | **Peran `commenter` tidak bisa berkomentar.** Matriks `PERMISSIONS` hanya memberinya `TASK_VIEW` + `BOARD_READ`. | Nama peran berbohong tentang kemampuannya, dan `rbac.md` baris 188 menyebut berkomentar sebagai SELURUH alasan peran itu ada. Tidak ada uji yang menangkapnya karena tidak ada rute komentar untuk diuji. | Tiga action komentar ditambahkan untuk `commenter`, tanpa satu pun hak menulis task. Uji matriks peran kini menegakkan keduanya sekaligus. |
| **T-41** | **Tiga dari empat validasi transisi status di `api-contract.md` §7.4 tidak ada.** Status tim lain sampai ke trigger DB (500, bukan 400); status **terarsip diterima**; `completed_at`/`started_at`/`canceled_at` **tidak pernah diisi**. | (a) Klien melihat 500 untuk kesalahan sendiri. (b) Task masuk kolom yang disembunyikan dari board: muncul di laporan, hilang dari UI. (c) Metrik "berapa lama task selesai" tidak punya data sama sekali — dan `INV-07` first-touch tidak pernah diuji karena tidak ada yang mengisi. | Uji ditulis lebih dulu dan **gagal seperti yang diharapkan**, lalu divalidasi di `write.ts`: tim sama (400), tidak terarsip (400), dan `COALESCE(kolom, now())` untuk ketiga timestamp. First-touch diuji dengan bolak-balik status. |
| **T-42** | **`SET body = ''` pada soft delete komentar melanggar `ck_comments_body_len`** (body 1–16384). | Rencana awal (kosongkan teks) tidak mungkin dieksekusi; percobaan pertama gagal pada uji. | Teks tetap disimpan, hanya **tidak dikembalikan** (`body = NULL` ke klien). Konsekuensinya bukan detail: ini **bukan** penghapusan data → **T-38**. |
| **T-43** | **`DELETE /v1/comments/:id` dua kali memberi 404.** `canDeleteComment` menolak dengan alasan `deleted`. | Klien yang retry setelah timeout menerima 404 untuk operasi yang **sudah berhasil**, lalu menampilkan "komentar tidak ditemukan" kepada pengguna yang baru saja menghapusnya. | Idempotensi menang atas "sudah dihapus" — tetapi hanya untuk yang memang berhak (izin diperiksa dengan `deletedAt = null`, jadi 403 tetap untuk orang lain). |
| **T-31** | **Argon2id (FR-112) diganti scrypt bawaan `node:crypto`.** `@node-rs/argon2` sudah diuji dan **berjalan** (781 KB, binary prebuilt, `m=19456,t=2,p=1`), jadi ini bukan pengganti karena gagal. | Satu binary pihak ketiga di jalur instalasi berarti satu kelas kegagalan build yang tidak ada hubungannya dengan kode kita. | scrypt `N=2^15, r=8, p=1` (memory-cost ~32 MiB, 17 ms hash / 10 ms verifikasi). Format hash menyimpan algoritma + parameter, jadi migrasi per-user mungkin tanpa reset massal. **Penyimpangan dari PRD dicatat, bukan disembunyikan.** |
| **T-32** | **Batas laju disimpan di memori proses.** NFR-014 meminta 10 login/menit/IP. | Dengan N instans, batas efektif menjadi N × 10 — cukup untuk menebak password bila penerapan horizontal dilakukan tanpa memindahkan penghitung. | Diterima untuk R0 (satu instans). Sebelum skala horizontal, penghitung harus pindah ke Redis/Postgres. Dicatat di `rate-limit.ts` pada kode, bukan hanya di sini. |
| **T-33** | **Verifikasi email & reset password (FR-112) belum ada.** Tabel `email_message` ada, pengirimnya belum. | Pengguna baru dibuat dengan `email_verified_at = NULL` dan **ditolak login** (403 `auth.email_unverified`). Tanpa alur verifikasi, tidak ada pendaftar yang bisa masuk. | Ditunda bersama pekerjaan email. Sampai saat itu akun harus dibuat dengan `email_verified_at` terisi (seed demo melakukannya). **Ini bloker onboarding nyata**, bukan detail. |
| **T-34** | **`packages/testing` mengimpor `{ Client }` dari `pg` (CommonJS).** Berhasil di bawah vitest (interop sendiri), **gagal di Node biasa**: *"Named export 'Client' not found"*. | `npm run dev` **tidak bisa start sama sekali** — dan tidak ada satu uji pun yang menangkapnya, karena seluruh uji berjalan di vitest. Seluruh suite hijau sementara aplikasi tidak bisa dijalankan. | Impor default + destructuring, dengan tipe `Client` diekspor terpisah. **Pelajaran: uji yang semuanya berjalan di satu runner tidak membuktikan aplikasi bisa dijalankan.** Diverifikasi dengan menjalankan `dev-server` sungguhan. |
| **T-35** | **`staticHandler` ditulis ke objek `deps` SETELAH `createApp` menyalinnya** → UI tidak pernah tersaji (`/` dan `/main.js` = 404). | Aplikasi tampak "jalan" (API 200) tetapi tidak bisa dibuka di browser. | Dipasang sebelum `createApp`. Ditemukan hanya dengan **menjalankan server lalu `curl`**, bukan dari uji. |
| **T-36** | **Adaptor PGlite melaporkan `rowCount` salah untuk `UPDATE`/`DELETE`** (`rowCount: rows.length` → selalu 0 tanpa `RETURNING`). Perbaikan pertama juga salah: `affectedRows ?? rows.length` menghasilkan **0 untuk `SELECT`**, karena PGlite memberi `affectedRows: 0` (bukan `undefined`). | (a) "logout-all mencabut N sesi" tampak rusak padahal benar. (b) Setelah perbaikan salah: **9 uji integrasi gagal "Task tidak ditemukan"** — pemeriksaan "task ada?" menjawab *tidak* untuk task yang **ada**. Adaptor yang berbohong lebih berbahaya daripada adaptor yang menolak. | `rowCount` ditentukan oleh `command` (`SELECT` → `rows.length`, selain itu → `affectedRows`), sama seperti `pg`. |
| **T-37** | **Penangkal enumerasi waktu memakai parameter scrypt yang salah.** `burnPasswordTime` memakai `scrypt()` default (`N=16384`) sedangkan hash asli `N=32768`. | Terukur `TC-17`: **84 ms vs 40 ms** — selisih 2x sudah cukup untuk memetakan akun tanpa menebak password. Fungsi yang dibuat untuk menutup kebocoran justru membocorkan. | Parameter diseragamkan → **90 ms vs 88 ms**. Ambang uji diketatkan dari 2.5x ke **1.35x**: uji pertama *lulus* pada 84/40 karena ambangnya longgar — ambang longgar sama dengan tidak punya uji. |
| **T-05** | `tsc -b` memakai `tsbuildinfo` yang menunjuk berkas yang sudah tidak ada setelah commit hilang dari `.git`, sehingga build "sukses" tetapi `dist/` tidak lengkap — dan error muncul sebagai "no exported member" yang menyesatkan. | Diagnosis salah arah selama beberapa menit. | Bersihkan `dist/` + `*.tsbuildinfo` saat hasil build mencurigakan. **Sudah diperbaiki:** kedua berkas `tsconfig.tsbuildinfo` sempat ikut ter-commit (karena `.gitignore` ditambahkan bersamaan), sekarang di-`git rm --cached`. Artefak build tidak boleh masuk repositori. |

---

## 9. Log progres

| Tanggal | Perubahan |
| :--- | :--- |
| 2026-11-13 | **T-49 selesai: `Pool` bisa dipasang, `server.busy` benar-benar dikirim — dan tiga kebocoran koneksi ditemukan saat MENJALANKAN server.** Sebelumnya `Deps.db` bertipe `() => Promise<Client>`, jadi satu-satunya cara memasangnya adalah SATU koneksi untuk seluruh proses; `server.busy` terdaftar di kontrak tetapi tidak ada di katalog `ERROR_CODES` dan tidak pernah dikirim. Kini: tipe `SqlClient` (hanya `query`) di `@kelindan/db` & server, `withClient()` yang menjamin `release` di `finally`, `createDbPool()` (max 10, timeout 5 dtk, handler `pool.on("error")`), dan pemetaan galat pool -> **503 `server.busy`**. **Terukur: 8 query bersamaan 420 ms dengan pool=5 vs 1621 ms dengan pool=1.** Tiga bug nyata ditemukan justru karena jalur `DATABASE_URL` akhirnya dijalankan: **T-50** `RevocationWatcher.poll()` menahan satu koneksi tiap detik (login jadi 503 dalam ~10 dtk), **T-51** `login()` membocorkan koneksi di setiap jalur gagal, **T-52** `npm run dev` dengan `DATABASE_URL` gagal pada run kedua karena memakai `applyMigrations` (alat uji tanpa pelacakan versi). Semua diperbaiki dan diuji. Bukti server sungguhan: login **200**, koneksi **stabil di 3** setelah 12 jajak. 332 uji unit + 51 uji jaringan. |
| 2026-11-13 | **B-D: drill restore LULUS pada PostgreSQL sungguhan — dan NFR-010 dinyatakan BELUM tertutup.** `scripts/restore-drill.sh`: dump `-Fc` → restore ke instance terpisah (port 55432) → sidik jari identik (jumlah baris, jumlah versi, md5 himpunan id). Dilanjutkan **PITR sungguhan**: `archive_mode`, `pg_basebackup`, `pg_create_restore_point`, recovery ke nama marker → berhenti tepat di marker dan baris sesudahnya tidak ikut pulih. Ditambah **mode uji-diri** (`npm run drill:self-test`) yang merusak satu nilai `version` dan memastikan drill **MENOLAK** (exit 1) — karena drill yang selalu lulus tidak membuktikan apa pun. Empat kesalahan urutan ditemukan dengan MENJALANKAN drill, bukan membacanya: `archive_mode` butuh restart (bukan reload), `pg_basebackup` harus sebelum `pg_switch_wal()`, menunggu `last_archived_wal` MAJU (bukan nomor segmen), dan restore point harus dibuat SESUDAH base backup. Runbook: `docs/restore-drill.md`. **Yang masih terbuka:** WAL archiving ke object storage, retensi, enkripsi, dan RPO ≤ 5 menit pada beban produksi — pekerjaan infra, butuh instance persisten. Juga ditemukan **T-48**: `npm run migrate` selalu gagal, diperbaiki ke `dist/cli.js`. |
| 2026-11-13 | **T-45 + T-47 selesai**: penjaga i18n memindai direktori `components/` (bukan daftar manual) dan regex-nya diperbaiki. Regex lama hanya bisa mencocokkan SATU kata, sehingga `"Judul Panjang Liar"` dan `<h2>Judul Panjang Liar</h2>` lolos sejak P4 — guard yang selalu hijau. Kedua berkas kini memuat uji-diri + `MIN_EXPECTED_FILES`. Bukti: dua probe sungguhan membuat suite merah, lalu hijau setelah dihapus. 314 uji. |
| 2026-11-13 | **PR #17 di-merge (`76af76f`) — T-39 selesai, CI hijau 4 job pada percobaan pertama.** Seluruh uji baru berjalan di PGlite/DOM tiruan, jadi hitungan uji jaringan tidak bergeser. Yang masih terbuka dan **disengaja**: `T-45` — penjaga i18n memakai daftar berkas per nama, dan perbaikan sebenarnya (memindai direktori `components/`) belum dikerjakan. |
| 2026-11-13 | **T-39 selesai**: panel detail `<dialog>` dengan komentar dan checklist. Perilaku lama "klik kartu -> fokus ke `<select>` status" **diganti** — itu jebakan yang membuat klik untuk melihat langsung siap mengubah data (**T-44**). Dua penjaga i18n yang memakai daftar berkas per nama diperluas, dan **T-45** mencatat bahwa daftar manual itu akan bolong lagi. Uji DOM tiruan menemukan `el.dataset` bisa undefined (**T-46**). Bukti: panel dijalankan di DOM tiruan — terbuka, memuat detail, menampilkan kedua formulir, dan mengembalikan fokus ke kartu asal. 307 uji (dari 281). |
| 2026-11-13 | **PR #15 di-merge (`24d321c`) — B-C selesai, CI hijau 4 job pada percobaan PERTAMA.** Berbeda dari PR #11 dan #13 yang butuh beberapa run, tidak ada satu pun kegagalan gerbang di sini. Penyebabnya bukan keberuntungan: gerbang jumlah-dilewati sudah memakai rentang sejak PR #13, dan uji baru (15 modul + 15 integrasi + 19 HTTP + 7 transisi) semuanya berjalan di PGlite sehingga tidak mengubah hitungan uji jaringan. |
| 2026-11-13 | **B-C selesai.** 8 rute baru (komentar GET/POST, PATCH/DELETE, checklist GET/POST/PATCH/DELETE), matriks peran penuh, revisi komentar, soft delete placeholder, posisi checklist ternormalisasi. **Empat temuan perilaku** (`T-40`…`T-43`) — dan yang paling penting: **peran `commenter` tidak bisa berkomentar** sejak awal, serta **tiga dari empat validasi transisi status tidak ada** padahal kontraknya menulisnya eksplisit. Uji ditulis lebih dulu dan gagal, baru kode diperbaiki. Diverifikasi pada dev-server hidup: komentar 201, checklist 201, transisi ke Selesai → `completed_at` terisi dan event `seq=1` tercatat. Uji: 281 lulus, 29 dilewati; 40 uji jaringan. |
| 2026-11-13 | **PR #13 di-merge (`5ae68f6`) — B-B selesai, CI hijau 4 job.** Satu run merah di tengah jalan, dan penyebabnya bukan perilaku: gerbang `--expect-skipped 17` menolak **29** uji dilewati karena uji jaringan baru ditambahkan. **Angka tetap adalah gerbang yang akan merah setiap kali ada uji baru** — dan merah karena administrasi melatih orang mengabaikan merah. Gerbang kini menerima **rentang 17–100** yang menangkap dua kegagalan nyata (uji jaringan berjalan tanpa DB; uji berhenti didaftarkan), diuji pada empat keadaan. Angka tetap 17 dipertahankan sebagai jalur yang masih didukung. |
| 2026-11-13 | **B-B (login/sesi) selesai.** `sessions` kini benar-benar ditulis: token 256-bit hanya dikirim ke klien, yang tersimpan SHA-256-nya (diuji dengan mencari token mentah di seluruh kolom teks). Endpoint `POST /v1/auth/login`, `/logout`, `/logout-all`, `GET /v1/me`, `POST /v1/auth/touch`. Halaman login dengan `<form>` + `autocomplete`. `dev-server` tidak lagi menyuntikkan cookie `demo` — demo login seperti pengguna. **Tujuh temuan** (`T-31`…`T-37`), dan yang paling penting bukan salah satunya: **empat dari tujuh hanya muncul saat server benar-benar dijalankan atau saat uji diperketat**, bukan saat kode dibaca. `T-34` = `npm run dev` tidak bisa start sementara 225 uji hijau. Uji: 225 lulus, 29 dilewati; 40 uji jaringan; bundel 4,7 KB gzip. |
| 2026-11-12 | Dokumen dibuat. `P0` siap dikerjakan. B1–B3 tercatat sebagai bloker yang **tidak** menghalangi `P0`–`P4`. |
| 2026-11-12 | **VERIFIKASI NYATA.** PGlite (PostgreSQL 18.6 WASM) dipakai untuk menjalankan `write.ts` dan `migrate()` yang ASLI: **61 uji lulus, 0 dilewati**. `P0-07` akhirnya **selesai & teruji**. Tiga bug nyata ditemukan & diperbaiki: T-07 (`SHOW` → `current_setting`), T-08 (`pgcrypto` tidak dibutuhkan), T-09 (migrasi 0021 vs runner). `P1-07`…`P1-09`, `P1-12`, `P1-14` naik dari "kode" menjadi "terbukti pada Postgres". |
| 2026-11-12 | **P1 SELESAI** (kecuali konkurensi simultan). `P1-11` (`POST /tasks`, 6 uji) dan `P1-15` (handler HTTP, 19 uji end-to-end) selesai. `P1-13` sebagian: lewat HTTP penulis kedua dapat 409. **93 uji lulus, 0 dilewati.** Dua bug nyata ditemukan uji: T-10 (nomor melompat 1→441) dan T-13 (`team_keys` tertinggal → 500). T-11 dicatat: HTTP tanpa Fastify, wajib ditinjau sebelum P4. T-12 tetap terbuka: konkurensi simultan belum bisa diuji. |
| 2026-11-12 | **P2 SELESAI.** `P2-01` (board, 4 query), `P2-02` (cursor, INV-11), `P2-03` (detail + riwayat), `P2-04` (50 rb task) selesai. **Dua masalah performa nyata ditemukan dan diperbaiki:** T-15 (window function memindai 49 rb baris) dan T-14 (arah index salah → `Incremental Sort`). p95 board di PGlite: **900 ms → 15 ms**. Payload 7×50 = 111,6 KB. **144 uji lulus, 0 dilewati.** |
| 2026-11-12 | **P3 SELESAI (kecuali soket nyata). P4 SELESAI (kecuali DnD native).** 189 uji lulus. P3: klasifikasi K1/K2/K3 ditegakkan di titik keluar, celah seq → `resync_required`, batas 5 tim, pencabutan teruji lintas hub+HTTP. P4: board berjalan di port 3000, klien API idempoten, rollback optimistis, konflik tidak menimpa, bundel **3,8 KB gzip**. **Tiga bug nyata ditemukan:** T-19 (`npm install` mati total karena nama paket ganda), T-20 (Idempotency-Key non-UUID → 500), dan T-16/T-17/T-18 sebagai batas yang dinyatakan terbuka. |
| 2026-11-12 | **T-12/T-16/T-17 DITUTUP dengan PostgreSQL 18.6 SUNGGUHAN.** Sandbox ternyata bisa menjalankan server Postgres asli (`embedded-postgres` via pip; `npm run pg:up`). **202 uji: 189 lulus + 13 dilewati dengan alasan tercetak** (uji jaringan), 11 di antaranya lulus saat Postgres dinyalakan. Dua bug nyata hanya muncul ketika dua koneksi benar-benar ada: **T-22** (nomor task ganda) dan **T-21** (kriteria TODO bertentangan dengan kontrak — kontrak menang). T-24 mencatat jebakan `LD_LIBRARY_PATH` yang membuat skrip hanya bekerja di mesin penulisnya. |
| 2026-11-12 | **TC-15 TERUKUR: 91 ms** (SLA 5 000 ms). `RevocationWatcher` memantau `team_members.revoked_at` dan memanggil `revokeTeam()`; 3 uji jaringan lulus termasuk anti-false-positive saat restart. **28 uji jaringan lulus.** "Ringkasan status" ditambahkan di atas dokumen sebagai jawaban satu layar (selesai / sebagian / belum), dan aturan §0.6 mewajibkan ringkasan itu diperbarui setiap merge. |
| 2026-11-12 | **P1 sebagian**: `P1-01`, `P1-04`…`P1-09`, `P1-12` selesai; `P1-14` jejaknya terbukti. **9 skenario jalur tulis dibuktikan pada PostgreSQL nyata** lewat konektor (versi §10). `P1-15` (handler HTTP) ditambahkan sebagai tugas baru. Temuan T-04 & T-05 dicatat. Jalur tulis: idempotensi REPLAY, versi +1 tepat, no-op tidak menaikkan, 409 versi, 404 lintas tenant, NOTIFY 38 byte, payload 53 byte tanpa deskripsi, kategori event 1→3, `from_value` tersimpan. |
| 2026-11-12 | `P0-01`…`P0-05`, `P0-08`, `P0-09` **selesai**. `P0-07` runner selesai di kode, uji integrasi tertunda (T-01). `npm run verify` hijau: typecheck + lint + 2 uji negatif batas modul + 24 uji unit. 3 temuan dicatat (T-01…T-03). |

---
| 2026-11-13 | **PR #9 di-merge ke `main` (`3a88d1f`)** — 64 berkas, +6470/−219. Ringkasan status di atas diperbarui sesuai §0 aturan 6. Yang masuk `main`: seluruh P0–P4, `docs/testing-realpg.md`, `npm run pg:up`, `RevocationWatcher` (TC-15 terukur 91 ms). **Yang TIDAK masuk:** importer (B1), DnD native (T-18), uji dua jendela browser, `T-PERF1` di Supabase. |

---
| 2026-11-13 | **CI DITAMBAHKAN (`T-25`)**: `.github/workflows/verify.yml` — job `unit` (typecheck + lint + batas + 189 uji + bundel), job matriks **Postgres 16/17** (28 uji jaringan), job `guard` (migrasi destruktif, kredensial, artefak build). Dua bug di gerbang saya sendiri ditemukan dan diperbaiki (**T-26**), satu positif palsu penjaga kredensial diperbaiki (**T-27**). Sisa bloker gate R0 dicatat terbuka: **login (B-B)**, **komentar/checklist/transisi (B-C)**, **drill restore (B-D)**. |

---
| 2026-11-13 | **CI run pertama GAGAL — dan itu berguna.** Tiga job merah karena `tsc -b` tidak menghasilkan `dist/` (`T-28`: `tsbuildinfo` dianggap bukti build; keluar 0 tanpa `.js`). Ini **T-05 kambuh** sebagai *sukses palsu*, bukan galat palsu. Diperbaiki dengan `scripts/build.mjs` (`--force` + verifikasi berkas hasil). Job `unit` dan `database` **diverifikasi ulang lewat simulasi CI dari nol** (`npm ci` tanpa `node_modules`): 189 lulus, 28 uji jaringan lulus, gerbang `assert-not-skipped` lolos. |

---
| 2026-11-13 | **CI run kedua: build & 189 uji LULUS, yang gagal dua gerbang saya sendiri.** `T-29`: gerbang memberi positif palsu karena mencocokkan seluruh log, bukan baris ringkasan; di CI hanya berkas yang cocok dijalankan (5 uji) sehingga pemeriksaan `skipped` ikut salah. Diganti dua skrip terpisah yang hanya membaca baris `^ *Tests`, diuji pada tiga log nyata. **Pelajaran:** gerbang yang salah lebih berbahaya daripada tidak punya gerbang — ia mengajarkan orang mengabaikan merah. |

---
| 2026-11-13 | **CI run ketiga: gerbang masih merah, akar masalahnya `T-30`.** Log `\| tee` kosong di runner (vitest menulis ke TTY), sehingga gerbang melaporkan "tidak ada baris ringkasan" padahal 28 uji lulus. Ditemukan lewat **annotation check-run**, karena log mentah tidak dapat diunduh dari sandbox. Gerbang dipindah ke **JSON reporter** (`scripts/test-gate.mjs`), diuji pada empat keadaan + log nyata. |

---
| 2026-11-13 | **PR #11 di-merge (`f85a834`) — CI HIJAU, 4 job:** unit, postgres 16, postgres 17, penjaga repo. Butuh **tiga run** untuk sampai ke sana, dan setiap kegagalan membuka bug nyata: `T-28` (tsc sukses palsu), `T-29` (gerbang positif palsu), `T-30` (log pipe tidak andal). Ketiganya hanya bisa ditemukan dengan **menjalankan CI sungguhan**, bukan mengandalkan pemeriksaan lokal. Ringkasan status diperbarui sesuai §0 aturan 6. |

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

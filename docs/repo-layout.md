# Tata Letak Repo & Lingkungan Pengembangan (Dokumen A)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat. Dokumen yang **paling dibutuhkan sebelum baris kode pertama**.

**Kenapa dokumen ini ada lebih dulu.** Tanpa ini, developer pertama akan membuat struktur sendiri, dan struktur itu akan diikuti selama bertahun-tahun bukan karena benar, tetapi karena sudah ada. Keputusan di sini murah diubah sekarang dan mahal diubah setelah 50 berkas.

**Batas dokumen:** ini menetapkan **bentuk dan kontrak**. Berkas konfigurasi (`package.json`, `tsconfig.json`, `eslint.config.js`, `docker-compose.yml`) **dibuat pada commit pertama** mengikuti dokumen ini — bukan sekarang, sesuai instruksi "belum menulis kode".

---

## 1. Keputusan dasar

| # | Keputusan | Alasan | Yang ditolak |
| :--- | :--- | :--- | :--- |
| L1 | **Monorepo dengan npm workspaces** (satu `package.json` akar) | Tooling sudah ada di npm; tidak menambah dependensi build system (`architecture.md` §7.6 — komponen/tool baru butuh alasan) | Nx, Turborepo, Lerna, pnpm workspaces (bisa ditinjau bila waktu CI > 10 menit) |
| L2 | **Dua aplikasi, satu paket bersama**: `apps/web` (Next.js) + `apps/server` (Fastify) | ADR-010: area kerja adalah aplikasi klien, WS hub & job runner terpisah agar bisa diskalakan sendiri | Satu proses monolit (menyulitkan `NFR-016` vs `NFR-002`), microservices |
| L3 | **`packages/db` adalah satu-satunya tempat SQL** | `INV-12` (setiap query menyertakan `workspace_id`) harus punya tempat tinggal yang bisa ditegakkan lint | SQL tersebar di route handler |
| L4 | **`apps/web` tidak pernah menyentuh DB** | Satu jalur otorisasi (`ADR-003`). Bila web bisa query DB, akan ada dua jalur izin dan satu di antaranya pasti lupa | BFF yang query langsung |
| L5 | **Tidak ada generator/abstraksi yang menyembunyikan HTTP** | Kontrak API adalah artefak (`api-contract.md` §9); tRPC/GraphQL codegen menyembunyikan bentuk yang justru ingin diuji | tRPC, codegen RPC |
| L5b | **HTTP memakai router bawaan Node pada fase P1** (menyimpang dari §2 yang menyebut Fastify) | Fase ini membuktikan kebenaran jalur tulis, bukan memilih framework; tiap dependensi menambah permukaan yang harus dipercaya sebelum ada satu pengguna | **Wajib ditinjau sebelum P4** — saat CORS, rate limit, dan multipart media benar-benar dibutuhkan. Logika ada di `routes.ts`, jadi penggantian tidak menyentuh rute. Lihat T-11 di `todo.md` |
| L6 | **Semua tipe & validator kontrak lahir dari `packages/shared`** | Satu sumber tipe untuk web & server (ADR-010); mencegah kontrak ganda | Tipe ditulis ulang di dua tempat |

---

## 2. Struktur direktori (bentuk final R0)

```
/
├── apps/
│   ├── web/                      # Next.js App Router
│   │   ├── app/                  # rute, layout, halaman auth
│   │   ├── features/             # per-domain UI: board, list, task-detail, inbox
│   │   ├── components/           # primitif UI tanpa pengetahuan domain
│   │   ├── lib/                  # klien API, WS, cache, format
│   │   └── locales/              # katalog string UI (dari packages/shared)
│   └── server/                   # Fastify
│       ├── http/                 # route handler (tipis: authz → validasi → use-case)
│       ├── realtime/             # WS hub, langganan per tim, fan-out delta
│       ├── jobs/                 # runner in-process (ADR-008), satu berkas per kind
│       ├── usecases/             # logika aplikasi (satu use-case per aksi katalog)
│       ├── authz/                # implementasi satu-satunya `can()`
│       └── email/  media/  import/
├── packages/
│   ├── shared/                   # types, skema validasi, enum `code`, action ID, locales
│   ├── db/                       # koneksi, repository, query, migrasi
│   │   └── migrations/           # 0001_..., 0002_... (migrations.md §2)
│   └── testing/                  # fixture builder, helper integrasi, generator data sintetis
├── docs/                         # dokumen ini dan seluruh cetak biru
├── scripts/                      # CLI operator: setup, doctor, migrate, seed:catalog
└── (berkas konfigurasi akar: package.json, tsconfig.base.json, eslint.config.js, docker-compose.yml)
```

**Aturan penamaan direktori:**

1. `features/` = domain yang dilihat pengguna (`board`, `list`, `task-detail`, `inbox`, `settings`). Bukan `components/board` — komponen domain bukan komponen primitif.
2. `usecases/` satu berkas per aksi katalog `rbac.md` (`task.update.ts`, `comment.create.ts`). **Nama berkas = nama action** agar bisa dicari dari `rbac.md`.
3. `jobs/` satu berkas per `kind` pada `data-model.md` ENT-20. Menambah job = menambah berkas, bukan menambah `switch`.
4. `test/` hidup **di samping** kode yang diuji (`task.update.test.ts`), bukan di pohon terpisah. Uji integrasi ditandai akhiran `.int.test.ts`, e2e `.e2e.test.ts`.

---

## 3. Batas modul (ditegakkan, bukan diharapkan)

### 3.1 Matriks impor

| Dari ↓ / Boleh impor → | `shared` | `db` | `server` | `web` |
| :--- | :---: | :---: | :---: | :---: |
| **`packages/shared`** | — | ❌ | ❌ | ❌ |
| **`packages/db`** | ✅ | — | ❌ | ❌ |
| **`apps/server`** | ✅ | ✅ | — | ❌ |
| **`apps/web`** | ✅ | ❌ | ❌ | — |

**Alasan per larangan:**

- `shared` tidak boleh mengimpor apa pun dari aplikasi: ia harus bisa dipakai oleh keduanya tanpa siklus.
- `db` tidak boleh mengimpor `server`: repository tidak perlu tahu HTTP. Kalau butuh, itu tanda logika salah tempat.
- `web` tidak boleh mengimpor `server` atau `db`: **satu jalur otorisasi** (L4). Semua akses data lewat HTTP/WS, dengan cookie sesi — sama seperti klien mana pun (`api-contract.md` §3). Ini juga yang membuat API publik gratis (`FR-209`): UI memakai API yang sama.

### 3.2 Penegakan

| Aturan | Penegakan |
| :--- | :--- |
| Matriks §3.1 | Aturan boundary di ESLint (satu konfigurasi, dievaluasi di CI) |
| SQL hanya di `packages/db` | Pemeriksaan statis: tidak ada string SQL di luar `packages/db` (`T-SEC9`) |
| Setiap query wajib `workspace_id` | Tipe pada repository: parameter `scope: { workspaceId }` **wajib**, tidak ada overload (`INV-12`, `T-A1`) |
| Action ID hanya dari katalog | `packages/shared/authz/actions.ts` di-generate dari `rbac.md`; ID di luar katalog = build gagal (`T-A3`) |
| Enum `code` hanya dari katalog | Sama, dari `api-contract.md` §5.3 (`T-API3`) |
| Tidak ada string UI di komponen | `T-I18N1` |

**Catatan penting:** daftar action dan daftar `code` **di-generate dari dokumen** (atau diperiksa terhadapnya di CI), bukan ditulis ulang manual. Dokumen adalah sumber kebenaran; kode yang menyimpang gagal di build. Ini yang mencegah "izin liar" (`rbac.md` R5) dan `code` tak terdaftar.

---

## 4. Kontrak perintah (yang harus ada sebelum commit pertama)

Perintah ini **bagian dari produk**, bukan kemudahan developer. Nama & perilakunya ditetapkan; implementasinya pada commit pertama.

| Perintah | Perilaku | Untuk siapa |
| :--- | :--- | :--- |
| `npm run dev` | Menjalankan `web` + `server` + storage lokal + Postgres | Developer |
| `npm run build` | Build produksi `web` + `server` | CI & rilis |
| `npm run typecheck` | `tsc --noEmit` seluruh workspace | CI |
| `npm run lint` | ESLint termasuk aturan boundary §3.2 | CI |
| `npm test` | Uji unit + kontrak API + integrasi (butuh Postgres) | CI |
| `npm run test:int` | Uji integrasi terhadap Postgres nyata (bukan tiruan) | CI |
| `npm run test:e2e` | Playwright terhadap build produksi (`testing-strategy.md` §7) | CI |
| `npm run migrate` | Menjalankan migrasi (`migrations.md` §8) | Operator |
| `npm run migrate:dry-run` | Rencana + estimasi + objek terkunci | Operator |
| `npm run seed:catalog` | Memasang katalog default (status, label, template) untuk workspace/tim baru | Operator |
| `npm run doctor` | Pemeriksaan konfigurasi (`support.md` §5) | Operator |
| `npm run bundle:check` | Memeriksa `UX-B1`/`UX-B2` | CI |

**Aturan:** setiap perintah yang dijalankan **dua kali** oleh manusia harus menjadi perintah npm. Tidak ada "jalankan ini dulu, terus itu" di kepala orang.

---

## 5. Konfigurasi & rahasia

### 5.1 Prinsip

1. **Fail fast di boot**: konfigurasi wajib yang hilang = proses berhenti dengan pesan yang menyebut variabel & cara memperbaikinya. Bukan `undefined` yang meledak 3 jam kemudian.
2. **Tidak ada default untuk rahasia.** Nilai default hanya untuk hal yang aman (`PORT=3000`). Alasan: default rahasia adalah cara paling umum aplikasi self-host dibobol.
3. **Satu sumber konfigurasi** (env), divalidasi dengan skema yang sama untuk web & server (`packages/shared/config`).
4. **Rahasia tidak pernah masuk repositori, log, atau bundle klien.** Variabel yang boleh sampai ke browser **wajib** berawalan publik dan didaftar eksplisit.

### 5.2 Daftar variabel (kontrak)

| Variabel | Wajib? | Default | Catatan |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | ✅ | — | **Tanpa** pooler untuk migrasi; dengan pooler untuk aplikasi (ADR-020) |
| `SESSION_SECRET` | ✅ | — | ≥ 32 byte acak; tanpa default |
| `APP_URL` | ✅ | — | Dipakai untuk tautan undangan & email |
| `STORAGE_DRIVER` | ✅ | `filesystem` | `filesystem` (lokal/Minimal) \| `s3` |
| `STORAGE_S3_*` | bila `s3` | — | Endpoint, bucket, kredensial; **bukan** MinIO (ADR-009) |
| `EMAIL_MODE` | ✅ | `none` | `none` \| `smtp` \| `relay` (`email.md` §2.1) |
| `EMAIL_SMTP_*` | bila `smtp`/`relay` | — | Host, port, user, pass, `From` |
| `ATTACHMENT_MAX_BYTES` | — | `104857600` | Batas §7.4 |
| `LOG_LEVEL` | — | `info` | |
| `NODE_ENV` | ✅ | — | `development` \| `production` \| `test` |
| `FEATURE_*` | — | mati | Flag sementara; **wajib** punya tanggal kedaluwarsa di komentar |

**Aturan flag fitur:** flag harus dihapus dalam **≤ 2 rilis**. Flag yang menetap adalah utang yang tidak terlihat — dan `teams.feat_*` (toggle per tim) **bukan** feature flag: itu fitur produk (ADR-007).

---

## 6. Lingkungan lokal

| Kebutuhan | Keputusan |
| :--- | :--- |
| **Postgres** | 16 dan 17 keduanya bisa dijalankan (`docker compose`); default lokal **17**. Uji wajib hijau di keduanya (ADR-018) |
| **Object storage** | `filesystem` lokal (tanpa MinIO, ADR-009). Uji S3 memakai emulator S3-compatible |
| **Email** | `EMAIL_MODE=none` secara default; uji memakai SMTP palsu in-process (`email.md` §8) |
| **Data awal** | Tidak ada seed data contoh (`migrations.md` §6). `npm run seed:catalog` hanya memasang katalog default |
| **Data sintetis untuk performa** | Dibuat lewat perintah `packages/testing` dengan **benih tetap** (`testing-strategy.md` §3), bukan file besar di repo |
| **Zona waktu** | Paksa UTC di server; uji lokal tidak boleh bergantung pada zona mesin |
| **Port** | `web` 3000, `server` 3001 — ditetapkan agar dokumentasi dan uji e2e tidak menebak |

**Aturan yang mengikat:** `.env.example` memuat **semua** variabel dengan nilai aman untuk lokal dan **tanpa** rahasia asli. Berkas `.env` tidak pernah di-commit.

---

## 7. Definisi "selesai" untuk satu PR

Sebuah PR dianggap selesai hanya bila **semua** terpenuhi. Ini yang membuat dokumen desain punya gigi.

| # | Syarat | Rujukan |
| :--- | :--- | :--- |
| 1 | Menyebut ID: `FR-*`, `INV-*`, `AC-*`, `ADR-*` yang dilayani | `README.md` konvensi ID |
| 2 | Uji baru untuk perilaku baru (`T-*` sesuai lapisan) | `testing-strategy.md` §1 |
| 3 | `typecheck` + `lint` + `bundle:check` hijau | §4 |
| 4 | Bila menyentuh skema: migrasi dengan header lengkap + `data-model.md` diperbarui | `migrations.md` §3, M7 |
| 5 | Bila menyentuh API: OpenAPI diperbarui; breaking change berlabel `breaking-api` | `api-contract.md` §9 |
| 6 | Bila menyentuh otorisasi: tinjauan **security reviewer** + `T-A1` untuk route baru | `rbac.md` §6.3, `decisions-r0.md` D-02 |
| 7 | Bila menambah string UI: kunci ada di katalog, tidak ada string di komponen | `i18n.md` §2 |
| 8 | Tidak melewati anggaran performa | `ux-principles.md` §4 |
| 9 | Satu approval dari reviewer yang bukan penulis | §8 |

**Yang tidak disyaratkan:** cakupan uji persentase (`testing-strategy.md` §1) dan dokumentasi terpisah di luar `docs/` (dokumen desain adalah dokumentasi).

---

## 8. Alur kerja Git (ditetapkan, bukan kebiasaan)

| Aspek | Keputusan | Alasan |
| :--- | :--- | :--- |
| Model | **Trunk-based**: `main` selalu bisa dirilis; branch berumur **≤ 3 hari** | Branch panjang = merge besar = risiko regresi tersembunyi |
| Nama branch | `feat/<id>-slug`, `fix/<id>-slug`, `docs/<slug>` | Bisa dilacak ke requirement |
| Commit | Conventional Commits + **trailer `Signed-off-by`** (DCO) | ADR-014: tanpa CLA, DCO menjadi bukti lisensi |
| Merge | Squash untuk fitur; merge commit hanya untuk rilis | Riwayat `main` terbaca sebagai daftar perubahan, bukan daftar "wip" |
| Review | 1 approval; **wajib 2** bila menyentuh `authz/`, migrasi, atau `security-policy.md` | Tiga area yang salahnya paling mahal |
| `main` dilindungi | Wajib CI hijau, tanpa force push | — |
| Rebase | Boleh pada branch sendiri; **tidak** pada `main` | — |

**Aturan yang mengikat:** **tidak ada commit langsung ke `main`**, termasuk "perbaikan kecil". Justru perbaikan kecil yang paling sering melewati uji (`testing-strategy.md` §8).

---

## 9. Yang sengaja tidak dilakukan

| Tidak dilakukan | Alasan |
| :--- | :--- |
| Build system tambahan (Nx/Turborepo) | 2 aplikasi + 3 paket tidak membutuhkannya; tambah hanya bila CI > 10 menit |
| Storybook / katalog komponen terpisah | Menambah beban pemeliharaan; komponen diuji lewat e2e & sesi uji pengguna |
| Docker untuk pengembangan aplikasi | Server lokal lebih cepat & debugging lebih baik; Docker dipakai untuk Postgres/storage dan untuk rilis |
| Codegen RPC (tRPC/GraphQL) | Menyembunyikan bentuk HTTP yang justru diuji kontrak (`api-contract.md` §9) |
| Pre-commit hook yang memblokir | Menghambat; pemeriksaan berat dilakukan di CI. Hook hanya untuk hal cepat (format, rahasia) |
| Satu paket per domain (`packages/tasks`, `packages/teams`) | Terlalu banyak batas untuk produk berukuran ini; `apps/server/usecases` cukup |

---

## 10. Rujukan silang

- Stack & alasan bahasa: `architecture.md` ADR-010
- Satu jalur otorisasi: `architecture.md` ADR-003, `rbac.md` §1
- Pooler & koneksi: `architecture.md` ADR-020
- Migrasi: `migrations.md`
- Kontrak API sebagai sumber: `api-contract.md` §9
- Uji per lapisan: `testing-strategy.md`
- Katalog string: `i18n.md`
- DCO & lisensi: `architecture.md` ADR-014

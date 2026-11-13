# Kontrak API (C2)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat implementasi. Menutup celah **C2** di `gaps-analysis.md`.
**Rujukan wajib:** `architecture.md` ADR-003 (otorisasi), ADR-015 (idempotensi/versi/konflik), ADR-019 (pencarian), ADR-020 (pooling — larangan `SET` sesi), `data-model.md` (field & invariant), `rbac.md` (action ID).

Dokumen ini menetapkan **bentuk** API. Bila implementasi membutuhkan bentuk yang tidak ada di sini, ubah dokumen ini lebih dulu — jangan menambah konvensi baru diam-diam.

---

## 1. Prinsip

| # | Prinsip | Konsekuensi konkret |
| :--- | :--- | :--- |
| A1 | **Satu bentuk, tanpa pengecualian.** Setiap endpoint memakai model error, paginasi, dan patch yang sama. | Tidak ada endpoint yang mengembalikan `{error: "..."}` gaya sendiri. Diuji oleh uji kontrak (§9). |
| A2 | **Klien tidak boleh menebak.** Setiap kegagalan punya `code` stabil yang bisa dipetakan ke perilaku UI, bukan hanya pesan manusia. | `code` adalah enum tertutup (§5.3). Menambah kode = perubahan dokumen ini. |
| A3 | **Server adalah sumber kebenaran; klien optimistis.** Respons mutasi **selalu** mengembalikan entitas kanonik + `version`. | Klien merekonsiliasi, bukan berasumsi. ADR-015. |
| A4 | **Jangan bocorkan keberadaan.** Objek di luar tenant/izin **tidak terlihat** → 404, bukan 403. | Aturan tegas di §5.5. Diuji TC-14. |
| A5 | **Paginasi cursor, bukan offset.** | `OFFSET` dilarang pada tabel besar (`INV-11`, ADR-019). |
| A6 | **Semua mutasi idempoten lewat kunci idempoten.** | Header `Idempotency-Key` wajib untuk semua non-GET (§6). |
| A7 | **API publik adalah warga kelas satu.** Yang dipakai UI adalah API yang sama dengan yang dipakai integrasi. | Tidak ada endpoint "internal" yang lebih kaya. Ini yang membuat `FR-209` murah. |
| A8 | **Tidak ada state sesi di server.** | Dilarang `SET` sesi, advisory lock berbasis sesi, temp table (ADR-020). Semua konteks di dalam request/transaksi. |

---

## 2. Bentuk dasar

### 2.1 Base path & versi

```
/api/v1
```

- Versi di **path** (`v1`), bukan header. Alasan: mudah di-log, mudah di-route, mudah di-cache, tidak bisa "lupa".
- Perubahan yang **tidak** merusak (tambah field opsional, tambah kode error baru yang tidak mengubah alur) tidak menaikkan versi. Alasan aturan ini: kalau setiap penambahan field menaikkan versi, kita akan punya `v7` dalam setahun.
- Perubahan merusak → `v2` paralel, `v1` dipertahankan minimal **6 bulan** setelah pengumuman (§11).
- **Tidak ada** versi per-endpoint. `v2` adalah kontrak utuh.

### 2.2 Format

- Body: JSON (UTF-8). `Content-Type: application/json`.
- Timestamp: **RFC 3339 UTC** dengan `Z`, presisi milidetik (`2026-11-12T09:00:00.000Z`). Tanggal kalender (due date): `YYYY-MM-DD`, **tanpa** zona (keputusan S5 `data-model.md`).
- ID: string UUIDv7 berformat kanonik. Tidak pernah integer.
- Field: `snake_case`. Alasan: `data-model.md` memakai bentuk itu; menghindari dua ejaan untuk konsep yang sama.
- `null` dan "tidak ada" berbeda (§7.2). Field opsional yang tidak diminta **tidak dikirim**, bukan dikirim `null`.

### 2.3 Bentuk respons

**Objek tunggal** — tanpa envelope:

```
{ "id": "...", "title": "...", "version": 12, ... }
```

**Koleksi** — selalu berbentuk halaman:

```
{
  "data": [ ... ],
  "page": { "next_cursor": "eyJ2Ijox...", "has_more": true, "limit": 50 }
}
```

`page` selalu ada pada koleksi, walau hasil kosong (`data: []`, `has_more: false`). Alasan: klien yang harus menebak bentuk halaman kosong adalah sumber bug.

**Tidak ada envelope `{"data": {...}}` untuk objek tunggal.** Alasan: membuat setiap pembacaan field jadi dua baris kode, tanpa manfaat.

---

## 3. Autentikasi

| Klien | Mekanisme | Catatan |
| :--- | :--- | :--- |
| Browser (UI) | **Cookie sesi** `HttpOnly; Secure; SameSite=Lax` | Token tidak pernah disimpan di `localStorage` (XSS → pencurian sesi). CSRF dilindungi `SameSite` + header `X-CSRF-Token` untuk mutasi. |
| API/integrasi | `Authorization: Bearer <token>` | Token dibuat lewat `AC-11`, membawa `scopes` ⊆ hak pembuatnya (T4). |
| WebSocket | Cookie sesi **atau** query `?token=` **dilarang** | Token di URL masuk log. WS memakai cookie sesi atau sub-protokol berisi token sekali pakai. |

**Sesi:** dibatasi umur, bisa dicabut; pencabutan berlaku < 60 s (`FR-112`, `ENT-18`). Semua respons menyertakan `X-Session-Expires-At` agar klien bisa memperbarui lebih awal.

---

## 4. Resource & path

**Aturan penamaan path:**

1. **Koleksi selalu bersarang pada pemiliknya** — karena scope tenant/tim wajib eksplisit di setiap query (`INV-12`):
   - `/v1/workspaces/{workspace_id}/teams`
   - `/v1/teams/{team_id}/tasks`
   - `/v1/tasks/{task_id}/comments`
2. **Objek tunggal tidak bersarang** — `/v1/tasks/{task_id}`. Alasan: task ID unik global (UUIDv7) dan tidak dapat ditebak; klien tidak perlu mengingat jalur lengkap. Scope tenant tetap diperiksa dari objeknya (A4).
3. **Tidak ada kata kerja di path** kecuali aksi yang memang bukan CRUD (mis. `/tasks/{id}/transitions`, `/imports`).
4. `snake_case` tidak dipakai di path; segmen path memakai `kebab-case` dan bentuk jamak.

**Katalog endpoint R0** (setiap baris dipetakan ke action ID di `rbac.md`):

| Method | Path | Action | Catatan |
| :--- | :--- | :--- | :--- |
| GET | `/v1/me` | — | Profil + daftar workspace yang boleh dilihat |
| GET | `/v1/workspaces/{id}` | AC-01 | |
| PATCH | `/v1/workspaces/{id}` | AC-02 | |
| GET | `/v1/workspaces/{id}/members` | AC-01 | cursor paginasi |
| POST | `/v1/workspaces/{id}/members` | AC-04 | undang |
| PATCH | `/v1/workspaces/{id}/members/{user_id}` | AC-06 | ubah peran |
| DELETE | `/v1/workspaces/{id}/members/{user_id}` | AC-05 | cabut (bukan hapus baris) |
| GET | `/v1/workspaces/{id}/teams` | AC-01 | |
| POST | `/v1/workspaces/{id}/teams` | AC-07 | |
| GET | `/v1/teams/{id}` | AC-20 | termasuk `features` (toggle) |
| PATCH | `/v1/teams/{id}` | AC-21 | |
| GET | `/v1/teams/{id}/members` | AC-20 | |
| POST | `/v1/teams/{id}/members` | AC-23 | |
| PATCH | `/v1/teams/{id}/members/{user_id}` | AC-23 | |
| GET | `/v1/teams/{id}/statuses` | AC-20 | |
| POST | `/v1/teams/{id}/statuses` | AC-24 | |
| PATCH | `/v1/statuses/{id}` | AC-24 | urutan/`is_default`/`archived_at` |
| GET | `/v1/teams/{id}/labels` · POST · PATCH | AC-25 | |
| GET | `/v1/teams/{id}/tasks` | AC-27 | filter + cursor (§8) |
| POST | `/v1/teams/{id}/tasks` | AC-28 | **wajib** `Idempotency-Key` |
| GET | `/v1/tasks/{id}` | AC-27 | |
| PATCH | `/v1/tasks/{id}` | AC-29 / AC-30 / AC-31 | patch field-level (§7) |
| DELETE | `/v1/tasks/{id}` | AC-32 | soft delete |
| POST | `/v1/tasks/{id}/restore` | AC-33 | |
| GET | `/v1/tasks/{id}/events` | AC-27 | riwayat; cursor |
| GET | `/v1/tasks/{id}/comments` · POST | AC-27 / AC-35 | |
| PATCH | `/v1/comments/{id}` | AC-36 / AC-37 | |
| DELETE | `/v1/comments/{id}` | AC-38 | placeholder dipertahankan |
| GET | `/v1/tasks/{id}/checklist` · POST · PATCH · DELETE | AC-41 | item |
| POST | `/v1/tasks/{id}/attachments` | AC-39 | dua langkah (§10.2) |
| DELETE | `/v1/attachments/{id}` | AC-40 | |
| GET | `/v1/search` | AC-27 | `?q=` + scope wajib (§8.3) |
| GET | `/v1/sync?since_seq=` | AC-50 | delta untuk klien (§10.3) |
| POST | `/v1/exports` · GET `/v1/exports/{id}` | AC-10 | job + status |
| GET | `/v1/audit` | AC-09 | R2 |
| GET | `/health` | — | tanpa auth, tanpa data sensitif (`FR-115` versi) |

Endpoint **tidak** tersedia untuk aksi yang tidak ada di `rbac.md` (A5/`rbac.md` R5). Tidak ada `POST /tasks/{id}/move_team` (AC-34 tidak ada).

---

## 5. Error

### 5.1 Format: `application/problem+json` (RFC 9457)

```
{
  "type": "https://kelindan.dev/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "code": "validation.failed",
  "trace_id": "01JCH3...",
  "errors": [
    { "field": "title", "code": "too_long", "detail": "Maksimum 300 karakter." }
  ],
  "retryable": false
}
```

Aturan:

- `code` adalah **enum tertutup** (§5.3) — klien memetakan perilaku dari `code`, bukan dari `title`/`detail`.
- `trace_id` **wajib** ada di semua respons (sukses juga, di header `X-Trace-Id`). UI menampilkannya pada error agar pengguna bisa melaporkan satu ID (prinsip §3.5 PRD).
- `detail` berbahasa manusia, **tidak** memuat data sensitif (tidak ada email, isi komentar, token).
- `retryable` memberi tahu klien apakah aman mencoba ulang otomatis. `false` berarti UI **harus** menampilkan tombol "coba lagi" eksplisit, bukan mengulang diam-diam.
- `errors[]` hanya untuk kegagalan validasi (422), maksimum 20 item — bukan tempat menumpahkan seluruh log.

### 5.2 Tabel status

| Status | Kapan |
| :--- | :--- |
| 200 / 201 | Sukses / dibuat |
| 204 | Sukses tanpa body (DELETE) |
| 400 | Request tidak dapat diparse (JSON rusak) — **bukan** untuk validasi field |
| 401 | Tidak terautentikasi / sesi kedaluwarsa |
| 403 | Terautentikasi, objek **terlihat**, tetapi aksi tidak diizinkan |
| 404 | Objek tidak ada **atau** tidak terlihat oleh pemanggil (A4) |
| 409 | Konflik versi, atau `Idempotency-Key` dipakai dengan body berbeda, atau pelanggaran invariant (mis. siklus dependency) |
| 410 | Presigned URL lampiran kedaluwarsa |
| 413 | Body/payload melebihi batas (§7.4 PRD) |
| 422 | Validasi field gagal |
| 429 | Rate limit; sertakan `Retry-After` |
| 500 | Kesalahan server; `retryable: true` untuk operasi idempoten |
| 503 | Pool DB penuh / mode pemeliharaan (ADR-020) |

### 5.3 Enum `code` (tertutup)

| `code` | Status | Arti / yang dilakukan klien |
| :--- | :--- | :--- |
| `auth.unauthenticated` | 401 | Arahkan ke login |
| `auth.session_revoked` | 401 | Sesi dicabut; hapus cache lokal, login ulang |
| `auth.token_invalid` | 401 | Token API salah/dicabut |
| `auth.forbidden` | 403 | Tampilkan "tidak punya akses"; **jangan** sembunyikan tombol untuk kasus ini (AC §3.2 aturan UI) |
| `resource.not_found` | 404 | Perlakukan sebagai tidak ada; jangan coba menebak ID lain |
| `validation.failed` | 422 | Tampilkan `errors[]` per field |
| `validation.unknown_field` | 422 | Klien mengirim field yang tidak dikenal (mencegah salah tulis diam-diam) |
| `conflict.version` | 409 | Rekonsiliasi: ambil state terbaru, tampilkan konflik bila field sama (ADR-015) |
| `conflict.idempotency_key_reuse` | 409 | Kunci sama, body beda → bug klien, **jangan** retry otomatis |
| `conflict.cycle_dependency` | 409 | Dependency membentuk siklus |
| `conflict.state` | 409 | Aksi tidak valid pada state objek (mis. restore task yang belum dihapus) |
| `rate_limited` | 429 | Tunggu `Retry-After` |
| `payload.too_large` | 413 | Tolak di klien sebelum kirim |
| `attachment.url_expired` | 410 | Minta URL baru |
| `feature.disabled` | 409 | Aksi menyentuh fitur yang dimatikan tim (ADR-007) — data tetap ada, tapi aksi ditolak |
| `server.busy` | 503 | Pool penuh; tampilkan "coba lagi", jangan kehilangan input |
| `server.error` | 500 | Tampilkan trace ID |

**Menambah `code` baru** = perubahan dokumen ini + versi minor. Tidak boleh ada kode yang dikirim ke klien tanpa terdaftar.

### 5.4 Pemetaan ke UI (mengikat frontend)

| Situasi | Perilaku UI yang wajib |
| :--- | :--- |
| `403` | Tombol dinonaktifkan **dengan alasan terlihat** (tooltip), bukan disembunyikan — kecuali objek memang tidak boleh terlihat (A4 → 404). |
| `409 conflict.version` | Jangan timpa. Untuk field yang sama: tampilkan nilai server vs nilai pengguna, minta pilih. |
| `409 conflict.idempotency_key_reuse` | Bug klien. Tampilkan trace ID, **jangan** retry. |
| `429` / `503` | Antre di klien dengan backoff, pertahankan input pengguna. |
| Semua error | Selalu tampilkan `trace_id` yang dapat disalin. |

### 5.5 Aturan 404 vs 403 (anti-enumerasi)

Ini aturan paling mudah dilanggar, jadi ditulis tegas:

1. **404** bila pemanggil **tidak berhak mengetahui keberadaan** objek: beda tenant, beda tim yang bukan keanggotaannya, objek terhapus, atau guest di luar grant.
2. **403** bila objek **terlihat** (pemanggil punya `AC-27 task.view` pada objek itu) tetapi aksinya tidak diizinkan.
3. Untuk endpoint koleksi di path bersarang (`/v1/teams/{id}/tasks`) ketika team `{id}` tidak terlihat → **404**, bukan `403` dan bukan `[]`. Daftar kosong membocorkan bahwa tim itu ada.

Diuji otomatis untuk **setiap** endpoint (TC-14).

---

## 6. Idempotensi

- Header **`Idempotency-Key: <ULID>`** wajib untuk semua `POST`/`PATCH`/`DELETE`. Tidak ada → `400` dengan `code: validation.failed` (`field: Idempotency-Key`).
- Server menyimpan `(actor_id, key)` + hash body + respons selama **24 jam** (`ENT-19`).
- Key sama + body **sama** → respons asli dikembalikan (termasuk status & body), dengan header `Idempotent-Replay: true`. Klien **tidak** boleh membedakan perilaku.
- Key sama + body **berbeda** → `409 conflict.idempotency_key_reuse`.
- Key berbeda, body sama → diproses normal (ini bukan duplikasi; dua aksi sah bisa identik).
- **Alasan wajib, bukan opsional:** retry jaringan memutus respons, dan optimistic UI mengulang mutasi. Tanpa kunci, task ganda akan lahir dari jaringan buruk — bukan dari kesalahan pengguna.

---

## 7. Mutasi: patch field-level

### 7.1 Bentuk `PATCH`

Body berisi **hanya field yang berubah**. Field yang tidak muncul = tidak diubah.

```
PATCH /v1/tasks/{id}
{
  "title": "Perbaikan SSO",
  "assignee_id": "0193...",
  "due_date": null,
  "expected_version": 12
}
```

Aturan:

| Aturan | Alasan |
| :--- | :--- |
| Field tidak dikenal → `422 validation.unknown_field` (bukan diabaikan) | Salah tulis field (`assigne_id`) tidak boleh "berhasil" diam-diam. Ini penyebab bug yang paling sulit dilacak. |
| `null` **menghapus** nilai (untuk field nullable). Untuk membuat field wajib `null` → `422`. | Semantik eksplisit; tidak bergantung pada JSON Merge Patch yang membuat `null` ambigu. |
| Patch kosong (`{}`) → `422 validation.failed` | Mencegah request tanpa makna. |
| Field yang tidak boleh dipatch (mis. `workspace_id`, `team_id`, `number`, `created_at`) → `422 validation.unknown_field` | Mengganti tim lewat patch adalah celah otorisasi (FR-113, AC-34). |
| Mutasi tanpa perubahan bersih → `200` dengan entitas apa adanya, **tanpa** menaikkan `version` dan **tanpa** menulis `task_events` | `INV-04`. Kalau setiap patch menaikkan versi, retry akan memicu konflik palsu. |

### 7.2 `null` vs "tidak ada"

| Kasus | Body | Arti |
| :--- | :--- | :--- |
| Tidak diubah | field tidak dikirim | Biarkan nilai saat ini |
| Dihapus | `"due_date": null` | Set NULL |
| Pindah ke "tanpa assignee" | `"assignee_id": null` | Set NULL |

Tidak ada sintaks ketiga (tidak ada `"$unset"`). Satu bentuk, satu arti.

### 7.3 Konflik & versi

- `expected_version` **opsional** di body. Bila ada dan ≠ `version` server → `409 conflict.version` dengan field tambahan `current` berisi entitas kanonik terbaru.
- Bila tidak ada → **last-write-wins per field**, tetapi server **wajib** menulis `task_events` dengan nilai `from` (ADR-015 butir 3), sehingga kehilangan nilai selalu terlihat dan bisa dipulihkan.
- Alasan `expected_version` opsional, bukan wajib: memaksanya membuat setiap perubahan field tunggal butuh round-trip baca. Biaya itu tidak sebanding untuk mutasi berfield satu. **Klien UI disarankan selalu mengirimnya**; klien integrasi boleh tidak.
- Untuk **deskripsi/komentar** (teks panjang), `expected_version` **wajib** — LWW saja dapat menghapus paragraf yang ditulis orang lain (ADR-015 butir 4).

### 7.4 Transisi status

Status diubah lewat `PATCH` biasa (`"status_id": "..."`), **bukan** endpoint khusus. Alasan: satu jalur mutasi, satu tempat untuk otorisasi, event, dan validasi.

`POST /v1/tasks/{id}/transitions` hanya untuk aksi yang **bukan** sekadar ganti status:
- `restore` (AC-33) — karena mengubah `deleted_at` + status sekaligus.
- Aksi otomatis R1 (merge PR → Done) lewat endpoint sistem, dengan `actor` = sistem dan `source = system` pada event.

Validasi yang wajib walau hanya `status_id`:
- `status_id` harus milik **tim yang sama** dengan task (`INV-08`).
- Status harus aktif (tidak `archived_at`).
- Bila `completed_at` belum ada dan status masuk kategori `Selesai` → isi `completed_at` (first-touch, `INV-07`).
- Bila status fitur `cycles`/`effort` dimatikan, field terkait tetap boleh diubah lewat API (ADR-007 butir 4). UI yang menyembunyikan.

---

## 8. Pembacaan

### 8.1 Paginasi cursor

- Parameter: `limit` (default **50**, maks **200**) dan `cursor` (opaque, base64 dari `(sort_key, id)`).
- Respons: `page.next_cursor` (`null` bila habis) + `page.has_more`.
- **Tidak ada** `offset`, `page_number`, atau `total`. Alasan: `total` mahal pada dataset besar dan **menyesatkan** — jumlah berubah di antara dua halaman. Klien yang butuh angka total memakai endpoint hitung terpisah (`/v1/teams/{id}/tasks/count`) yang hasilnya **dinyatakan perkiraan**.
- Cursor tidak boleh diparse klien (opaque). Mengubah bentuk cursor tidak dianggap breaking change.

### 8.2 Filter & urutan

Format: query param datar, nama field tanpa prefix:

```
GET /v1/teams/{id}/tasks?status_id=...&assignee_id=...&label_id=...&updated_since=...&limit=50
```

| Param | Arti |
| :--- | :--- |
| `status_id` (ulang boleh) | Filter status; OR di antara nilai |
| `assignee_id` | `me` didukung untuk "tugas saya" |
| `label_id` (ulang boleh) | AND (harus punya semua label) — **dinyatakan** agar tidak ambigu |
| `category` | 1–4 |
| `updated_since` | Delta ringan untuk sinkronisasi klien |
| `include_deleted` | Hanya `ADM`/`owner` + untuk tim; tanpa ini, task terhapus tidak terlihat |
| `order` | Allowlist: `updated_at`, `created_at`, `due_date`, `number`; arah `-` untuk menurun |

- Filter yang tidak dikenal → `422 validation.unknown_field`. Konsisten dengan patch.
- Kombinasi bebas (OR antar grup) adalah fitur R1 (`Smart Filter`), dengan bentuk **JSON tervalidasi server**, bukan string query yang dievaluasi bebas. **JQL sengaja tidak ada** (NG-01/§9 glosarium).

### 8.3 Pencarian

```
GET /v1/search?q=login%20sso&team_id=...
```

- **`team_id` atau `workspace_id` wajib.** Pencarian lintas tenant tidak disediakan (ADR-019, A4).
- Maks 50 hasil, tanpa paginasi dalam (paginasi pencarian dianggap anti-fitur).
- Respons menyertakan `took_ms` untuk transparansi, bukan untuk keputusan klien.
- Hasil menyertakan `matched_fields` (judul/deskripsi/komentar) agar UI bisa menjelaskan kenapa cocok.

### 8.4 Field yang dikembalikan

Dua bentuk yang disepakati, tidak lebih:

| Bentuk | Dipakai | Isi |
| :--- | :--- | :--- |
| **Ringkas** (`?fields=summary`) | Board & List | `id, number, title, status_id, category, priority, assignee_id, due_date, effort, version, updated_at, labels[] , checklist_progress` |
| **Penuh** (default pada objek tunggal) | Detail task | semua field, termasuk `description` |

Alasan pemisahan: board dengan 200 task × deskripsi penuh = payload yang membunuh `NFR-004`. Pemilihan bentuk **eksplisit**, bukan otomatis, agar tidak ada endpoint yang "kadang berat".

Field yang bergantung pada toggle fitur **tetap dikembalikan** walau togglenya mati (ADR-007 butir 4), agar data tidak terlihat hilang. UI yang menyembunyikan.

---

## 9. Kontrak sebagai sumber kebenaran

1. **OpenAPI 3.1** adalah artefak kontrak, di-generate dari satu definisi skema yang juga menghasilkan tipe TypeScript (ADR-010). Tidak ada dua sumber.
2. **Uji kontrak wajib di CI** (§7 `testing-strategy.md`):
   - Setiap route di kode **harus** ada di OpenAPI, dan sebaliknya. Route tanpa entri = pipeline gagal.
   - Setiap respons diuji terhadap skema (validasi runtime pada uji, bukan hanya tipe compile-time).
   - Setiap route wajib punya minimal satu contoh respons sukses dan satu error, dipakai sebagai fixture uji.
3. **Breaking change dideteksi otomatis** dengan membandingkan OpenAPI rilis sebelumnya dengan yang baru (`oasdiff` atau setara). Penghapusan field/parameter, perubahan tipe, dan penambahan field wajib = breaking. Pipeline gagal kecuali disertai label `breaking-api` dan catatan migrasi.
4. **Contoh di dokumen ini bersifat ilustratif**; yang mengikat adalah OpenAPI + tabel `code` di §5.3.

---

## 10. Real-time & lampiran

### 10.1 Protokol WebSocket

```
→ { "op": "subscribe", "team_ids": ["..."], "since_seq": 123456 }
← { "op": "subscribed", "team_ids": [...], "seq": 123490, "resync_required": false }
← { "op": "delta", "seq": 123491, "entity": "task", "id": "...", "version": 13, "patch": {...} }
← { "op": "resync_required" }
```

Aturan:

- **Selalu ada `seq`** pada setiap delta. Klien menyimpan `seq` terakhir (ADR-006).
- Delta boleh **duplikat** (at-least-once). Klien idempoten: terapkan hanya bila `version` > versi lokal (ADR-015 butir 5).
- `resync_required` → klien **wajib** memuat ulang lewat REST; tidak boleh menebak (ADR-006 butir 3).
- Langganan **diotorisasi** (`AC-50`) saat subscribe **dan** pada setiap fan-out (T3). Pencabutan akses → koneksi diputus < 5 s (TC-15).
- `ping`/`pong` tiap 25 s; idle 60 s → tutup. Backoff dengan jitter saat reconnect (ADR-006).
- **Payload delta ≤ 4 KB**; perubahan deskripsi mengirim `{ "op": "field_changed", "field": "description", "hash": "..." }`, bukan isi (ADR-017).

### 10.2 Lampiran: dua langkah (presigned)

```
POST /v1/tasks/{id}/attachments   → { "attachment_id": "...", "upload_url": "...", "expires_at": "..." }
PUT  <upload_url>                 (langsung ke object storage; server tidak memproksi byte)
POST /v1/attachments/{id}/complete → 200 { attachment ... }
```

- `upload_url` berumur **10 menit**, terikat objek & ukuran maksimum.
- `complete` wajib: server memverifikasi objek benar-benar ada + ukuran/`content_type` sesuai klaim, lalu mengisi `checksum_sha256`.
- Lampiran yang tidak pernah `complete` dalam 24 jam → dibersihkan job (tidak dihitung kuota).
- Unduh: presigned URL berumur 5 menit, `Content-Disposition: attachment` untuk tipe berbahaya (ADR-009). `storage_key` **tidak pernah** muncul di respons (`INV-09`).

### 10.3 Delta untuk klien (bukan WebSocket)

`GET /v1/sync?workspace_id=...&since_seq=...` mengembalikan baris `changes` berurutan. Dipakai saat reconnect tanpa WebSocket atau saat klien perlu mengejar ketinggalan. Bila `since_seq` lebih tua dari retensi (24 jam) → `410` dengan `code: conflict.state` dan instruksi `resync` (bukan error yang tak bisa ditangani).

---

## 11. Rate limit, webhook, deprecation

### 11.1 Rate limit

Mengikuti `NFR-014`. Respons menyertakan:

```
RateLimit-Limit: 600
RateLimit-Remaining: 421
RateLimit-Reset: 42
Retry-After: 12      (hanya pada 429)
```

Dimensi penghitungan: per token untuk API, per sesi untuk UI, per IP untuk login. Endpoint pencarian dan ekspor punya kuota lebih ketat (dinyatakan di OpenAPI per route, bukan dihafal).

### 11.2 Webhook (R1)

- `POST` JSON + `X-Kelindan-Signature: sha256=...` (HMAC-SHA256 atas body + timestamp) + `X-Kelindan-Timestamp` untuk mencegah replay.
- Retry: 8 percobaan, backoff eksponensial hingga ~24 jam; setelah itu ditandai gagal dan terlihat di UI.
- **Proteksi SSRF**: https saja, tolak IP privat/link-local setelah resolusi DNS, tanpa redirect (T6).
- Pengiriman **at-least-once** → penerima wajib idempoten; dokumentasi wajib menyatakan ini.

### 11.3 Deprecation

- Penghapusan endpoint/field: diumumkan **≥ 6 bulan** sebelumnya, header `Deprecation` + `Sunset`, plus peringatan di catatan rilis.
- Selama masa itu, versi lama tetap berfungsi penuh (bukan "dikurangi perlahan").

---

## 12. Yang secara sengaja tidak ada di API

| Tidak ada | Alasan |
| :--- | :--- |
| GraphQL | Satu bahasa query yang perlu di-cache, di-rate-limit, dan diotorisasi lebih rumit; REST + bentuk ringkas/penuh mencukupi (ADR-010). |
| Endpoint `move_team` | FR-113 melarang; menyediakannya di API = menyediakan jalan pintas yang tidak ada di UI. |
| `offset` / `page` / `total` | Menyesatkan & mahal (A5). |
| String query bebas (JQL) | NG-01; permukaan serangan dan sumber ketidakkonsistenan. |
| Webhook tanpa tanda tangan | Tidak bisa dibedakan dari pemalsuan. |
| Token di query string | Masuk log & riwayat browser. |
| `POST /tasks/bulk` | Belum diputuskan; menambah bentuk baru (semi-transaksi) yang harus diotorisasi dan di-audit per item. Ditunda sampai ada kebutuhan terukur. |
| Field `password`, `password_hash`, `storage_key` | Tidak pernah keluar dari server (`INV-09`). |

---

## 13. Rujukan silang

| Konsep | Dokumen |
| :--- | :--- |
| Urutan middleware (authz → idempotensi → versi → patch → event → changes) | `architecture.md` ADR-015 |
| Batas payload NOTIFY & delta | `architecture.md` ADR-017 |
| Aksi & matriks izin | `rbac.md` §2–§3 |
| 404 vs 403 | `rbac.md` TC-14 |
| Field, tipe, `version` | `data-model.md` |
| Uji yang wajib ada untuk setiap aturan di sini | `testing-strategy.md` §5–§7 |

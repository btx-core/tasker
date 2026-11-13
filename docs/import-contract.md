# Kontrak Importer: Jira → Kelindan

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Dokumen ini **menggantikan** "wizard satu klik" v0.
**Mengikat:** implementasi importer mengikuti kontrak ini; perubahan pemetaan = versi baru dokumen ini.

**Mengapa dokumen ini ada lebih dulu daripada kode.** Importer menentukan bentuk kolom `tasks.title`, `tasks.description`, `comments.body`, dan `attachments` — tiga kolom yang paling mahal diubah setelah ada data. Menulis migration sebelum kontrak ini selesai berarti menulis ulang. Karena itu importer menjadi urutan kerja #1 di `prd.md` §11.

**Janji yang dibuat (dan yang tidak).**

> Importer ini akan **gagal dengan jujur**. Ia tidak menjanjikan bahwa semua data Jira Anda akan berpindah utuh — tidak ada importer yang bisa. Ia menjanjikan bahwa setiap item yang tidak berpindah utuh akan **tercatat, terlihat, dan dapat diunduh laporannya**.

---

## 1. Realitas teknis yang membatasi (dasar kontrak)

| # | Fakta | Konsekuensi pada kontrak |
| :--- | :--- | :--- |
| R1 | Jira Cloud: `/rest/api/3/search` sudah dihapus, diganti `POST /rest/api/3/search/jql` dengan paginasi `nextPageToken` dan **tanpa total count**. | Importer tidak boleh menampilkan "0% dari 12.345 issue". Progres harus berbasis **jumlah yang sudah diproses**, dan total tidak dijanjikan. Endpoint lama tidak dipakai sama sekali. |
| R2 | Jira Server/Data Center memakai API berbeda (v2, `/search` dengan `startAt`). | Dua adapter terpisah, diuji terpisah. Adapter Server diuji dengan fixture, bukan diasumsikan. |
| R3 | Deskripsi & komentar Jira v3 memakai **ADF** (Atlassian Document Format), bukan Markdown. | Konversi ADF→Markdown bersifat **lossy**. Wajib taksonomi kegagalan (§4) dan penyimpanan ADF mentah. |
| R4 | Jira punya objek yang tidak punya padanan: `panel`, `macro`, `smart link`, `sprint burndown`, `issue link type` kustom, `workflow validator`, `field configuration`. | Dipetakan, didegradasi dengan deklarasi, atau dinyatakan tidak diimpor — **tidak pernah** diam-diam dibuang. |
| R5 | Attachment Jira memerlukan autentikasi; URL-nya bisa kedaluwarsa. | Unduhan lewat adapter dengan retry; kegagalan per file dicatat, impor tidak dihentikan karenanya. |
| R6 | Jumlah issue bisa 10⁵–10⁶ dan rate limit Jira nyata. | Impor harus bisa dijeda, dilanjutkan, dan dijalankan ulang (idempoten). |

---

## 2. Sumber masukan

| Jalur | Prioritas | Alasan |
| :--- | :--- | :--- |
| **A. File ekspor (JSON dari Jira Cloud backup / CSV hasil ekspor)** | **Utama** | Tidak bergantung pada perubahan API Atlassian; tidak perlu menyimpan kredensial pelanggan; bisa diuji dengan fixture. |
| **B. API langsung (token)** | Sekunder | Untuk data yang tidak ada di ekspor (komentar/lampiran terpisah) dan untuk impor inkremental. |

**Keputusan:** rilis pertama importer **hanya mendukung jalur A**. Jalur B menyusul setelah jalur A stabil. Ini membalik prioritas v0 (yang mengasumsikan API + API key) dan mengurangi risiko secara signifikan: tidak ada token pelanggan di server kami, tidak ada ketergantungan pada endpoint yang sedang berubah.

---

## 3. Pemetaan objek

| Jira | Kelindan | Sifat | Catatan |
| :--- | :--- | :--- | :--- |
| Project | **Team** | 1:1 | `key` project → `teams.key` (dipotong ke 6 huruf, bentrok diselesaikan dengan sufiks angka dan dicatat). |
| Issue | **Task** | 1:1 | Nomor issue dipertahankan bila `team_key` sama; bila tidak, nomor baru diberikan dan **pemetaan lama→baru dicatat** di laporan. |
| Issue Type | **Kategori** | N:1 | `Bug` → Bug, `Story`/`Task` → Tugas, `Service Request` → Permintaan, `Incident` → Insiden. Tipe lain → **Tugas + label** berisi nama tipe aslinya (data tidak hilang). |
| Status | **Status** (di dalam 5 kategori) | N:1 | Status Jira dibuat sebagai status kustom per tim; kategori ditentukan dari `statusCategory` Jira (`To Do`→Siap, `In Progress`→Dikerjakan, `Done`→Selesai). Status tanpa padanan kategori → Dikerjakan + peringatan. |
| Epic | **Goal** | 1:1 | Goal dimiliki workspace (ADR-002). |
| Sprint | **Cycle** | 1:1 | Hanya bila toggle `cycles` dinyalakan. Sprint tertutup → Cycle tertutup. |
| Sub-task | **Checklist item** di task induk | 1:1 | **Bukan** task. Isi: `[KEY] judul — status asal: X`. Karena checklist tanpa status (NG-05), status sub-task dicatat di teks dan di laporan. |
| Comment | **Comment** | 1:1 | Penulis dipetakan lewat email; bila tidak ada → penulis "impor (tak dikenal)" + catatan. |
| Attachment | **Attachment** | 1:1 | Kegagalan per file dicatat (R5). |
| Label | **Label** | 1:1 | |
| Component | **Label** berawalan `comp:` | 1:1 | v0 ingin "Sub-Team/Modul"; kita pakai label agar tidak menambah konsep (koreksi terhadap v0 yang memperkenalkan lalu membuangnya). |
| Fix Version / Release | **Label** berawalan `ver:` (+ tanggal rilis sebagai catatan) | 1:1 | Fitur Releases baru ada di R2. |
| Assignee / Reporter | **assignee_id / created_by** | — | Reporter menjadi `created_by`. Assignee ganda (Jira bisa >1 lewat field kustom) → hanya yang pertama, sisanya dicatat di laporan. |
| Due date / Priority / Story points | `due_date` / `priority` / `effort` | — | Story points masuk `effort` **hanya bila** toggle `effort` menyala dan skalanya cocok; bila tidak, disimpan sebagai catatan di deskripsi? **Tidak** — disimpan di `task_custom_values` bila ada, atau di laporan. Lihat §5 L2. |
| Issue link (`blocks`, `is blocked by`) | **Dependency** | 1:1 | Hanya dua arah ini. Link lain → dicatat sebagai catatan task (teks) dan dilaporkan. |
| Work log | **Tidak diimpor** | — | Time tracking baru ada R2 dan berbeda model. Dicatat sebagai lampiran CSV opsional. |
| Custom field (teks/angka/pilihan/tanggal) | `task_custom_values` bila cocok, selain itu: **tidak diimpor + dilaporkan per field, dengan jumlah nilai yang hilang** | — | Lihat L2. |
| ADF mentah (deskripsi & komentar) | Kolom `source_raw` (jsonb) pada task/komentar | — | **Wajib.** Tanpa ini, konversi lossy tidak bisa diperbaiki di masa depan. |

**Aturan umum:** setiap objek Jira yang tidak terpetakan **tetap menghasilkan baris di laporan** dengan jumlahnya. Ringkasan "berhasil" tanpa angka objek yang dilewati adalah pelanggaran kontrak ini.

---

## 4. Taksonomi kegagalan (L1–L5)

Ini inti kontrak. Setiap item yang diimpor harus berada di salah satu tingkat ini, dan tingkat L2–L5 **wajib** muncul di laporan akhir.

| Level | Nama | Arti | Contoh | Tampilan ke pengguna |
| :--- | :--- | :--- | :--- | :--- |
| **L1** | Utuh | Semua atribut berpindah, termasuk format. | Task dengan judul, deskripsi Markdown sederhana, status, assignee. | — (tidak muncul) |
| **L2** | Degradasi format | Data berpindah, formatnya disederhanakan. **Tidak ada teks yang hilang.** | Panel ADF → blockquote; tabel ADF dengan merged cell → tabel biasa; `mention` → nama teks. | Daftar item, bisa difilter; pratinjau sebelum/sesudah untuk 20 contoh pertama. |
| **L3** | Degradasi struktur | Objek berpindah tapi sebagai jenis yang berbeda. | Sub-task → checklist; Epic → Goal (bukan Epic); Component → label. | Daftar item + penjelasan satu baris why. |
| **L4** | Tidak diimpor | Objek tidak berpindah, tercatat lengkap. | Work log, custom field tak dikenal, macro `{jira-chart}`, Issue link tipe kustom. | Daftar + **jumlah nilai yang hilang** + ekspor CSV berisi data mentahnya. |
| **L5** | Gagal | Kesalahan proses (jaringan, file rusak, data tidak valid). | Lampiran 404, JSON rusak, tanggal mustahil. | Daftar + tombol **"coba lagi item ini saja"** (impor inkremental). |

**Aturan laporan.**
1. Laporan dibuat selalu, termasuk saat impor 100% L1.
2. Format: halaman ringkasan + CSV per level, dapat diunduh dari job.
3. Ringkasan wajib memuat: jumlah per level, 10 contoh terburuk (yang kehilangan data paling banyak), dan daftar field yang paling banyak hilang.
4. **Tidak boleh ada** kalimat "impor selesai" tanpa menyebut jumlah L2–L5.
5. Impor tidak dianggap gagal bila ada L2/L3/L4 — ia dianggap gagal bila ada L5 yang tidak bisa diulang, atau bila laporan tidak dapat dibuat.

---

## 5. Keputusan pemetaan yang sulit (diputuskan, bukan diserahkan ke operator)

| # | Masalah | Keputusan | Alasan |
| :--- | :--- | :--- | :--- |
| **IC-1** | User Jira tidak punya akun Kelindan. | Buat akun "placeholder" (nonaktif, tanpa kredensial) dengan nama & email asal; admin dapat mengklaim/menautkan setelah impor. Bila email kosong, buat user "tak dikenal" per workspace (satu baris, bukan per issue). | Kehilangan pelaku merusak riwayat dan metrik. |
| **IC-2** | Riwayat transisi status Jira (changelog) — apakah diimpor? | **Ya, bila tersedia** (jalur A sering menyertakan `changelog` terbatas). Dipetakan ke `task_events` dengan `actor_id` hasil pemetaan pengguna IC-1 dan `source = 'import'`. Bila tidak tersedia: **tidak** dibuat-buat; `started_at`/`completed_at` diambil dari timestamp status saat ini bila ada, dan metrik menandai task ini `reconstructed = true`. | Metrik yang mengklaim presisi dari data rekonstruksi adalah kebohongan. Penandaan ini yang membedakan importer ini dari yang lain. |
| **IC-3** | Task Jira bisa punya banyak assignee lewat field kustom. | Assignee utama saja; sisanya → L4 dengan ekspor CSV. | M1 di `data-model.md` (satu assignee). |
| **IC-4** | Status Jira tidak cocok dengan 5 kategori. | Petakan dari `statusCategory` Jira. Bila tidak ada, default `Dikerjakan` + peringatan. | Jangan menebak `Selesai` — salah tebak membuat metrik basi. |
| **IC-5** | `team_key` bentrok / lebih dari 6 karakter. | Potong, lalu sufiks `2`, `3`, …; catat pemetaan. | Nomor task harus unik per tim. |
| **IC-6** | Nomor issue (ENG-123) dipertahankan? | Ya bila memungkinkan: `team_keys.next_number` diatur melewati nomor tertinggi yang diimpor. Bila bentrok (dua project memakai key sama), nomor baru + pemetaan dicatat. | Pengguna mengingat nomor issue; mempertahankannya mengurangi gesekan migrasi. |
| **IC-7** | Lampiran besar atau terlalu banyak. | Batas keras: 100 MB/file (sesuai §7.4). File di atas batas → L4 dengan tautan sumber **bila** URL masih sah, selain itu L5. | Konsisten dengan batas produk. |
| **IC-8** | Impor dijalankan dua kali. | Idempoten per `(source_system, source_id)`: kunci `jira_issue_key` + `source_instance_id`. Item yang sudah diimpor dilewati, tidak digandakan. | Wajib, agar "coba lagi yang gagal" mungkin. |
| **IC-9** | Data lokal sudah diubah setelah impor pertama, lalu impor diulang. | Impor **tidak menimpa** entitas yang `version > 1` atau `updated_at > last_import_at`. Perubahan itu dilaporkan sebagai konflik, bukan diterapkan. | Impor yang menimpa pekerjaan pengguna adalah cara tercepat kehilangan kepercayaan. |
| **IC-10** | Workspace tujuan sudah punya data. | Impor menolak berjalan ke workspace yang sudah punya task, kecuali operator mengaktifkan mode "gabung" secara eksplisit dengan konfirmasi ketik nama workspace. | Mencegah kecelakaan yang tidak bisa dibatalkan. |

---

## 6. Kolom yang harus ada di skema karena kontrak ini

Ini bagian yang membuat spike importer wajib mendahului migration final. Semua kolom di bawah masuk daftar perubahan `data-model.md` **sebelum** migration pertama ditulis.

| Tabel | Kolom | Tipe | Alasan |
| :--- | :--- | :--- | :--- |
| `tasks` | `source_system` | smallint/null | 1 = Jira; null = dibuat di Kelindan. |
| `tasks` | `source_instance_id` | text/null | Identitas instance Jira (hostname/ID ekspor) agar dua instance tidak bentrok. |
| `tasks` | `source_id` | text/null | Kunci issue asal (`ENG-123`). |
| `tasks` | `source_raw` | jsonb/null | ADF/JSON mentah deskripsi (R3, untuk perbaikan konversi di masa depan). |
| `tasks` | `reconstructed` | boolean, default false | IC-2 — menandai riwayat yang direkonstruksi, bukan nyata. |
| `tasks` | `imported_at` | timestamptz/null | Dasar aturan IC-9. |
| — | UNIQUE `(workspace_id, source_system, source_instance_id, source_id)` parsial | | Idempotensi IC-8. |
| `comments` | `source_raw`, `source_id`, `imported_at` | sama | Konversi ADF lossy juga berlaku untuk komentar. |
| `attachments` | `source_url`, `import_status` | text/smallint | R5, IC-7. |
| `task_events` | `source` | smallint (1=user, 2=system, 3=import) | IC-2 — laporan dan metrik bisa menyaring event rekonstruksi. |
| `users` | `external_identity` | text/null | IC-1 — pemetaan email Jira → akun nyata. |
| `imports` (tabel baru) | `id`, `workspace_id`, `source_instance_id`, `started_at`, `finished_at`, `level_counts` (jsonb), `report_uri`, `status` | | Laporan adalah **artefak produk**, bukan log. |

---

## 7. Kriteria penerimaan spike (2–3 minggu, urutan kerja #1)

Spike **bukan** prototype importer penuh. Deliverable-nya adalah bukti yang membuat migration bisa ditulis tanpa menebak.

| # | Deliverable | Ukuran lulus |
| :--- | :--- | :--- |
| S1 | Fixture data Jira nyata, minimal 3 sumber berbeda | 1 ekspor Cloud kecil, 1 ekspor dengan ADF kompleks, 1 ekspor Server/DC |
| S2 | Konverter ADF → Markdown + laporan lossy per node | ≥ 95% node ADF umum (paragraf, heading, list, code, panel, table, mention, link) tertangani; setiap node tak tertangani masuk laporan, bukan dibuang |
| S3 | Bukti bahwa kolom §6 cukup | Impor 1.000 issue dari fixture ke skema percobaan (boleh tabel sementara), tanpa perlu kolom tambahan |
| S4 | Angka kegagalan nyata | Laporan L1–L5 dihasilkan dari data nyata; persentase L2–L5 diukur, bukan diperkirakan |
| S5 | Keputusan revisi skema | Daftar kolom §6 dikonfirmasi atau diubah, dan `data-model.md` diperbarui **sebelum** migration pertama |
| S6 | Bukti performa | Impor 10.000 issue selesai < 30 menit pada profil Standar; dapat dijeda dan dilanjutkan |

**Gate:** migration pertama **tidak boleh** ditulis sebelum S3 dan S5 selesai. Ini aturan keras (prd.md §11), bukan saran.

---

## 8. Yang secara eksplisit tidak akan diimpor (dan mengapa itu dapat dipertahankan)

| Jira | Alasan | Yang kita berikan sebagai gantinya |
| :--- | :--- | :--- |
| Workflow & validator kustom | NG-03 — kita tidak punya mesin workflow. | Laporan L4 + status dipetakan ke 5 kategori. |
| Field configuration & screen scheme | NG-03, kesederhanaan inti. | Custom field sederhana (R2). |
| Board/gadget dashboard | Zero-config insights menggantikannya. | Insights R2. |
| Permissions scheme Jira | Model otorisasi berbeda (ADR-003). | Laporan pemetaan + penyiapan manual berbantuan. |
| Automation rules Jira | Belum ada automation builder (NG-03). | Laporan L4 berisi JSON aturan asal, agar bisa dibangun ulang nanti. |
| Work log / timesheet | NG-06 (R2). | Ekspor CSV mentah. |
| Audit log Jira | Berbeda model & retensi. | Ekspor CSV. |

Untuk setiap baris di atas, kontrak ini **tetap mewajibkan** entri L4 beserta datanya. "Tidak diimpor" tidak sama dengan "dihapus dari laporan".

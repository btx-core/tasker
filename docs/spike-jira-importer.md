# Rancangan Spike Importer Jira (S1–S6)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Rancangan eksekusi + spesifikasi ADF→Markdown + **fixture pegangan**.
**Prasyarat migration pertama:** S3 dan S5 (`import-contract.md` §7).

**Batas yang dinyatakan lebih dulu, dan ini penting.** Spike didefinisikan oleh ukurannya terhadap **data Jira nyata**: S1 (fixture 3 sumber) dan S4 (angka L2–L5 diukur) **tidak bisa** dipenuhi tanpa berkas ekspor Jira. Saya tidak akan mengarang data Jira palsu lalu menyebutnya "validasi" — itu justru kebalikan dari tujuan dokumen importer ini.

Karena itu dokumen ini memisahkan:

| Bagian | Bisa diselesaikan tanpa data Jira | Status |
| :--- | :--- | :--- |
| **Spesifikasi konversi ADF → Markdown** (§3) | ✅ Ya | **Selesai** di sini |
| **Matriks pemetaan ADF per node** (§4) | ✅ Ya (berdasarkan spesifikasi ADF publik) | **Selesai** di sini |
| **Fixture pegangan** berisi node ADF yang dibangun dari spesifikasi (§6) | ✅ Ya | **Selesai** — tetapi **bukan** pengganti data nyata |
| **S1** — fixture dari 3 sumber Jira nyata | ❌ Butuh berkas dari Anda | **Menunggu** |
| **S2** — angka cakupan konverter pada data nyata | ❌ Butuh S1 | **Menunggu** |
| **S3** — bukti kolom cukup (impor 1.000 issue) | ⚠️ Sebagian: bisa memakai fixture pegangan; **angka akhir** butuh data nyata | **Sebagian** |
| **S4** — angka L2–L5 nyata | ❌ Butuh S1 | **Menunggu** |
| **S5** — keputusan revisi skema | ⚠️ Strukturnya sudah ditetapkan (§5); keputusan akhir butuh S3/S4 | **Sebagian** |
| **S6** — performa 10.000 issue | ❌ Butuh implementasi | **Menunggu** |

---

## 1. Tujuan spike (satu kalimat)

Menjawab satu pertanyaan sebelum migration ditulis: **apakah kolom yang sudah ditetapkan `import-contract.md` §6 cukup untuk memuat data Jira nyata — tanpa membuang data yang tidak bisa dipulihkan?**

Bila jawabannya "tidak", lebih murah menemukannya sekarang (ubah kamus data) daripada setelah ada 50 instalasi.

---

## 2. Kebutuhan masukan (yang saya perlukan dari Anda)

Untuk menjalankan S1–S4, diperlukan **berkas**, bukan akses server:

| # | Yang diminta | Minimal | Sensitivitas |
| :--- | :--- | :--- | :--- |
| 1 | Ekspor Jira Cloud (backup/JSON) — boleh **dianonimisasi** | 1 project, 200–1.000 issue | Isi boleh diganti; **struktur** ADF jangan diubah |
| 2 | Ekspor dengan ADF kompleks (panel, tabel, mention, macro, smart link) | 1 project kecil | Sama |
| 3 | Ekspor Jira Server/Data Center (format berbeda) | 1 project kecil | Sama |
| 4 | CSV ekspor (bila ada) untuk membandingkan field | 1 berkas | Sama |

**Yang **tidak** saya butuhkan:** kredensial Jira, alamat instance, nama pelanggan. Berkas mentah cukup, atau berkas yang sudah dianonimisasi asal **bentuk ADF tetap utuh** (yang diuji adalah struktur, bukan isi).

**Bila tidak ada data Jira nyata:** spike tidak bisa lulus S1/S4, dan migration pertama **tetap tidak boleh** ditulis (`import-contract.md` §7 gate). Alternatif yang jujur: turunkan gate menjadi "migration pertama boleh ditulis setelah S3 lulus dengan fixture pegangan, **dengan risiko** revisi skema saat data nyata tersedia" — dan risiko itu harus Anda setujui sadar, bukan saya putuskan.

---

## 3. Spesifikasi konversi ADF → Markdown (diputuskan)

**Prinsip konversi:** *tidak ada teks yang hilang*. Format boleh berubah (L2), struktur boleh berubah (L3), tetapi **kata-kata tidak boleh hilang**. Bila sebuah node tidak bisa dipetakan, isinya diekstrak sebagai teks + dicatat.

### 3.1 Aturan umum

1. **Teks selalu dipertahankan.** Untuk node tak dikenal: ekstrak semua `text` di subtree, jadikan paragraf, catat di laporan sebagai L2 (atau L4 bila node itu memang media/embed).
2. **Penanda asal ditambahkan bila format berubah.** Contoh panel → blockquote **plus** awalan `**Catatan:**` agar pembaca tahu ini bukan kutipan biasa.
3. **Tidak ada HTML mentah** di keluaran (`editor-decision.md` §3.1 — subset v1). Bila ADF memuat HTML di dalam teks, ia di-escape, bukan dirender.
4. **Escape karakter Markdown** pada teks pengguna (`*`, `_`, `#`, `[`, backtick) agar tidak mengubah format.
5. **Urutan anak dipertahankan** persis.
6. **Setiap konversi mencatat jejak**: `{ node: "panel", level: "L2", reason: "panel->blockquote" }` untuk laporan. Ini yang membuat laporan bisa dihasilkan tanpa menebak.

### 3.2 Aturan khusus yang mudah salah

| Hal | Aturan |
| :--- | :--- |
| **Mention** (`mention` dengan `attrs.id`) | Dipetakan ke `@nama` bila pengguna bisa dipetakan (`IC-1`); bila tidak, `@nama-tidak-dikenal` **dan** dicatat L2. Tidak boleh menjadi `@id-angka` |
| **Smart link / inline card** | `[judul](url)`; bila judul tidak ada, tampilkan URL. Dicatat L2 |
| **Emoji** (`emoji` dengan `shortName`) | Dipetakan ke karakter unicode bila nama dikenal; selain itu `:shortName:` sebagai teks. Dicatat L2 |
| **Status lozenge** | Teks status dalam backtick + catatan; dicatat L3 (status sebagai teks) |
| **Hard break** (`hardBreak`) | Dua spasi + newline (Markdown) |
| **Task list** (`taskList`/`taskItem`) | Daftar centang GFM `- [ ]`; bila dicentang, `- [x]`. Ini **bukan** checklist Kelindan (`checklist_items`) — hanya teks, dan dicatat L3 |
| **Panel dengan `panelType`** | Blockquote + label sesuai tipe (`info`→**Info:**, `warning`→**Peringatan:**, `error`→**Masalah:**, `success`→**Berhasil:**, `note`→**Catatan:**) |
| **Media (`mediaSingle`/`mediaGroup`)** | Lampiran: bila file berhasil diunduh → `![](lampiran)`; bila gagal → teks `[lampiran: nama]` + L5 |
| **Expand/collapse** | Judul sebagai heading kecil + isi; dicatat L3 |
| **Nested list > 2 level** | Dibatasi 2 level (subset v1); sisanya diratakan + dicatat L2 |
| **Tabel dengan merged cell** | Diratakan ke tabel Markdown biasa (kolom diulang) + dicatat L2 |
| **Blok kode dengan bahasa** | Fence dengan `language`; bila bahasa di luar daftar aman, tetap ditulis (hanya penanda) |
| **Node `doc` kosong** | Deskripsi `null`, bukan string kosong (beda arti di UI) |

---

## 4. Matriks pemetaan ADF (acuan implementasi & laporan)

Ini tabel yang dipakai konverter **dan** untuk menghasilkan laporan L1–L5. Setiap baris adalah satu keputusan akhir.

| Node ADF | Keluaran Markdown | Level | Catatan |
| :--- | :--- | :---: | :--- |
| `doc` | (root) | L1 | |
| `paragraph` | paragraf | L1 | |
| `text` (bold/italic/code/strike) | `**`, `_`, `` ` ``, `~~` | L1 | `underline` tidak ada di Markdown → `<u>` **dilarang** (HTML) → teks biasa + L2 |
| `text` (link) | `[teks](url)` | L1 | URL `javascript:` ditolak → L2 |
| `heading` (1–6) | `#`…`######` (dipetakan ke 3 level pertama, sisanya `######`) | L1/L2 | Level > 3 → L2 |
| `bulletList`/`orderedList` | `-` / `1.` | L1 | |
| `listItem` | item | L1 | |
| `codeBlock` | fence + bahasa | L1 | |
| `blockquote` | `>` | L1 | |
| `rule` | `---` | L1 | |
| `hardBreak` | dua spasi + newline | L1 | |
| `panel` | blockquote + label | **L2** | |
| `table`/`tableRow`/`tableCell`/`tableHeader` | tabel Markdown | L1 | Merged cell → L2 |
| `mention` | `@nama` | **L2** | Bergantung pemetaan user |
| `emoji` | unicode atau `:short:` | L2 | |
| `status` | `` `status` `` | **L3** | Status sebagai teks |
| `date` | tanggal sesuai format workspace | L2 | |
| `inlineCard`/`blockCard`/`embedCard` | `[judul](url)` | **L2** | |
| `mediaSingle`/`mediaGroup`/`media` | `![](lampiran)` atau `[lampiran: nama]` | L1/L5 | Bergantung unduhan |
| `expand`/`nestedExpand` | heading kecil + isi | **L3** | |
| `taskList`/`taskItem` | `- [ ]` / `- [x]` | **L3** | Bukan checklist Kelindan |
| `decisionList`/`decisionItem` | daftar + **Keputusan:** | L2 | |
| `layoutSection`/`layoutColumn` | isi kolom berurutan | L2 | Tata letak hilang |
| `extension` (macro: TOC, chart, info panel, jira issue) | teks placeholder `[macro: nama]` + parameter sebagai JSON di laporan | **L4** | Isi macro tidak bisa dipindahkan |
| `extension` (`jiraIssue` link) | `[KEY](url)` bila bisa dipetakan | L3 | Menjadi referensi, bukan relasi |
| `placeholder` (editor kosong) | (dihapus) | L1 | |
| `bodiedExtension` | teks isi + `[macro: nama]` | L4 | |
| Node tak dikenal | semua teks subtree + `[node: nama]` | **L2** | Default aman: tidak ada yang hilang |
| `attrs` tak dikenal pada node dikenal | diabaikan + dicatat sekali per nama attr | L2 | |

**Aturan penting di tabel ini:** hanya `extension`/`bodiedExtension` yang berlevel **L4** (data tidak dipindahkan). Semua node lain minimal mempertahankan teksnya. Itu yang memungkinkan laporan berbunyi "L4: 12 macro, 0 teks hilang" — kalimat yang bisa dipertanggungjawabkan.

---

## 5. Struktur keluaran spike (S3/S5)

Spike tidak menghasilkan importer, tetapi menghasilkan **bukti**:

| Artefak | Isi | Dipakai untuk |
| :--- | :--- | :--- |
| `fixtures/adf/*.json` | Node ADF (dari data nyata bila ada; dari §6 bila tidak) | Uji konverter |
| `fixtures/expected/*.md` | Hasil konversi yang diharapkan (di-review manusia) | Uji round-trip & regresi |
| **Laporan cakupan** | Per node: jumlah, level, contoh | S2, S4 |
| **Laporan kolom** | Daftar field Jira yang **tidak** punya tempat di skema kita | **S5** (ini inti spike) |
| **Uji pemetaan 1.000 issue** | Impor ke skema percobaan (tabel sementara) | S3 |

**Keputusan S5 yang sudah bisa ditetapkan sekarang** (tidak butuh data):

| Temuan hipotetis | Keputusan |
| :--- | :--- |
| Field Jira tanpa padanan | Masuk `source_raw` (sudah ada) **atau** `task_custom_values` (R2) **atau** laporan L4. **Tidak pernah** dibuang tanpa catatan |
| Deskripsi > 100 KB (batas §7.4) | Ditolak impor item itu dengan L5 + berkas asli di ekspor — **jangan** dipotong diam-diam |
| Komentar > 16 KB | Sama |
| Lebih dari 50 lampiran per issue | 50 pertama diimpor, sisanya L4 + CSV |
| Issue dengan > 10 label | 10 pertama, sisanya L4 + CSV |
| Dua issue dengan key sama di dua instance | `source_instance_id` membedakan (sudah ada) |
| User tanpa email | Placeholder per workspace (sudah ada, `IC-1`) |

**Yang masih butuh data:** apakah ada field Jira yang **sering** tidak punya padanan (bukan sekadar ada). Itu menentukan apakah `task_custom_values` perlu dinaikkan dari R2 ke R1 — keputusan yang mahal bila salah.

---

## 6. Fixture pegangan (bukan pengganti data nyata)

Enam berkas ADF yang **menurut saya** paling mungkin merusak konverter. Ini dibangun dari spesifikasi ADF publik, **bukan** dari ekspor Jira nyata — karena itu ia hanya membuktikan konverter tidak crash dan tidak membuang teks, bukan bahwa cakupannya cukup untuk data pelanggan.

| # | Fixture | Yang diuji |
| :--- | :--- | :--- |
| F1 | Paragraf + bold/italic/code/link | Jalur L1 dasar |
| F2 | Panel + expand bersarang di dalam list | Kedalaman & label panel |
| F3 | Tabel dengan merged cell + list di dalam cell | Perataan tabel |
| F4 | Mention + emoji + status lozenge + date | Pemetaan inline & L2/L3 |
| F5 | Macro `extension` (TOC, chart) + smart link + media | L4 & lampiran |
| F6 | Deskripsi panjang (≈ 120 KB) + 3 blok kode besar | Batas ukuran & performa konversi |

**Aturan pemakaian:** fixture ini **tidak boleh** dipakai untuk menyatakan S1 lulus. Ia hanya mencegah regresi setelah konverter dibuat dari data nyata.

---

## 6b. Status implementasi: konverter sudah ada

Konverter ADF → Markdown **sudah diimplementasikan** di `examples/jira-importer/adf-to-markdown.mjs` dan diuji pada 6 fixture (`spike-jira-importer.md` §6). Hasil lengkap: **`spike-jira-results.md`**.

Ringkas: 72 node, **0 teks hilang**, 3 L4 (macro/media) — dan **tiga bug nyata** ditemukan hanya karena kode dijalankan (mention `@@budi`, label panel yang menyuntik Markdown, pemeriksa teks-hilang yang keliru). Itu bagian spike yang bisa diselesaikan tanpa data pelanggan.

**Gate tidak berubah:** `S1`, `S3`, `S4`, `S6` tetap tertutup tanpa berkas Jira nyata (`import-contract.md` §7).

## 7. Rencana kerja (setelah data tersedia)

| Hari | Kegiatan | Keluaran |
| :--- | :--- | :--- |
| 1 | Terima & anonimisasi berkas; inventaris node ADF | Daftar node + frekuensi |
| 2–3 | Implementasi konverter sesuai §4 | `fixtures` + uji |
| 4 | Jalankan pada 1.000 issue → laporan cakupan & kolom | S2, S3, S5 |
| 5 | Ukur waktu konversi & memori; uji 10.000 issue | S6 (awal) |
| 6 | Perbarui `data-model.md` & `import-contract.md` bila perlu | S5 final |

**Gate yang tidak berubah:** migration pertama ditulis **setelah** S3 & S5 selesai (`import-contract.md` §7).

---

## 8. Uji yang wajib ada untuk konverter (`T-ADF`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| **T-ADF1** | Tidak ada teks hilang: setiap `text` di input muncul di output (paling sedikit sebagai teks) | Prinsip §3 |
| **T-ADF2** | Tidak ada HTML mentah di keluaran (termasuk dari `underline`, HTML di dalam teks) | `editor-decision.md` §3.1 |
| **T-ADF3** | Setiap node pada §4 punya uji dan level yang benar (L1/L2/L3/L4) | Matriks |
| **T-ADF4** | Node tak dikenal → teks dipertahankan, dicatat L2, tidak crash | Default aman |
| **T-ADF5** | Karakter Markdown pada teks pengguna di-escape (tidak mengubah format) | §3.1 aturan 4 |
| **T-ADF6** | Mention yang tidak bisa dipetakan menjadi teks bermakna, bukan ID | §3.2 |
| **T-ADF7** | F6 (120 KB) selesai < 500 ms dan tidak kehabisan memori | Performa |
| **T-ADF8** | Laporan konversi: jumlah per level = jumlah node yang diproses (tidak ada yang tak terhitung) | `import-contract.md` §4 |

---

## 9. Rujukan silang

- Kontrak importer & taksonomi L1–L5: `import-contract.md`
- Kolom skema impor: `data-model.md` (`source_*`, `imported_at`, `reconstructed`), ENT-31 `imports`
- Subset Markdown tujuan: `editor-decision.md` §3.1
- Pratinjau sebelum impor: `onboarding.md` §5
- Gate migration: `migrations.md` §1 (M7), `import-contract.md` §7

# Keputusan Editor (C6)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Diputuskan. Menutup celah **C6** di `gaps-analysis.md`.
**Keputusan singkat:** **Markdown tersimpan sebagai sumber kebenaran + editor visual terbatas (toolbar, tanpa Markdown mentah) + pratinjau lossy yang jujur.** Bukan WYSIWYG penuh, bukan Markdown mentah.

---

## 1. Kenapa keputusan ini paling menentukan

Celah C6 disebut "pilihan editor", tapi yang sebenarnya diputuskan adalah empat hal sekaligus:

| Yang ikut ditentukan | Kalau salah, gejalanya muncul di |
| :--- | :--- |
| **Model konflik** (teks polos vs dokumen berstruktur) | Dua orang mengedit deskripsi yang sama (ADR-015 butir 4) |
| **Bentuk penyimpanan** (satu kolom vs JSON) | Migrasi, pencarian, ekspor, impor Jira |
| **Pengalaman persona P3 (HR)** | Adopsi tim non-IT — **pembeda utama produk** |
| **Kemampuan pencarian & potongan teks** | `Ctrl+K`, cuplikan hasil, ekspor CSV |

Menunda keputusan ini berarti menulis UI task dua kali.

---

## 2. Pilihan yang dipertimbangkan

| Opsi | Untuk P3 (HR) | Biaya | Konflik | Risiko utama |
| :--- | :--- | :--- | :--- | :--- |
| **A. Markdown mentah** (textarea + pratinjau) | ❌ Buruk. `**tebal**` dan `## ` adalah kode bagi non-teknis | Paling murah | Mudah (teks) | Persona P3 menolak produk → diferensiasi hilang |
| **B. WYSIWYG penuh** (ProseMirror/Lexical-style, dokumen JSON) | ✅ Sangat baik | **Paling mahal**: skema dokumen, ekspor/impor, pencarian, konflik per-node, aksesibilitas | **Sulit**: perlu merge struktural, bukan teks | Menyerap anggaran R0; konflik pada teks panjang jadi bug halus |
| **C. Rekomendasi: Markdown + editor visual terbatas** | ✅ Baik: toolbar (B/I/link/list/code), tanpa sintaks terlihat | Sedang | **Mudah**: satu teks, LWW + deteksi konflik | Cukup sampai R2; perlu jalur keluar bila kebutuhan tumbuh |

**Keputusan: C.** Alasan ditolak A dan B ada di §4.

---

## 3. Keputusan teknis

### 3.1 Format penyimpanan: Markdown (subset ketat), satu kolom teks

| Aturan | Detail |
| :--- | :--- |
| Sumber kebenaran | **Satu kolom teks** (`tasks.description`, `comments.body`) berisi Markdown subset. |
| Penanda format | Kolom `body_format smallint NOT NULL DEFAULT 1` (1 = `markdown-v1`) pada `tasks` & `comments`. Tanpa ini, perubahan format kelak butuh tebakan. |
| Subset yang didukung (v1) | Paragraf, tebal, miring, `inline code`, blok kode berpagar, tautan, daftar berurut/tak berurut, kutipan, garis pemisah, tabel Sederhana, mention (`@user`), referensi task (`ENG-123`), gambar/lampiran (`![]()`). |
| **Sengaja tidak didukung** | HTML mentah (dilarang, XSS), blok bersarang lebih dari 2 level, diagram, embed eksternal, tabel dengan merged cell. |
| Alasan subset ketat | Setiap elemen tambahan harus didukung di: render, sanitasi, ekspor, pencarian, konversi ADF, dan uji. Empat elemen yang jarang dipakai harganya lebih mahal daripada nilainya. |

**Keamanan (mengikat):** HTML mentah **tidak pernah** dirender. Sanitasi allowlist di server *dan* klien. Tautan `javascript:`/`data:` ditolak. Gambar hanya dari domain object storage kita. Ini bukan preferensi — Markdown yang merender HTML adalah XSS yang menunggu.

### 3.2 Pengalaman pengguna: tanpa sintaks terlihat

| Persona | Yang dilihat |
| :--- | :--- |
| **P3 (HR)** | Kotak teks biasa. Toolbar dengan ikon tebal/miring/daftar/tautan. **Tidak ada** `**` atau `#` yang terlihat saat mengetik; sintaks hanya muncul di dalam blok kode. |
| **P1 (Engineer)** | Sama, ditambah: tempel Markdown (otomatis dirender), pintasan keyboard (`Ctrl+B`, `Ctrl+K` untuk tautan), dan ` ``` ` untuk blok kode yang langsung diformat. |
| Markdown mentah | Dapat diakses lewat tombol "Mode Markdown" (opsional, tersembunyi di menu). Tidak pernah default. |

Alasan `Ctrl+K` untuk tautan: di produk ini `Ctrl+K` **sudah** dipakai command palette. Jadi tautan memakai `Ctrl+Shift+K`, dan command palette tetap `Ctrl+K`. Konflik pintasan seperti ini harus diputuskan sekarang, bukan ditemukan saat uji.

### 3.3 Konflik: LWW + deteksi, tanpa CRDT

Mengikuti ADR-015 butir 4, dengan detail konkret untuk editor:

1. Menyimpan deskripsi/komentar **wajib** mengirim `expected_version` (`api-contract.md` §7.3).
2. Bila `409 conflict.version`: UI **tidak** menimpa. Yang ditampilkan: tiga pilihan — **"Pakai versi saya"**, **"Pakai versi terbaru"**, **"Lihat perbedaan"** (diff baris).
3. Draf lokal disimpan di memori per sesi sehingga pengguna tidak kehilangan apa yang diketik saat konflik.
4. **Tidak ada merge otomatis.** Alasannya: merge otomatis pada teks menghasilkan paragraf yang tidak ditulis siapa pun, dan itu lebih buruk daripada konflik eksplisit.
5. **Tidak ada kolaborasi karakter-per-karakter** (CRDT/Yjs). Ini keputusan sadar, bukan kelalaian — lihat §6.

### 3.4 Render: sisi server untuk pencarian, sisi klien untuk tampilan

| Kebutuhan | Pendekatan |
| :--- | :--- |
| Tampilan | Render Markdown → HTML **di klien**, dengan sanitasi; cache per komentar. |
| Pencarian | Teks **mentah** di-index (`tsvector` generated, ADR-019). Tidak perlu HTML. Konsekuensi: mencari "tebal" yang ditulis `**tebal**` tetap menemukan "tebal" karena `to_tsvector` memecah tanda baca — perlu diverifikasi di uji (T-EDIT5). |
| Cuplikan hasil | Diambil dari teks mentah, sintaks dibuang, dipotong; dihitung server agar payload kecil. |
| Ekspor | Markdown apa adanya (paling portabel). Ekspor HTML opsional ditunda. |

### 3.5 Batas keras & perilaku saat dilanggar

| Batas | Nilai | Perilaku |
| :--- | :--- | :--- |
| Deskripsi | 100 KB teks (`prd.md` §7.4) | Ditolak di klien sebelum kirim; server juga menolak (`413 payload.too_large`) |
| Komentar | 16 KB | Sama |
| Gambar tempel | 10 MB | Ditolak dengan pesan yang menyebut batas & saran kompresi (lihat C5) |
| Blok kode | 20 KB per blok | Ditolak, sarankan lampiran |
| Kedalaman list/kutipan | 2 | Ditolak |

### 3.6 Aksesibilitas (bukan tambahan)

- Editor dapat dipakai penuh dengan keyboard; toolbar dapat dijangkau Tab; `aria-label` pada setiap tombol.
- Mode Markdown menyediakan alternatif teks untuk semua fitur (tidak ada fitur yang hanya-bisa-klik).
- Diff konflik terbaca pembaca layar (bukan hanya warna).
- Ini bagian dari `NFR-015` dan diuji `T-UI4`.

---

## 4. Kenapa bukan WYSIWYG penuh (dan apa yang akan mengubah pikiran saya)

WYSIWYG penuh (dokumen JSON) lebih baik untuk pengguna. Saya tetap menolaknya untuk R0–R2 karena:

1. **Model konflik berlipat.** Dokumen JSON butuh merge per-node. Tanpa itu, dua orang mengedit satu deskripsi akan saling menghapus blok — persis masalah yang ADR-015 berusaha hindari, tapi jauh lebih halus dan lebih sulit diuji.
2. **Empat permukaan tambahan.** Setiap fitur editor harus didukung di render, sanitasi, ekspor, pencarian, konversi ADF, dan uji. Dengan tim 4 orang, itu menggeser anggaran dari fitur inti ke editor.
3. **Importer Jira menjadi dua kali lebih sulit.** Konversi ADF → dokumen JSON berstruktur jauh lebih berat daripada ADF → Markdown, dan justru Markdown yang membuat laporan lossy (L1–L5) mudah dijelaskan.
4. **Risiko diam.** Editor selalu tampak "sudah jalan" padahal tepi kasusnya banyak (tempel dari Word, undo, IME, RTL). Ini jenis pekerjaan yang menghabiskan 3× estimasi tanpa terlihat di demo.

**Triger untuk membuka kembali (terukur):** pindah ke WYSIWYG/dokumen berstruktur hanya bila **dua** terpenuhi: (a) ≥ 30% pengguna aktif menulis deskripsi > 2.000 karakter, **dan** (b) ada ADR baru yang menjelaskan model konflik per-node + rencana migrasi `body_format = 1 → 2`. Kolom `body_format` sudah disiapkan supaya migrasi itu mungkin tanpa menebak.

**Kenapa bukan Markdown mentah:** persona P3 adalah pembeda produk ini (`prd.md` §1). Membuat HR menulis `## ` untuk judul berarti membuang alasan orang memilih Kelindan.

---

## 5. Dampak ke dokumen lain (sudah disinkronkan)

| Dokumen | Perubahan |
| :--- | :--- |
| `migrations.md` §11 | `body_format` wajib ada di migration pertama |
| `api-contract.md` §7.3 | `expected_version` wajib untuk deskripsi/komentar (sudah) |
| `data-model.md` | Kolom `body_format` pada `tasks` & `comments`; subset format dinyatakan |
| `import-contract.md` | ADF → **Markdown subset ini**, bukan Markdown bebas; node di luar subset = L2 (degradasi format), bukan dibuang |
| `testing-strategy.md` §4 | Uji `T-EDIT*` baru (§7 di bawah) |
| `prd.md` `FR-106`/`FR-108` | Merujuk dokumen ini sebagai definisi editor |

---

## 6. Yang secara sadar tidak dibangun (dan risikonya)

| Tidak dibangun | Risiko | Mitigasi |
| :--- | :--- | :--- |
| Kolaborasi real-time karakter-per-karakter | Pengguna yang terbiasa Google Docs akan kecewa | Konflik eksplisit dengan diff; draf lokal tidak hilang |
| Komentar inline pada rentang teks | Tidak bisa menandai "paragraf ini salah" | Komentar per task + mention; evaluasi ulang setelah R2 |
| Blok bersarang / database di dalam dokumen | Bukan lingkup (NG-04) | Tautan ke task lain |
| Lampiran inline yang dirender sebagai galeri | — | Lampiran tampil sebagai daftar; gambar inline didukung |

---

## 7. Uji yang wajib ada (mengikat)

Ditambahkan ke `testing-strategy.md` §4.5 sebagai kelompok `T-EDIT`:

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| **T-EDIT1** | Markdown berisi HTML mentah (`<script>`, `<img onerror>`, `javascript:` link) **tidak pernah** dieksekusi; konten dirender sebagai teks atau dibuang | Keamanan |
| **T-EDIT2** | Tempel dari Word/Google Docs menghasilkan Markdown subset v1 yang valid; elemen di luar subset dilaporkan, tidak membuat konten hilang diam-diam | Pengalaman nyata |
| **T-EDIT3** | Konflik: dua pengguna menyimpan bersamaan → pengguna kedua melihat 409 + tiga pilihan; **tidak ada** teks yang hilang dari draf lokal | ADR-015 butir 4 |
| **T-EDIT4** | Semua elemen subset v1 bertahan bolak-balik: simpan → muat → render → ekspor (round-trip identik) | Tidak ada kehilangan format |
| **T-EDIT5** | Pencarian menemukan kata di dalam `**tebal**`, `[tautan](url)`, dan blok kode | ADR-019 + keputusan §3.4 |
| **T-EDIT6** | Batas 100 KB / 16 KB ditegakkan di klien **dan** server | §3.5 |
| **T-EDIT7** | Editor dapat dipakai penuh dengan keyboard; fokus tidak terperangkap | `NFR-015` |
| **T-EDIT8** | Render 200 komentar Markdown di satu task < 100 ms (mencegah editor membunuh `NFR-003`) | Performa |

---

## 8. Rujukan silang

- Konflik & versi: `architecture.md` ADR-015, `api-contract.md` §7.3
- Format tersimpan & `body_format`: `migrations.md` §11, `data-model.md`
- Konversi ADF: `import-contract.md` §3–§4 (lossy L2)
- Pencarian teks: `architecture.md` ADR-019
- Uji: `testing-strategy.md` §4.5 (`T-EDIT`)
- Persona yang menjadi alasan keputusan ini: `prd.md` §2 (P3)

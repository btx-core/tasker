# Hasil Spike Importer: Apa yang Sudah Terbukti Tanpa Data Jira

**Tanggal:** 2026-11-12 · **Artefak:** `examples/jira-importer/`
**Status:** konverter ADF → Markdown **bekerja dan teruji pada 6 fixture**. Gate `S3`/`S5` **tetap tertutup** untuk data nyata.

---

## 1. Ringkasan jujur

| Deliverable | Sebelum ini | Sekarang | Boleh diklaim lulus? |
| :--- | :--- | :--- | :--- |
| `S1` — fixture data Jira **nyata** 3 sumber | belum | **belum** — tidak ada berkas Jira | ❌ **Tidak** |
| `S2` — konverter ADF → Markdown + laporan lossy | spesifikasi | **implementasi + 6 fixture, 72 node, 0 teks hilang** | ✅ **Ya**, untuk cakupan fixture |
| `S3` — bukti kolom §6 cukup (1.000 issue) | belum | **belum** — butuh issue nyata | ❌ **Tidak** |
| `S4` — angka L2–L5 dari data nyata | belum | **belum** | ❌ **Tidak** |
| `S5` — keputusan revisi skema | struktur | **struktur tetap**; keputusan akhir butuh S3 | ⚠️ **Sebagian** |
| `S6` — performa 10.000 issue < 30 menit | belum | **belum** — konversi saja terukur, impor penuh belum | ❌ **Tidak** |

**Yang berubah secara nyata:** `S2` bukan lagi dokumen. Konverter ada, berjalan, dan diuji. Itu satu-satunya deliverable spike yang bisa diselesaikan tanpa data pelanggan — dan justru yang paling mahal bila dikerjakan setelah data tiba (karena konverter adalah tempat pertama semua bug ADF muncul).

---

## 2. Hasil pengujian

| Fixture | Node | Level maks | L4 | L5 | Byte | ms | Teks hilang |
| :--- | --: | :-- | --: | --: | --: | --: | :-- |
| F1 paragraf/heading/list/code/link | 9 | L1 | 0 | 0 | 240 | 0,71 | **0** |
| F2 panel + expand bersarang | 8 | L2 | 0 | 0 | 132 | 0,17 | **0** |
| F3 tabel merged cell + list dalam cell | 13 | L2 | 0 | 0 | 129 | 0,26 | **0** |
| F4 mention/status/emoji/date/underline | 5 | L3 | 0 | 0 | 93 | 0,13 | **0** |
| F5 macro + smart link + media | 6 | **L4** | **3** | 0 | 300 | 0,18 | **0** |
| F6 deskripsi 77 KB | 31 | L1 | 0 | 0 | 68.872 | 0,20 | **0** |

**Total: 72 node, 3 L4 (semuanya macro/media), 0 teks hilang.**

Uji batas ukuran (`L5`), dengan hasil konversi yang sama (68.872 byte):

| Sebagai | Batas | Hasil |
| :--- | :--- | :--- |
| Deskripsi | 102.400 B | **diterima** (benar) |
| Komentar | 16.384 B | **DITOLAK** `TOO_LARGE` (benar) |

Ini penting: item yang sama bisa sah sebagai deskripsi dan **tidak sah** sebagai komentar. Importer harus memakai batas **per-tujuan**, bukan satu batas global — kalau tidak, komentar panjang akan lolos dan merusak thread.

---

## 3. Tiga bug yang hanya muncul karena konverter dijalankan

Ini bagian yang tidak akan pernah muncul dari membaca spesifikasi. Ketiganya ditemukan pada fixture saya sendiri, dan ketiganya akan muncul pada data pelanggan pertama.

### J1 — Mention menghasilkan `@@budi`

Jira mengirim `attrs.text` yang **sudah** berisi `@budi`. Konverter saya menambahkan `@` lagi:

```
SEBELUM: @@budi tolong cek [Dikerjakan] …
SESUDAH: @budi tolong cek [Dikerjakan] …
```

Sederhana, dan akan muncul pada **setiap** issue yang punya mention — yaitu hampir semuanya. Bug seperti ini tidak ditemukan dengan membaca `spike-jira-importer.md` §4; ia hanya ditemukan dengan menjalankan kode.

### J2 — Label panel adalah teks pengguna, dan bisa menyuntik Markdown

`panelType` datang dari Jira dan bisa berisi teks bebas. Bila nilainya `**penting**`, hasilnya menjadi penekanan yang tidak dimaksudkan. Semua label/title dari pengguna sekarang **di-escape**.

Ini kategori yang layak dicatat: **konverter teks adalah permukaan injeksi.** Bukan injeksi SQL, tetapi injeksi *format* — dan hasilnya adalah Markdown yang dirender di UI kita. Prinsip yang dipakai: nilai dari Jira tidak pernah menjadi markdown mentah, selalu di-escape atau dipetakan.

### J3 — Pemeriksa "teks hilang" saya sendiri keliru

Versi pertama pemeriksa memecah teks per kata lalu membuang tanda baca, sehingga `config.yaml` → `configyaml` dan `on-call` → `oncall` tidak ditemukan di Markdown — padahal teksnya **ada**, tanda bacanya sengaja dipertahankan. Pemeriksa melaporkan "teks hilang" secara palsu.

**Ditemukan, diperbaiki, dilaporkan.** Pemeriksa yang memberi false alarm akan diabaikan orang, dan setelah diabaikan ia tidak lagi melindungi apa pun.

---

## 4. Keputusan desain yang dikonfirmasi oleh hasil

| Keputusan | Bukti |
| :--- | :--- |
| **`underline` → teks biasa (L3), HTML dilarang** | F4: "garis bawah" muncul sebagai teks, tanpa tag. Alternatif `<u>` akan membuka pintu HTML di Markdown — dan itu vektor XSS yang tidak perlu. |
| **`status` lozenge → `[Dikerjakan]` (L3), bukan badge** | F4: teks status selamat. Menyimpannya sebagai metadata akan membutuhkan kolom yang tidak ada di skema. |
| **`taskList` → checkbox GFM (L3), bukan checklist Kelindan** | `spike-jira-importer.md` §4: checklist Kelindan (`ENT-11`) punya assignee & tenggat; memaksakan taskList Jira ke sana akan menciptakan item setengah jadi. |
| **`panel` → blockquote berlabel (L2)** | F2: label "Peringatan"/"Alasan" selamat, struktur bersarang tetap terbaca. |
| **Hanya `extension`/`bodiedExtension` yang L4** | F5: 3 L4, dan **teks di dalam `bodiedExtension` tetap diselamatkan** (`Teks di dalam macro tetap harus selamat.`). Ini membuktikan klaim di dokumen bahwa L4 tidak berarti "buang semuanya". |
| **`colspan` → isi diulang + dicatat L2** | F3: tidak ada padanan Markdown; mengulang lebih baik daripada menghilangkan. |

---

## 5. Yang **tidak** dibuktikan, dan tetap menjadi alasan gate tertutup

| Hal | Kenapa belum |
| :--- | :--- |
| **Distribusi node nyata** | 6 fixture saya ≠ 1.000 issue pelanggan. Saya tidak tahu node mana yang **sering**, hanya mana yang **mungkin**. |
| **Field Jira tanpa padanan** | Ini inti `S5`. Tanpa data nyata, tidak tahu apakah `task_custom_values` perlu naik dari R2 ke R1 — dan itu keputusan mahal. |
| **`S3`**: 1.000 issue ke skema percobaan | Butuh issue nyata. Fixture pegangan hanya membuktikan konverter, bukan kecukupan kolom. |
| **`S6`**: performa impor penuh | Yang terukur hanya konversi ADF (0,2 ms per dokumen). Impor penuh = baca, konversi, resolusi pengguna, tulis, media. |
| **ADF dari Jira Server/DC** | Format berbeda; tidak ada sampel. |
| **Encoding, mention tanpa email, attachment tak terjangkau** | Butuh data nyata. |

**Aturan yang tidak berubah:** `import-contract.md` §7 gate tetap tertutup. Konverter yang bekerja pada fixture saya **bukan** bukti bahwa migrasi pelanggan akan berhasil.

---

## 6. Kerja yang tersisa **persis** saat berkas Jira tiba

| Hari | Kegiatan | Butuh Anda? |
| :--- | :--- | :--- |
| 0 | Terima 3–4 berkas ekspor (boleh dianonimisasi; **struktur ADF utuh**) | **Ya** |
| 1 | Inventaris node: frekuensi per tipe dari data nyata | Tidak |
| 1 | Jalankan konverter yang **sudah ada** pada seluruh issue → laporan L1–L5 | Tidak |
| 2 | Perbaiki node yang belum tertangani (sekarang tinggal daftar, bukan desain) | Tidak |
| 2 | Laporan kolom: field Jira tanpa padanan → keputusan `S5` | Tidak (keputusan saya catat) |
| 3 | Impor 1.000 issue ke skema percobaan → `S3` | Tidak |
| 4 | Ukur impor 10.000 issue → `S6` | Tidak |
| 5 | Perbarui `data-model.md`/`import-contract.md` → `S5` final, gate dibuka | Tidak |

**Estimasi realistis sejak berkas diterima: 3–5 hari kerja**, bukan 6 hari penuh — karena bagian konverter (yang biasanya paling banyak makan waktu) sudah ada dan sudah teruji.

---

## 7. Berkas apa yang saya butuhkan (persis)

1. **Satu** ekspor Jira Cloud, 1 project, 200–1.000 issue — format `POST /rest/api/3/search/jql` (JSON dengan `renderedFields` **tidak** diperlukan; yang dibutuhkan `fields.description` dalam ADF).
2. **Satu** ekspor dengan ADF kompleks: tabel, panel, macro (`toc`, `jira`, `chart`), smart link, media.
3. **Satu** ekspor Jira Server/Data Center (format `wiki`/HTML, bukan ADF) — bila target pelanggan memakai Server/DC.
4. **CSV** ekspor field untuk membandingkan kolom.

**Yang tidak saya butuhkan:** kredensial, URL instance, nama pelanggan, nama orang nyata. Anonimisasi aman **selama struktur ADF tidak diubah** — mengganti teks dengan `XXX` tidak merusak struktur; mengubah `type`/`attrs` merusaknya.

---

## 8. Kesimpulan

`S2` **selesai dan terbukti**, dengan tiga bug ditemukan dan diperbaiki. `S1`, `S3`, `S4`, `S6` **tetap tertutup** dan hanya bisa dibuka oleh data nyata — gate tidak saya longgarkan.

Nilai sebenarnya dari kerja ini: ketika berkas tiba, pekerjaan yang tersisa adalah **mengukur dan menyesuaikan**, bukan **membangun**. Itu perbedaan antara 5 hari dan 3 minggu.

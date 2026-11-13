# Lampiran & Media: Unggah, Kompresi, Tampilan (C5)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat. Menutup celah **C5** di `gaps-analysis.md`.
**Keputusan singkat:** gambar **dikompresi dan dibuatkan thumbnail di klien sebelum diunggah**; byte asli disimpan hanya bila diminta; bucket publik **tidak ada**; unggahan **tidak pernah** memblokir UI.

---

## 1. Kenapa ini berbahaya, dinyatakan sebagai angka

Janji produk adalah "ringan" (`ux-principles.md`). Satu kesalahan di area ini membatalkannya, dan kesalahannya sangat mudah terjadi:

| Skenario (sangat umum) | Tanpa solusi | Dengan solusi dokumen ini |
| :--- | :--- | :--- |
| Screenshot 4 MB ditempel ke deskripsi task | Board memuat 200 kartu × 4 MB = **800 MB**; tab mati | Thumbnail 24 KB × 200 = **4,8 MB** |
| Foto 12 MB dari ponsel (HR mengunggah foto dokumen) | Unggah gagal di jaringan 3G, pengguna menyalahkan produk | Dikompresi klien jadi ~700 KB; unggahan berlanjut |
| Video 200 MB | Ditolak setelah 45 detik menunggu | Ditolak **sebelum** unggah, dengan pesan & saran |
| 50 lampiran di satu task | Halaman detail membeku | Daftar bertahap + lazy load |

**Aturan pengikat:** ukuran byte tidak pernah boleh mempengaruhi latensi board. Itu dicapai bukan dengan "optimasi nanti", tapi dengan **tidak pernah merujuk byte asli dari board**.

---

## 2. Arsitektur: tiga representasi, satu sumber kebenaran

```
asli (opsional)  ──┐
kompresi web     ──┼──► object storage (S3 API, ADR-009)
thumbnail        ──┘

DB (attachments): metadata + storage_key + dimensi + hash + status
```

| Representasi | Kapan dibuat | Kapan dipakai | Batas |
| :--- | :--- | :--- | :--- |
| **Thumbnail** | Selalu untuk gambar | Board, daftar lampiran, mention preview | sisi panjang **256 px**, WebP q75, target **≤ 30 KB** |
| **Kompresi web** ("versi tampil") | Selalu untuk gambar | Detail task, pratinjau, tautan bersama | sisi panjang maks **2.048 px**, WebP q80, target **≤ 400 KB** |
| **Asli** | Hanya bila: gambar > 2.048 px **atau** pengguna menekan "simpan asli" **atau** berkas non-gambar | Unduh eksplisit | Batas global 100 MB (`prd.md` §7.4) |

**Keputusan:** untuk gambar yang lebih kecil dari batas kompresi (mis. 900 px), **asli = versi tampil** — tidak dibuat duplikat. Alasan: menyimpan tiga salinan identik menggandakan biaya storage pelanggan tanpa manfaat.

### 2.1 Metadata wajib (agar board tidak pernah memuat gambar penuh)

`attachments` menyimpan: `width`, `height`, `thumb_key`, `display_key`, `original_key` (nullable), `blurhash` atau warna dominan, `content_type`, `size_bytes`, `checksum_sha256`, `state`.

**Blurhash/warna dominan** dipakai agar board menampilkan placeholder **tanpa** mengunduh apa pun. Ini yang membuat gambar tidak memperlambat render awal.

---

## 3. Alur unggah (tidak pernah memblokir UI)

```
1. Klien: validasi (tipe, ukuran) → kompresi → thumbnail            [lokal, < 300 ms untuk 4 MB]
2. Klien: POST /v1/tasks/{id}/attachments  → presigned URL (10 menit)
3. Klien: PUT thumbnail + PUT display (+ PUT original bila perlu)    [paralel, langsung ke storage]
4. Klien: POST /v1/attachments/{id}/complete → server verifikasi objek, ukuran, tipe
5. Klien: optimistik — lampiran tampil segera dengan blurhash, status "mengunggah"
6. Gagal → status "gagal" + tombol coba lagi; berkas TIDAK hilang dari klien
```

Aturan yang mengikat:

1. **`complete` memverifikasi di server** (objek ada, ukuran sesuai klaim, `content_type` sesuai allowlist, dimensi wajar). Tanpa ini, klien dapat mengklaim apa saja. `INV-09` + `T7`.
2. **Optimistic**: langkah 2–4 tidak menghalangi pengguna menulis deskripsi atau menyimpan task.
3. **Berkas yang tidak pernah `complete` dalam 24 jam** dibersihkan job; tidak dihitung kuota.
4. **Unggah berlanjut (resumable)** untuk berkas > 5 MB: multipart S3 dengan bagian 5 MB. Untuk R0 cukup **satu percobaan ulang dari awal** karena berkas sudah dikompresi kecil; resumable penuh masuk R1 bila ada ukuran > 20 MB yang nyata. Ini dinyatakan, bukan diasumsikan.

---

## 4. Kompresi di klien: aturan yang bisa diuji

| Aturan | Nilai | Alasan |
| :--- | :--- | :--- |
| Format keluaran | **WebP** (fallback JPEG bila browser tidak mendukung encode) | 25–35% lebih kecil dari JPEG pada kualitas setara |
| Sisi panjang maksimum (versi tampil) | 2.048 px | Di atas ini tidak ada manfaat visual di layar 4K yang di-zoom |
| Kualitas | 0,80 (tangga: 0,80 → 0,70 → 0,60 sampai ≤ 400 KB) | Batas ukuran lebih penting daripada kualitas absolut untuk dokumen kerja |
| Thumbnail | 256 px sisi panjang, q75, ≤ 30 KB | Board |
| **EXIF/GPS** | **Dihapus** (kecuali orientasi, yang di-*bake* ke piksel) | Foto ponsel membawa lokasi rumah pengguna; ini risiko privasi nyata, bukan teoretis |
| PNG screenshot dengan teks | Tetap PNG/WebP lossless bila ≤ 400 KB, selain itu WebP lossy | Teks jadi buram pada lossy agresif — screenshot adalah kasus paling umum di produk ini |
| Animasi (GIF/WebP) | Dipertahankan sebagai animasi, maks 5 MB, tanpa thumbnail diam | Memotong animasi merusak makna (mis. demo bug) |
| SVG | **Diterima sebagai berkas, tidak dirender inline** (dapat memuat skrip) | XSS; dirender sebagai gambar raster setelah disanitasi, atau hanya diunduh |
| HEIC (iOS) | Dikonversi ke WebP di klien | Ponsel modern menghasilkan HEIC; tanpa konversi, "produk tidak bisa unggah foto" |
| Berkas non-gambar | Tidak dikompresi, tidak dibuatkan thumbnail; ikon berdasarkan tipe | Kompresi PDF/zip merusak berkas |

**Batas tipe (allowlist, ditegakkan klien & server):** gambar (png/jpeg/webp/gif/avif/heic → dikonversi), PDF, teks/CSV/Markdown, zip, dokumen kantor (docx/xlsx/pptx), video (mp4/webm, maks 50 MB, **tanpa** transcode di R0). Selain itu ditolak dengan pesan yang menyebut tipe yang didukung.

**Batas per task:** 50 lampiran (§7.4), total ≤ 500 MB per task. Melebihi → pesan jelas, bukan gagal diam-diam.

---

## 5. Tampilan & performa (mengikat `UX-B*`)

| Aturan | Nilai | Uji |
| :--- | :--- | :--- |
| Board **tidak pernah** memuat gambar penuh; hanya blurhash/warna & indikator "ada N lampiran" | — | T-MEDIA3 |
| Thumbnail dimuat lazy (IntersectionObserver), dengan `width`/`height` eksplisit (mencegah layout shift) | CLS < 0,1 | T-MEDIA4 |
| Pratinjau di detail memakai `display` (≤ 400 KB), bukan asli | — | T-MEDIA3 |
| Daftar lampiran bertahap: 20 pertama, sisanya saat diminta | — | T-MEDIA4 |
| Tautan unduh = presigned 5 menit, `Content-Disposition: attachment` untuk tipe berbahaya | `INV-09`, ADR-009 | T-MEDIA5 |
| `storage_key` **tidak pernah** di respons API | — | T-MEDIA6 |

---

## 6. Keamanan & privasi

| Risiko | Mitigasi |
| :--- | :--- |
| Bucket publik tidak sengaja | **Tidak ada ACL publik** di semua objek; hanya presigned URL. Diuji otomatis (T-MEDIA6) |
| URL dibagikan ke luar | Umur 5 menit, terikat objek; tidak ada URL permanen |
| Malware pada lampiran | **Tidak ada pemindaian bawaan** (dinyatakan terbuka). Mitigasi: `Content-Disposition: attachment`, tidak ada eksekusi, dan operator boleh memasang pemindai (dokumentasi disediakan) |
| SVG/HTML disajikan sebagai halaman | `Content-Type` dari allowlist; `X-Content-Type-Options: nosniff`; domain storage terpisah dari domain aplikasi (**wajib**) agar XSS tidak menyentuh sesi |
| EXIF/GPS bocor | Dihapus di klien (§4) |
| Kebocoran lintas tenant lewat `storage_key` | Key memuat `workspace_id` sebagai prefix **untuk operasi**, tetapi otorisasi tetap lewat DB (`INV-13`), bukan lewat pola key |
| Unggahan besar sebagai DoS | Batas ukuran + batas laju per user (10 unggahan/menit) + presigned URL terikat ukuran maksimum |

**Domain terpisah untuk storage adalah persyaratan, bukan saran.** Bila storage berada di subdomain aplikasi, satu kesalahan `Content-Type` menjadi XSS dengan sesi pengguna.

---

## 7. Data & skema (perubahan `data-model.md`)

`attachments` (ENT-14) diperluas:

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `thumb_key` | text | ya | null | wajib untuk gambar (dijaga aplikasi) |
| `display_key` | text | ya | null | versi tampil |
| `original_key` | text | ya | null | null bila tidak menyimpan asli |
| `width` / `height` | integer | ya | null | dimensi versi tampil |
| `blurhash` | text | ya | null | placeholder tanpa unduhan |
| `dominant_color` | text | ya | null | fallback bila blurhash tidak tersedia |
| `state` | smallint | tidak | 1 | 1=pending_upload, 2=ready, 3=failed, 4=expired |
| `derivative_status` | smallint | tidak | 1 | 1=client_ready, 2=needs_server_derivation |

`storage_key` yang sudah ada **diganti** menjadi tiga kolom di atas (bukan ditambah), agar tidak ada kebingungan "key mana yang dipakai".

**Kapan server membuat derivatif?** Hanya bila klien tidak bisa (mis. klien mengunggah asli tanpa kompresi karena browser tidak mendukung). Itu job `media.derive`. Alasan: kompresi di klien lebih murah (CPU pengguna) dan menghindari upload byte besar lewat jaringan lambat — tetapi server **wajib** menjadi jaring pengaman, bukan jalan utama.

---

## 8. Uji wajib (`T-MEDIA`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| **T-MEDIA1** | Unggah gambar 4 MB → thumbnail ≤ 30 KB, display ≤ 400 KB, dimensi sesuai | §2, §4 |
| **T-MEDIA2** | EXIF/GPS hilang dari semua derivatif & asli | §4, privasi |
| **T-MEDIA3** | Board dengan 200 task bergambar: **tidak ada** permintaan `display`/`original`; payload board < 300 KB | §5 |
| **T-MEDIA4** | Daftar 50 lampiran: 20 pertama dimuat, sisanya saat diminta; CLS < 0,1 | §5 |
| **T-MEDIA5** | Presigned URL kedaluwarsa/diubah → 403/410; tipe berbahaya diunduh sebagai attachment | §6 |
| **T-MEDIA6** | Tidak ada objek yang dapat diakses publik tanpa presigned URL; `storage_key` tidak pernah di respons (`INV-09`) | §6, T7 |
| **T-MEDIA7** | Tipe di luar allowlist ditolak **di klien sebelum unggah** dan di server | §4 |
| **T-MEDIA8** | SVG tidak pernah dirender inline; HTML disajikan `nosniff` dari domain storage terpisah | §6 |
| **T-MEDIA9** | Unggah gagal (jaringan putus) → status "gagal" + tombol coba lagi; berkas tetap di klien; tidak ada rekaman `ready` palsu | §3 |
| **T-MEDIA10** | `complete` menolak klaim ukuran/tipe yang tidak sesuai objek | §3 aturan 1 |
| **T-MEDIA11** | Unggah 10× dalam 1 menit → dibatasi dengan `429` + `Retry-After` | DoS |
| **T-MEDIA12** | Objek yatim (tidak `complete`) dibersihkan dalam 24 jam dan tidak dihitung kuota | §3 aturan 3 |

---

## 9. Yang secara sadar belum dikerjakan

| Belum ada | Alasan | Kapan |
| :--- | :--- | :--- |
| Transcode video ke thumbnail/mp4 | Mahal (CPU), butuh ffmpeg, tidak memblokir alur inti | R2; sementara: video tampil sebagai kartu dengan tombol unduh |
| CDN gambar | Belum perlu pada skala target; storage + presigned cukup | Bila `T-MEDIA3` gagal di profil HA |
| Pemindaian malware bawaan | Tidak memblokir pilot; operator dapat memasang sendiri | Integrasi opsional R2 |
| Pemotongan/crop gambar di UI | Tambahan UI besar tanpa nilai inti | Tidak direncanakan |
| Resumable penuh (multipart) | Berkas sudah dikompresi kecil di klien | R1 bila ada kebutuhan nyata > 20 MB |
| Versi lampiran (riwayat revisi file) | Bukan kebutuhan inti; tambah kebingungan | Tidak direncanakan |

---

## 10. Rujukan silang

- Object storage & presigned URL: `architecture.md` ADR-009, ADR-022 (baru)
- `INV-09` (key tidak keluar) & ENT-14: `data-model.md`
- Tipe berbahaya & T7: `architecture.md` §5
- Anggaran "ringan": `ux-principles.md` `UX-B1`–`UX-B5`
- Editor & penyisipan gambar: `editor-decision.md` §3.1
- Uji keamanan terkait: `testing-strategy.md` `T-SEC5`

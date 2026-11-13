# Onboarding, Empty State, dan Menit Pertama (C11)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat. Menutup celah **C11** di `gaps-analysis.md`.

**Kenapa ini bukan pekerjaan "polesan".** Empty state adalah tempat produk mati. Pengguna pilot T2 akan menilai Kelindan dalam **90 detik pertama**, dan yang mereka lihat saat itu adalah layar kosong. Tidak ada fitur yang bisa menyelamatkan layar kosong yang tidak menjelaskan apa pun.

Aturan pengikat: **setiap layar kosong wajib punya tepat satu aksi utama**, dan aksi itu harus benar-benar menghasilkan sesuatu dalam < 60 detik.

---

## 1. Empat jenis "pengguna pertama"

Desain yang menyamakan keempatnya akan gagal untuk semuanya.

| # | Siapa | Yang ia punya | Yang ia butuhkan dalam 90 detik |
| :--- | :--- | :--- | :--- |
| **O1** | Admin yang baru menginstal (sysadmin, `P4`) | Akses server, belum ada akun | Keyakinan bahwa instalasi berhasil + akun pertama + workspace pertama |
| **O2** | Anggota pertama yang diundang (bisa HR, `P3`) | Tautan undangan | Paham apa yang harus dikerjakan, tanpa membaca dokumentasi |
| **O3** | Engineer yang memindahkan tim dari Jira (`P1`) | Data di Jira | Keyakinan bahwa migrasi bisa dilakukan & bisa dilihat sebelum diterapkan |
| **O4** | Pengguna yang kembali setelah workspace aktif lama kosong | Akun, workspace, tapi tidak ada kerja | Satu hal berguna untuk dilakukan |

---

## 2. O1 — Instalasi pertama (jalur paling menentukan)

| Langkah | Yang terjadi | Aturan |
| :--- | :--- | :--- |
| 1 | `kelindan setup` (CLI) memeriksa environment: Postgres ≥ 16, ekstensi, disk, koneksi storage, mode email | **Gagal cepat dengan pesan yang menyebut apa yang harus diperbaiki** — bukan stack trace |
| 2 | CLI mencetak **satu URL** + **token setup sekali-pakai** (berlaku 30 menit) | Tanpa token di URL yang dapat di-tebak; tanpa akun default `admin/admin` (celah keamanan yang tidak boleh ada) |
| 3 | Browser: buat akun owner (email + password, Argon2id) | Hanya bisa diakses dengan token setup; setelah selesai, jalur ditutup |
| 4 | Buat workspace (nama + slug) | Slug otomatis disarankan |
| 5 | **Pilih satu dari dua**: "Mulai dari kosong" atau "Impor dari Jira" | Dua pilihan saja, tidak ada wizard 6 langkah |
| 6 | Layar "selesai" menampilkan **3 hal berikutnya** yang konkret (undang anggota, buat tim, aktifkan email) — bukan tur produk | Bisa ditutup & tidak muncul lagi |

**Aturan yang mengikat:**
- **Tidak ada wizard wajib.** Semua langkah setelah akun owner bisa dilewati dan dilakukan nanti.
- **Tidak ada data contoh di produksi** (`migrations.md` §6). Untuk demo, gunakan workspace terpisah lewat CLI.
- **Banner konfigurasi yang belum selesai** (email, storage, backup) tampil di **panel admin saja**, tidak ke semua pengguna, dan bisa ditutup per item setelah dibereskan. Alasan: pengguna biasa tidak boleh melihat "konfigurasi" — itu membuat produk terasa belum jadi.

---

## 3. O2 — Anggota pertama yang diundang

Undangan berisi: **satu kalimat** tentang apa itu Kelindan, nama workspace, siapa yang mengundang, dan **satu tombol**. Tanpa tur, tanpa video, tanpa daftar fitur.

Setelah mendaftar (nama + password), ia mendarat pada:

| Kondisi tim | Yang ditampilkan |
| :--- | :--- |
| Tim punya task yang ditugaskan kepadanya | **"Tugas Anda"** (bukan board kosong) + satu tombol "Buat tugas pertama" bila kosong |
| Tim punya task tapi tidak ada yang ditugaskan | Board tim, dengan satu kartu panduan di kolom pertama: "Buat tugas pertama" + contoh judul yang bisa diklik untuk mengisi |
| Tim kosong sama sekali | Empty state tim (§4) |

**Aturan:** pengguna baru **tidak pernah** mendarat di board kosong tanpa penjelasan. Selalu ada satu aksi yang bisa diklik.

---

## 4. Empty state — naskah yang ditetapkan, bukan diserahkan ke desainer

Setiap empty state punya tiga bagian wajib: **apa ini**, **satu aksi utama**, **satu alternatif**. Tidak ada ilustrasi tanpa teks.

| Layar | Judul | Penjelasan (1 kalimat) | Aksi utama | Alternatif |
| :--- | :--- | :--- | :--- | :--- |
| Board tim kosong | Belum ada tugas | Tugas adalah unit kerja terkecil di Kelindan — satu baris, satu penanggung jawab. | **Buat tugas pertama** | Impor dari Jira |
| Antrean kosong | Antrean bersih | Semua tugas sudah dijadwalkan. Antrean menampung yang belum masuk siklus. | Buat tugas | Lihat board |
| Kotak masuk kosong | Tidak ada yang perlu diperiksa | Notifikasi penugasan dan `@mention` muncul di sini, bukan di email. | Atur notifikasi | — |
| Pencarian tanpa hasil | Tidak ditemukan | Coba kata yang lebih pendek, atau periksa filter yang aktif. | Hapus filter | Cari di semua tim |
| Checklist kosong | Belum ada langkah | Pecah tugas menjadi langkah kecil; tiap langkah bisa punya penanggung jawab. | Tambah langkah | — |
| Komentar kosong | Belum ada diskusi | Sebut rekan dengan `@` untuk memberi tahu mereka. | Tulis komentar | — |
| Lampiran kosong | Belum ada berkas | Gambar dikompresi otomatis agar board tetap ringan. | Unggah berkas | — |
| Goal kosong (R1) | Belum ada goal | Goal mengumpulkan tugas lintas tim untuk satu hasil. | Buat goal | — |
| Siklus kosong (R1) | Siklus belum dimulai | Siklus membatasi pekerjaan pada rentang waktu tertentu. | Mulai siklus | Matikan siklus |
| Tim kosong (workspace baru) | Belum ada tim | Tim memisahkan pekerjaan Engineering, HR, Marketing — masing-masing dengan pengaturannya sendiri. | **Buat tim pertama** | Pakai template |

**Aturan tambahan:**

1. **Teks empty state tidak memakai jargon** (`ux-principles.md` UX-3) — diuji `T-UX2`.
2. **Tidak ada empty state yang hanya berisi ikon** (`UX-9`).
3. **Tidak ada empty state dengan dua aksi setara** — satu utama, satu alternatif.
4. Bila data gagal dimuat, yang tampil adalah **error state**, bukan empty state. Membedakan keduanya wajib: "gagal memuat" bukan "tidak ada data".
5. Empty state tidak boleh muncul berkedip sebelum data datang: tampilkan skeleton ≤ 400 ms dulu (`ux-principles.md` §6).

---

## 5. O3 — Pindah dari Jira (tanpa rasa takut)

Ini titik onboarding yang paling menentukan konversi pilot. Alurnya **pratinjau dulu, baru terapkan**.

| Tahap | Yang terjadi | Aturan |
| :--- | :--- | :--- |
| 1 | Unggah berkas ekspor Jira / hubungkan sumber | Jalur file lebih diutamakan (`import-contract.md` §2) |
| 2 | **Tidak langsung mengimpor.** Sistem menjalankan analisis dan menampilkan **laporan pratinjau**: jumlah issue, status, kategori, komentar, lampiran, dan perkiraan L1–L5 | Tanpa pratinjau, pengguna tidak akan berani menekan tombol |
| 3 | Pengguna memilih lingkup (project mana, periode apa) | Bisa mengimpor sebagian |
| 4 | Impor dijalankan sebagai job dengan progres yang jujur (tanpa total palsu) | `import-contract.md` §1 |
| 5 | Laporan akhir L1–L5 dengan contoh & CSV | Wajib, bahkan bila 100% L1 |
| 6 | **Bisa dibatalkan** selama berjalan; impor bisa diulang tanpa menggandakan data | `IC-8`, `IC-9` |

**Aturan yang mengikat:** tidak ada jalan pintas "impor sekarang, lihat nanti". Pratinjau bukan fitur tambahan — ia yang membuat migrasi bisa dipercaya.

---

## 6. O4 — Workspace yang lama kosong

Yang berbahaya: pengguna yang mendaftar, tidak jadi memakai, lalu kembali 3 minggu kemudian ke layar kosong tanpa jejak. Untuk mereka:

- Tampilkan **ringkasan kecil** di beranda: "Workspace ini dibuat 21 hari lalu, belum ada tugas."
- Satu aksi: **buat tim pertama** atau **impor dari Jira**.
- Tidak ada tur produk yang diputar ulang.
- Notifikasi onboarding tidak boleh dikirim ke email bila email belum dikonfigurasi (`email.md` §2.2).

---

## 7. Checklist "mulai" (bukan tur)

Panel kecil di beranda admin, **bisa ditutup permanen**, maksimum **3 item aktif** pada satu waktu:

| Item | Selesai bila |
| :--- | :--- |
| Undang rekan pertama | ≥ 1 anggota selain owner |
| Buat tim pertama | ≥ 1 tim |
| Konfigurasi email | Mode transport ≠ `none` dan email uji terkirim |
| Pasang backup terjadwal | Job backup terdaftar (profil Standar) |
| Impor dari Jira | Satu impor berstatus selesai |

**Aturan:** checklist hanya di **panel admin**, tidak pernah untuk anggota biasa. Maksimum 3 item tampil sekaligus (sisanya menunggu) agar tidak menjadi daftar tugas yang membuat orang menyerah. Setiap item menjelaskan **kenapa** ia penting dalam satu kalimat.

---

## 8. Nada penulisan (mengikat, karenanya ditulis)

| Aturan | Contoh benar | Contoh salah |
| :--- | :--- | :--- |
| Sebut apa yang terjadi, bukan apa yang sistem pikirkan | "Tugas dipindahkan ke Selesai" | "Berhasil!" |
| Sebut langkah berikutnya pada error | "Gagal menyimpan — periksa koneksi, lalu coba lagi." | "Terjadi kesalahan." |
| Jangan menyalahkan pengguna | "Judul maksimum 300 karakter (sekarang 412)." | "Input tidak valid." |
| Kalimat aktif, subjek jelas | "Budi mengubah status" | "Status telah diubah oleh" |
| Tanpa tanda seru, tanpa emoji di pesan sistem | "Tersimpan" | "Berhasil! 🎉" |
| Istilah sesuai glosarium | "Siklus", "Antrean", "Beban" | "Sprint", "Backlog", "Story point" |

**Diuji:** `T-UX2` (istilah terlarang) dan pemeriksaan nada pada sesi uji pengguna (§9).

---

## 9. Cara mengukur keberhasilan (bukan opini)

| Ukuran | Target R0 | Cara |
| :--- | :--- | :--- |
| Waktu sampai task pertama dibuat (O2) | **< 60 detik** dari login pertama | Telemetri anonim & opt-out, atau sesi uji pengguna |
| Tugas selesai tanpa bantuan (persona HR) | **≥ 4 dari 5** | Sesi uji per rilis (`ux-principles.md` §8) |
| Pengguna baru yang membuat ≥ 1 task dalam 24 jam | ≥ 70% | Metrik produk |
| Instalasi O1 sampai workspace siap | **< 5 menit** | Uji instalasi di VM 2 vCPU setiap rilis (`NFR-016`) |
| Pratinjau impor dilihat sebelum impor dijalankan | 100% (dipaksa alur) | Uji |
| Empty state tanpa aksi utama | **0** | Pemeriksaan otomatis pada katalog empty state |

**Keputusan tentang telemetri:** bila ada, maka **opt-out**, anonim, tanpa isi pekerjaan, dan **mati secara default pada instalasi self-host**. Alternatifnya (tidak ada telemetri) diterima — tetapi kemudian ukuran di atas hanya bisa dari sesi uji. Ini dinyatakan supaya tidak ada yang mengira angka di tabel ini datang sendiri.

---

## 10. Uji wajib (`T-ONB`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| **T-ONB1** | Instalasi bersih → workspace siap < 5 menit di VM 2 vCPU, tanpa akun default | §2 |
| **T-ONB2** | Setiap empty state pada katalog §4 punya tepat satu aksi utama dan **0** istilah terlarang | §4, `UX-9` |
| **T-ONB3** | Error state tidak pernah tampil sebagai empty state | §4 aturan 4 |
| **T-ONB4** | Undangan → login pertama → task pertama < 60 detik (uji otomatis alur) | §9 |
| **T-ONB5** | Impor Jira tidak bisa dijalankan tanpa pratinjau dilihat | §5 |
| **T-ONB6** | Checklist admin maksimum 3 item tampil; anggota biasa tidak pernah melihatnya | §7 |
| **T-ONB7** | Tidak ada data contoh di instalasi produksi | §2 |
| **T-ONB8** | Banner konfigurasi (email/storage/backup) hanya tampil untuk admin | §2 |

---

## 11. Rujukan silang

- Prinsip & anggaran UX: `ux-principles.md` (`UX-9`, `UX-E4`, `UX-B8`)
- Naskah & nada: glosarium `prd.md` §9
- Instalasi & profil: `architecture.md` ADR-016, `decisions-r0.md` D-03
- Pratinjau impor: `import-contract.md` §7
- Banner email belum dikonfigurasi: `email.md` §2.1
- Larangan data contoh: `migrations.md` §6

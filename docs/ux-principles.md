# Prinsip UX & Anggaran "Ringan" — Terukur

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat. Menjawab tujuan produk: *ramah pengguna, mudah dipakai, dan tetap ringan untuk ribuan pengguna.*

**Kenapa dokumen ini ada.** "Ramah, mudah, ringan" adalah tiga kata yang tidak bisa diuji. Dokumen ini mengubahnya menjadi **aturan yang bisa gagal**, sehingga setiap keputusan UI punya hakim — bukan selera.

Aturan pengikat: **tidak ada keputusan UX yang diambil berdasarkan "menurut saya lebih enak"**. Setiap usulan harus menyebut prinsip mana yang dilayani, dan biaya apa yang dibayar.

---

## 1. Tiga kata itu, diterjemahkan menjadi angka

| Kata | Berarti (terukur) | Ditolak bila |
| :--- | :--- | :--- |
| **Ringan** | Muat awal p75 < 2,5 s, bundle < 300 KB gzip, interaksi p95 < 100 ms, List 10.000 baris ≥ 50 fps, memori tab < 250 MB setelah 30 menit pemakaian | Melewati `NFR-003`, `NFR-008`, `NFR-009`, atau `UX-B*` di §4 |
| **Mudah** | Task baru bisa dibuat dalam ≤ 2 interaksi; tidak ada alur inti yang butuh > 3 klik; tidak ada jargon S1–S5 di UI | Butuh > 5 klik untuk tugas harian, atau memunculkan istilah teknis di layar utama |
| **Ramah** | Tidak ada jalan buntu: setiap error punya langkah berikutnya; setiap aksi bisa dibatalkan (undo) atau diulang; tidak ada kehilangan input | Ada error tanpa `code`/pesan tindakan, atau input pengguna hilang saat gagal |

---

## 2. Sepuluh prinsip (mengikat, berurutan prioritas)

Bila dua prinsip bertabrakan, nomor lebih kecil menang.

### UX-1 — Kecepatan terasa adalah kejujuran
Interaksi tidak menunggu jaringan (optimistic, ADR-015). Tetapi **lebih penting**: bila gagal, UI harus **mengaku** dan kembali. UI yang tetap menampilkan "berhasil" padahal gagal lebih buruk daripada UI yang lambat. *Uji: T-UI2.*

### UX-2 — Layar default harus berguna tanpa konfigurasi
Tim baru langsung punya 5 status, board, dan list. Tidak ada wizard wajib, tidak ada "pilih template dulu". Template tersedia, tapi **bukan gerbang**. *Konsekuensi: `FR-106` (form 3 field), `FR-107` (template opsional).*

### UX-3 — Satu bahasa, tanpa jargon
Semua istilah dari glosarium `prd.md` §9. Lima istilah yang **dilarang** muncul di UI: `issue`, `sprint`, `story point`, `epic`, `JQL`. Bila butuh konsep baru, ia harus masuk glosarium lebih dulu. *Diuji oleh pemeriksaan string di CI (`UX-B7`).*

### UX-4 — Setiap angka manajemen harus punya definisi yang bisa dibuka
Grafik menampilkan jumlah sampel. Angka tanpa definisi disembunyikan, bukan ditampilkan dengan tanda tanya. *Konsekuensi: `prd.md` §8; grafik < 5 sampel tidak digambar.*

### UX-5 — Kegagalan harus terlihat dan bisa dilanjutkan
Setiap error: `code` → pesan manusia → **aksi berikutnya** → `trace_id` yang bisa disalin. Tidak ada pesan "Terjadi kesalahan". *Diuji `api-contract.md` §5.4.*

### UX-6 — Jangan pernah menghilangkan input pengguna
Draf disimpan di memori; konflik diselesaikan dengan pilihan, bukan dengan menimpa. *Uji: T-EDIT3.*

### UX-7 — Fitur tersembunyi harus bisa ditemukan
Semua aksi ada di command palette **dan** di menu. Fitur yang hanya bisa diakses lewat pintasan = fitur yang tidak ada bagi pengguna baru.

### UX-8 — Satu jalan pintas untuk satu hal
`Ctrl+K` = command palette **selalu**. Tidak ada perebutan pintasan. Daftar pintasan adalah dokumen yang diversikan (`ux-principles.md` §7), bukan hasil kebiasaan.

### UX-9 — Kosong itu mengundang, bukan menakutkan
Empty state menjelaskan **apa** yang akan terjadi dan memberikan **satu** aksi utama. Tidak ada empty state yang hanya berisi ilustrasi.

### UX-10 — Beban kognitif dibayar per layar, bukan per fitur
Setiap field yang tampil harus "membayar dirinya": dipakai > 10% kasus **atau** wajib untuk alur. Field yang jarang dipakai pindah ke panel sekunder (pill, seperti `FR-106`). Ini alasan teknis kenapa toggle per tim (ADR-007) adalah keputusan UX, bukan hanya arsitektur.

---

## 3. Tata letak & hierarki informasi

### 3.1 Tiga permukaan, tidak lebih

| Permukaan | Isi | Aturan |
| :--- | :--- | :--- |
| **Board/List (ruang kerja)** | Kerja sehari-hari: lihat, ubah status, ubah assignee | Inline editing wajib (`FR-101`); tanpa navigasi halaman untuk perubahan umum |
| **Detail task (panel samping, bukan halaman penuh)** | Deskripsi, komentar, checklist, lampiran, riwayat | Dibuka **tanpa** kehilangan konteks board (panel/overlay); tutup → kembali tepat di posisi scroll semula |
| **Kotak masuk & pengaturan** | Notifikasi, tim, anggota, toggle | Bukan tempat kerja; tidak boleh ada aksi yang hanya ada di sini |

**Keputusan yang ditolak:** halaman detail penuh (memaksa pengguna kehilangan konteks). **Alasan:** pada kerja berulang 50×/hari, biaya "kembali ke posisi semula" jauh lebih besar daripada keuntungan ruang.

### 3.2 Informasi bertingkat (progressive disclosure)

Isi kartu board **hanya**: judul, nomor, assignee, prioritas, label (maks 3 + "+n"), indikator checklist (`3/7`), ikon dependency, penanda terlambat.
**Tidak** ditampilkan di kartu: deskripsi, komentar terakhir, riwayat, effort (kecuali tim menyalakan `effort`), tanggal mulai.

Alasan: kartu adalah elemen yang paling sering dirender (50–200 per layar). Setiap field menambah biaya render **dan** beban baca.

---

## 4. Anggaran "ringan" yang mengikat (`UX-B*`)

Ini angka yang **memblokir merge**, bukan target aspirasional. Diukur pada build produksi, perangkat kelas menengah (4× CPU throttle).

| # | Anggaran | Ambang | Alasan angka ini |
| :--- | :--- | :--- | :--- |
| **UX-B1** | Bundle awal (route kerja) | **< 300 KB gzip** | Di bawah 300 KB, muat awal di 3G cepat masih < 3 s. Elemen terbesar biasanya editor & tabel — karena itu keduanya dimuat **malas** (lazy). |
| **UX-B2** | Bundle route detail task | < 120 KB gzip tambahan | Detail dibuka sesering board; tidak boleh lebih berat dari board. |
| **UX-B3** | Interaksi task (ubah status/assignee) | p95 < 100 ms, p99 < 250 ms | `NFR-003` |
| **UX-B4** | Render Board 100 kartu | < 150 ms | Di atas ini, drag terasa "berat" |
| **UX-B5** | Render awal List 10.000 baris | < 1 s; scroll ≥ 50 fps | `NFR-009` |
| **UX-B6** | Memori tab setelah 30 menit pemakaian aktif | < 250 MB, tanpa pertumbuhan > 5 MB/menit | Kebocoran memori terlihat sebagai "aplikasi jadi lambat setelah sejam" — keluhan klasik yang sulit didiagnosis |
| **UX-B7** | Jumlah istilah terlarang & jargon di UI | **0** | Pemeriksaan string otomatis di CI |
| **UX-B8** | Jumlah klik untuk tugas harian | Buat task ≤ 2, ubah status ≤ 1, komentar ≤ 2 (dari board) | `UX-2` |
| **UX-B9** | Jumlah permintaan jaringan saat membuka board | ≤ 3 (halaman board, status+label tim, delta sync) | Setiap tambahan adalah latensi baru |
| **UX-B10** | Waktu sampai konten berguna (bukan skeleton) | p75 < 1,5 s pada data cache | Skeletons tanpa akhir adalah kegagalan yang menyamar sebagai desain |

**Cara menegakkan:** semua `UX-B*` diukur di CI pada setiap PR yang menyentuh frontend, dengan grafik tren per commit. Regresi melewati ambang = merge diblokir (`testing-strategy.md` §5 aturan yang sama).

---

## 5. Elemen UX yang wajib ada di R0

Bukan "nice to have" — tanpa ini, klaim "mudah" tidak bisa dipertahankan:

| # | Elemen | Kenapa wajib di R0 |
| :--- | :--- | :--- |
| UX-E1 | **Command palette** | `UX-7`; pengguna berpengalaman tidak mau memakai mouse |
| UX-E2 | **Inline editing** di board & list | `UX-1`, `UX-B8` |
| UX-E3 | **Undo** untuk aksi merusak (hapus task, hapus komentar, pindah kolom) | `UX-5`; tanpa undo, pengguna takut mengklik |
| UX-E4 | **Empty state yang mengundang** (dengan satu aksi) | `UX-9` |
| UX-E5 | **Keyboard navigation penuh** | `NFR-015`; juga syarat aksesibilitas |
| UX-E6 | **Panel detail tanpa kehilangan konteks** | §3.1 |
| UX-E7 | **Indikator status sinkronisasi** (tenang, tidak menakutkan): "tersimpan", "menyinkronkan", "gagal — coba lagi" | `UX-1`; pengguna harus tahu kapan data belum aman |
| UX-E8 | **Pencarian judul dari palette** < 150 ms | `NFR-006`; ini satu-satunya "navigasi" yang dipakai pengguna lama |
| UX-E9 | **Penanda terlambat + "tugas saya"** dalam satu klik | Nilai harian terbesar bagi P1/P2 |
| UX-E10 | **Pratinjau sebelum impor Jira** | `import-contract.md`; mencegah kejutan yang tidak bisa dibatalkan |

---

## 6. Anti-pola yang dilarang (dengan alasan)

| Dilarang | Kenapa | Yang dipakai |
| :--- | :--- | :--- |
| Modal untuk form panjang | Mengunci konteks & buruk untuk keyboard | Panel samping |
| Skeleton tanpa batas waktu | Menyembunyikan kegagalan | Skeleton < 400 ms, lalu empty/error state nyata |
| Toast untuk error penting | Hilang setelah 5 s; pengguna tidak sempat membaca | Banner sebaris + trace ID yang bisa disalin |
| Konfirmasi ganda untuk aksi yang bisa di-undo | Menambah gesekan harian | Undo (UX-E3) |
| Ikon tanpa label pada aksi utama | Tidak bisa ditebak pengguna baru | Ikon + teks untuk aksi utama; ikon saja hanya untuk universal (tutup, cari) |
| Warna sebagai satu-satunya pembeda status | Gagal aksesibilitas & buta warna | Warna + bentuk/ikon + teks |
| Animasi > 200 ms pada interaksi | Membuat UI terasa lambat walau datanya cepat | Transisi 120–160 ms, dan hormati `prefers-reduced-motion` |
| Virtualisasi yang menghapus pencarian dalam halaman | Pengguna tidak bisa menemukan apa pun | Pencarian filter di server (ADR-019) |
| Menyembunyikan tombol karena tidak berizin (403) | Pengguna tidak tahu kenapa | Tombol nonaktif + alasan (`api-contract.md` §5.4) |
| Menampilkan data rahasia tim lain dalam daftar pilihan | Kebocoran lewat dropdown | Daftar selalu ter-scope (`INV-12`) |

---

## 7. Pintasan keyboard (kanonik, mengikat)

| Pintasan | Aksi | Catatan |
| :--- | :--- | :--- |
| `Ctrl/Cmd+K` | Command palette (cari & lakukan apa saja) | **Selalu** ini |
| `C` | Buat task baru (saat board fokus, bukan di input) | |
| `E` | Edit judul task terpilih | |
| `A` | Ubah assignee | |
| `S` | Ubah status | |
| `1`–`5` | Pindah ke kategori status 1–5 | |
| `?` | Daftar pintasan | |
| `Esc` | Tutup panel/modal | |
| `Ctrl+Shift+K` | Sisipkan tautan di editor | Karena `Ctrl+K` sudah dipakai |
| `Ctrl+Enter` | Kirim komentar | |
| `J` / `K` | Naik/turun item di list | |

Aturan: pintasan **tidak boleh** aktif saat fokus ada di input teks (kecuali `Ctrl`+kombinasi). Konflik pintasan yang ditemukan saat uji = perubahan pada tabel ini lebih dulu.

---

## 8. Bagaimana prinsip ini diputuskan & diuji

1. **Setiap desain UI baru** menyebut: prinsip mana (`UX-n`), anggaran mana (`UX-B*`), dan uji mana yang menjaganya.
2. **Review desain** menolak usulan yang tidak menyebut ketiganya — bukan karena formalitas, tapi karena tanpa itu kita kembali ke "menurut saya lebih enak".
3. **Uji otomatis** menegakkan `UX-B1`–`UX-B5`, `UX-B7`, `UX-B9` (`testing-strategy.md` §5). `UX-B6`, `UX-B8`, `UX-B10` diukur pada pemeriksaan rilis dan sesi uji pengguna.
4. **Satu sesi uji pengguna per rilis** dengan 3 orang dari persona P3 (HR) mengerjakan 5 tugas (buat permintaan, temukan tugasnya, beri komentar, ubah status, cari arsip). Hasilnya: berapa yang selesai tanpa bantuan. Target: **≥ 4 dari 5 tugas tanpa bantuan** untuk rilis R0. Ini ukuran "mudah" yang sebenarnya — bukan opini tim.

---

## 9. Rujukan silang

| Klaim | Dokumen |
| :--- | :--- |
| SLO performa & dataset acuan | `prd.md` §7 |
| Optimistic UI & konflik | `architecture.md` ADR-015 |
| Editor & pengalaman menulis | `editor-decision.md` |
| Anggaran performa yang memblokir merge | `testing-strategy.md` §5 |
| Tombol nonaktif vs 404 | `api-contract.md` §5.4–5.5 |
| Toggle per tim sebagai keputusan UX | `architecture.md` ADR-007 |
| Empty state, onboarding | `gaps-analysis.md` C11 (masih terbuka, tetapi `UX-E4` mengikat di R0) |

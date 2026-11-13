# Versioning, Rilis, dan Konvensi Kontribusi (Dokumen B)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat.

Dokumen ini mengisi celah yang sebelumnya hanya tersirat di `migrations.md` §9 dan `testing-strategy.md` §8: **kapan sesuatu dirilis, versinya berapa, dan bagaimana orang di luar tim bisa berkontribusi tanpa merusak sesuatu.**

---

## Bagian I — Versioning

## 1. Skema versi: SemVer, tetapi dengan janji yang jelas

`MAJOR.MINOR.PATCH` mengikuti SemVer 2.0.0. Yang penting bukan skemanya, tapi **apa yang dijanjikan** tiap angka:

| Angka | Janji | Contoh perubahan |
| :--- | :--- | :--- |
| **MAJOR** | Ada perubahan yang **merusak**: API (`v1`→`v2`), konfigurasi wajib baru, atau skema yang butuh langkah manual | Menghapus endpoint; mengganti variabel env |
| **MINOR** | Ada fitur baru, **tanpa** merusak: tambah endpoint, tambah field opsional, tambah `code` error baru | `FR-201` Goals |
| **PATCH** | Hanya perbaikan & keamanan; tanpa fitur | Perbaikan drag & drop; patch CVE |

**Aturan yang mengikat:**

1. **Versi produk ≠ versi API.** Produk boleh `1.4.0` sementara API tetap `/v1`. Alasan: UI berubah setiap rilis; API harus stabil bertahun-tahun (`api-contract.md` §2.1).
2. **`0.x` bukan produksi.** Selama masih `0.y.z`, semua janji di atas **tidak berlaku** — dinyatakan terbuka agar tidak ada yang memasang `0.9` di perusahaan dan mengira stabil. Rilis pertama yang dijanjikan stabil adalah **`1.0.0`**.
3. **Setiap rilis punya versi skema database** yang tercatat (`schema_migrations`), dan aplikasi menolak start bila versi skema **lebih baru** dari yang dikenalnya (`migrations.md` §9 — tidak ada downgrade).

---

## 2. Kadensi & cara memutuskan kapan rilis

| Rilis | Kadensi | Isi | Gate |
| :--- | :--- | :--- | :--- |
| **Patch** | Sesuai kebutuhan (≤ 24 jam untuk keamanan kritis) | Perbaikan | Semua uji wajib (`testing-strategy.md` §8) minus uji performa penuh |
| **Minor** | Setiap **gate rilis tercapai**, bukan tanggal tetap | Fitur | §8 `testing-strategy.md` lengkap + drill restore |
| **Major** | Hanya bila perlu; jarang | Perubahan merusak | Minor + panduan migrasi + masa transisi `v1`/`v2` paralel ≥ 6 bulan |

**Keputusan: rilis mengikuti bukti, bukan kalender.** Tidak ada "rilis tiap Jumat". Alasan: rilis terjadwal memaksa orang merilis sesuatu yang belum siap — dan pada produk self-host, rilis yang belum siap berarti instalasi pelanggan rusak.

**Gate R0/R1/R2** (`prd.md` §5) adalah gate **produk**, bukan gate rilis. Sebuah R0 yang selesai bisa dirilis sebagai `0.9.0`, lalu `1.0.0` setelah pilot T2 memberi umpan balik.

---

## 3. Saluran rilis

| Saluran | Versi | Untuk siapa | Stabilitas |
| :--- | :--- | :--- | :--- |
| `main` (build harian) | `0.0.0-dev.<sha>` | Tim sendiri | Tidak dijanjikan |
| **`canary`** | `1.4.0-canary.3` | Pilot T2 yang mau mencoba lebih awal | Boleh berubah; ada catatan "jangan untuk produksi" |
| **`stable`** (default) | `1.4.0` | Semua orang | Semua janji berlaku |
| `lts` (bila ada) | `1.4.0-lts.1` | Perusahaan yang butuh dukungan lebih lama | Patch keamanan saja |

**Aturan:** pilot T2 memakai `canary` **hanya bila mereka memilihnya**. Tidak pernah memaksa pengguna pilot menjadi penguji versi belum stabil tanpa persetujuan — itu cara tercepat kehilangan mereka.

---

## 4. Catatan rilis: format yang ditetapkan

Setiap rilis punya satu berkas `CHANGELOG.md` dengan bagian berikut. Yang **wajib** ditandai agar operator tahu apa yang harus dilakukan.

| Bagian | Isi | Wajib |
| :--- | :--- | :--- |
| **Perlu tindakan** | Langkah manual: migrasi lama, env baru, konfigurasi berubah | Ya, bila ada — **di paling atas** |
| **Breaking** | Apa yang rusak dan bagaimana beradaptasi | Bila ada |
| **Ditambahkan** | Fitur baru | |
| **Diubah** | Perubahan perilaku | |
| **Diperbaiki** | Bug | |
| **Keamanan** | CVE/kerentanan (tanpa detail eksploitasi) | Bila ada |
| **Batas diketahui** | Bug terbuka yang memengaruhi rilis ini + jalan pintas | Ya (`support.md` §6) |
| **Migrasi** | Nama migrasi yang berjalan + estimasi durasi + apakah `reversible: no` | Ya, bila ada skema berubah |
| **Identitas** | Commit, hash image, tautan SBOM (`FR-115`, `security-policy.md` §6) | Ya |

**Aturan penulisan:** dibaca oleh **sysadmin**, bukan developer. "Kami memfaktorkan ulang lapisan repository" bukan catatan rilis. "Rilis ini menambahkan kolom `body_format`; migrasi berjalan ±2 detik pada 500 ribu task" adalah catatan rilis.

---

## 5. Deprecation & penghapusan

| Jenis | Masa transisi | Mekanisme |
| :--- | :--- | :--- |
| Endpoint/field API | **≥ 6 bulan** | Header `Deprecation` + `Sunset`; `v1` tetap penuh berfungsi (`api-contract.md` §11.3) |
| Variabel env | ≥ 2 minor | Terima nama lama dengan peringatan di log selama masa transisi |
| Flag fitur | ≤ 2 rilis | Setelah itu dihapus; flag yang menetap = utang (`repo-layout.md` §5.2) |
| Kolom database | ≥ 1 rilis penuh setelah tak dibaca | `migrations.md` §4 aturan 3 |
| Toggle tim (`teams.feat_*`) | **Tidak pernah dihapus** | Itu fitur produk, bukan flag (ADR-007) |

**Aturan:** tidak ada penghapusan mendadak, **kecuali** untuk alasan keamanan — dan itu harus dinyatakan sebagai pengecualian di catatan rilis dengan alasannya.

---

## Bagian II — Konvensi Kontribusi

## 6. Siapa boleh berkontribusi & bagaimana

| Aspek | Keputusan | Alasan |
| :--- | :--- | :--- |
| Model kontribusi | **DCO** (`Signed-off-by`), tanpa CLA | ADR-014: relicensing sudah dinyatakan tidak mungkin; CLA akan menghalangi kontributor |
| Issue dulu atau PR dulu | **PR langsung boleh** untuk perbaikan kecil & dokumentasi; **issue dulu wajib** untuk fitur baru, perubahan skema, dan perubahan API | Mencegah orang menulis 2 minggu kode untuk fitur yang masuk non-goal |
| Bahasa | Dokumen & komentar kode: **Inggris** untuk kode publik; dokumen desain boleh Indonesia | Kontributor luar tidak bisa membaca komentar Indonesia; dokumen desain adalah konteks internal |
| Pesan commit | Conventional Commits + trailer `Signed-off-by` | `repo-layout.md` §8 |
| Format kode | Ditegakkan tool, tidak didiskusikan di review | Waktu review untuk hal mekanis adalah pemborosan |

**Aturan yang mengikat:** **PR yang menambah fitur di luar `prd.md` §6 tanpa issue yang disetujui ditolak** — bukan karena tidak bagus, tapi karena lingkup adalah satu-satunya hal yang melindungi tim kecil (`prd.md` §4). Penolakan menyebut non-goal yang relevan, bukan "belum prioritas".

---

## 7. Template PR (isi wajib)

Setiap PR memuat, dalam urutan ini:

1. **Apa & mengapa** — satu paragraf; bukan daftar berkas yang berubah.
2. **ID yang dilayani** — `FR-*` / `INV-*` / `ADR-*` / `AC-*` (`repo-layout.md` §7).
3. **Uji yang ditambahkan** — nama uji `T-*`, dan apa yang akan gagal bila perbaikannya dibatalkan.
4. **Dampak ke pengguna** — terlihat/berubah. Untuk perubahan UI: tangkapan layar atau rekaman.
5. **Dampak ke operator** — apakah butuh migrasi, env baru, langkah manual. **Tidak boleh kosong** tanpa alasan.
6. **Risiko & rollback** — bagaimana cara membatalkan bila salah.
7. **Yang **tidak** dikerjakan** — batas PR ini, agar reviewer tidak menebak.

**Aturan nomor 7** adalah yang paling sering dihilangkan dan paling berguna: ia memberi tahu reviewer bahwa sesuatu memang sengaja belum ada, bukan terlupa.

---

## 8. Review: apa yang dicari (dan apa yang bukan)

| Dicari | Tidak dicari |
| :--- | :--- |
| Apakah perilaku sesuai dokumen (ID disebut) | Selera gaya (ditegakkan tool) |
| Apakah uji benar-benar bisa gagal | Cakupan persentase |
| Apakah ada jalur yang lupa diotorisasi (`T-A1`) | Penamaan variabel lokal |
| Apakah kegagalan terlihat oleh pengguna (`UX-5`) | Optimasi prematur |
| Apakah ada perubahan yang tidak bisa dibatalkan | Preferensi arsitektur pribadi |

**Aturan:** reviewer yang ingin mengubah **desain** harus mengusulkan perubahan **dokumen** lebih dulu, bukan meminta kode diubah sesuai selera. Kalau tidak, dokumen berhenti menjadi sumber kebenaran dan menjadi dekorasi.

**Aturan kedua:** review menyebut tingkat kepentingan — `[blocking]`, `[saran]`, `[pertanyaan]`. Tanpa ini, semua komentar terasa wajib dan PR menggantung berhari-hari.

---

## 9. Dari kontributor luar menjadi maintainer

| Tahap | Syarat | Hak |
| :--- | :--- | :--- |
| **Kontributor** | ≥ 1 PR diterima | — |
| **Kontributor berulang** | ≥ 5 PR bermutu dalam 3 bulan | Boleh men-triage issue |
| **Maintainer** | Dinominasikan maintainer yang ada; ≥ 10 PR bermutu; paham dokumen desain; setuju aturan §8 | Merge (dengan approval kedua), men-triage, ikut mengambil keputusan rilis |

**Aturan bus factor (`decisions-r0.md` D-02):** setiap area kritis (`authz`, migrasi, media, importer) **wajib** punya minimal **dua** orang yang pernah menangani PR di sana. Area dengan satu orang = risiko proyek, dan itu dicatat, bukan dibiarkan.

---

## 10. Kapan proyek ini dianggap "berhasil" (dinyatakan terbuka)

Bukan pertanyaan teknis, tapi menentukan prioritas:

| Ukuran | Ambang | Kenapa ini yang dipakai |
| :--- | :--- | :--- |
| Instalasi aktif (≥ 1 task/minggu selama 4 minggu) | **25** dalam 90 hari setelah T3 | Bukan unduhan, bukan bintang — instalasi yang dipakai |
| Pilot yang bertahan | **≥ 3 dari 5** setelah 60 hari | `decisions-r0.md` D-04 |
| Kontributor luar yang PR-nya diterima | ≥ 5 dalam 12 bulan | Menandai proyek bukan satu orang |
| Waktu upgrade antar rilis (dilaporkan) | < 15 menit p50 | Menandai `migrations.md` bekerja |

**Aturan jujur:** bila 25 instalasi tidak tercapai dalam 90 hari, reaksi yang benar **bukan** menambah fitur, tapi **mewawancarai 5 pengguna yang berhenti**. Dokumen ini dicatat sebagai pengingat agar keputusan itu tidak diambil berdasarkan emosi.

---

## 11. Rujukan silang

- Gate rilis & SLO: `testing-strategy.md` §8, `prd.md` §7
- Migrasi & larangan downgrade: `migrations.md` §9
- Deprecation API: `api-contract.md` §11.3
- Lisensi & DCO: `architecture.md` ADR-014
- Definisi "selesai" per PR: `repo-layout.md` §7
- Peran & bus factor: `decisions-r0.md` D-02
- Ukuran keberhasilan GTM: `decisions-r0.md` D-04
- Batas diketahui dalam rilis: `support.md` §6

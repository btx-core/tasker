# Spesifikasi Real-time & Pencarian (C7, C8)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat. Menutup celah **C7** dan **C8** di `gaps-analysis.md`.

ADR-006 menetapkan **mekanisme** real-time (delta ber-`seq`, resync eksplisit) dan ADR-005/019 menetapkan **mesin** pencarian. Dokumen ini menetapkan **perilaku**: apa yang disiarkan, apa yang dicari, dan apa yang terjadi di tepi kasusnya. Tanpa ini, setiap fitur akan menemukan sendiri jawabannya — dan hasilnya tidak konsisten.

---

## Bagian I — Real-time (C7)

## 1. Klasifikasi objek: tiga perilaku, bukan satu

Tidak semua perubahan layak disiarkan dengan cara yang sama. Membagi objek ke tiga kelas ini mencegah dua kegagalan umum: (a) menyiarkan terlalu banyak sehingga fan-out meledak, (b) tidak menyiarkan perubahan struktur sehingga UI menampilkan status yang sudah tidak ada.

| Kelas | Objek | Perilaku | Alasan |
| :--- | :--- | :--- | :--- |
| **K1 — Konten (sering berubah, per entitas)** | `task`, `comment`, `checklist_item` | Delta per entitas dengan patch minimal + `version` | Ini 90% trafik. Harus paling murah. |
| **K2 — Struktur (jarang berubah, memengaruhi banyak tampilan)** | `status`, `label`, `team`, `team_members`, `goal`, `cycle` | Delta berisi **entitas penuh** (bukan patch), karena kecil dan klien perlu konsistensi penuh | Perubahan status menghapus/menambah kolom di board semua orang |
| **K3 — Tidak disiarkan (tarik saat dibutuhkan)** | `audit_event`, `email_message`, `job`, `import`, `saved_view` (kecuali dibagikan), `notification` (lihat §4) | Tidak ada delta | Tidak ada UI yang bergantung pada kesegaran sepersekian detik; menyiarkannya hanya membebani |
| **Presence (ephemeral)** | "sedang dilihat oleh", "sedang mengetik" | Tidak durable, tidak lewat `changes` | Boleh hilang tanpa kerusakan (ADR-006 butir 5) |

**Aturan pengikat:** objek baru **wajib** diklasifikasikan ke K1/K2/K3 saat ditambahkan. Objek tanpa klasifikasi = tidak disiarkan (default aman), dan itu dicatat di PR.

---

## 2. Matriks penyiaran (perubahan → penerima)

| Perubahan | Disiarkan? | Penerima | Isi delta |
| :--- | :--- | :--- | :--- |
| Task dibuat | K1 | Langganan tim itu | Ringkasan task + `version` |
| Task diubah (field material) | K1 | Langganan tim itu | Patch field yang berubah |
| Deskripsi/komentar diubah | K1 | Langganan tim itu | **Sinyal** `field_changed` + hash (bukan isi, ADR-017) |
| Task dihapus/dipulihkan | K1 | Langganan tim itu | `op: delete`/`upsert` + `version` |
| Komentar dibuat | K1 | Langganan tim itu + penulis mention | Ringkasan komentar |
| Checklist item dicentang | K1 | Langganan tim itu | Item + `checklist_progress` |
| Status ditambah/diubah/diarsipkan | **K2** | Langganan tim itu | **Status penuh** + posisi |
| Toggle fitur tim diubah | **K2** | Langganan tim itu | `team` penuh (termasuk `features`) |
| Anggota tim ditambah/dicabut | **K2** | Langganan tim itu | `team_member` + peran; **pencabutan juga memutus langganan** (TC-15) |
| Label diubah | K2 | Langganan tim itu | Label penuh |
| Goal/cycle diubah (R1) | K2 | Langganan tim yang terkait | Entitas penuh |
| Pengaturan workspace | K2 | Semua langganan workspace | Hanya field yang terlihat pengguna |
| Audit log, email, job | **Tidak** | — | K3 |
| Presence | Ephemeral | Langganan tim | Tidak durable |

**Subscribe:** klien berlangganan **per tim** (bukan per task) pada R0–R1. Alasan: satu koneksi per tab, dan jumlah tim per pengguna kecil (≤ 40 di dataset acuan). Langganan per task akan menggandakan kompleksitas server tanpa manfaat terukur.

**Batas:** maksimum **5 langganan tim per koneksi** (`prd.md` §7.4). Melebihi → klien menerima `resync_required` untuk tim yang tidak dilanggani (bukan diam-diam tidak menerima apa pun).

---

## 3. Tepi kasus yang wajib didefinisikan

Ini bagian yang membuat real-time terasa "kokoh" atau "aneh" bagi pengguna.

| Situasi | Perilaku yang ditetapkan | Alasan |
| :--- | :--- | :--- |
| **Status dihapus/diarsipkan sementara board terbuka** | Kirim K2 → klien memindahkan kartu ke status default + banner sekali: "Status *Review* diarsipkan; 12 tugas dipindahkan ke *Siap*." Bukan diam-diam. | Tanpa ini, kartu menghilang dari board dan pengguna mengira data hilang |
| **Anggota dicabut saat sedang melihat board** | Koneksi langganan tim itu diputus < 5 s; klien menerima `revoked` → pindah ke layar "akses dicabut" + cache tim itu dibersihkan | `rbac.md` R4, T2 |
| **Pengguna mengubah sesuatu yang sedang diedit orang lain** | Bukan urusan real-time; ditangani `409 conflict.version` saat menyimpan (`editor-decision.md` §3.3) | Real-time tidak boleh mengubah teks di tengah pengetikan |
| **Delta diterima saat pengguna punya perubahan belum tersimpan pada entitas yang sama** | Patch **tidak** diterapkan pada field yang sedang diedit (field "terkunci lokal"); field lain tetap diterapkan. Ditampilkan penanda kecil "ada perubahan dari orang lain" | Mencegah teks pengguna tertimpa di tengah menulis |
| **Koneksi lambat / delta menumpuk** | Klien menerapkan maksimum 50 delta per frame; sisanya lewat `rAF` berikutnya | Mencegah UI membeku saat reconnect storm |
| **Klien tertinggal > 24 jam** | `resync_required` → muat ulang lewat REST (`api-contract.md` §10.3) | Tidak ada tebakan |
| **Dua tab pada perangkat sama** | Kedua tab berlangganan sendiri; tidak ada sinkronisasi lintas-tab | Disengaja (ADR-001); delta dari server sampai ke keduanya |
| **Timezone/locale berbeda antar klien** | Delta selalu UTC+data mentah; format dilakukan klien | Mencegah "waktu berbeda" antar pengguna |
| **Objek K2 berubah saat bootstrap** | Bootstrap mengembalikan `seq` setelah snapshot; delta sejak `seq` itu dikirim. Bila ada yang terlewat, `resync_required` | Mencegah celah antara snapshot dan langganan |

---

## 4. Notifikasi vs real-time (dua hal berbeda)

Kesalahan umum: menganggap notifikasi = real-time.

| | Real-time (K1/K2) | Notifikasi (`FR-206`) |
| :--- | :--- | :--- |
| Tujuan | Data tampilan tetap benar | Memberi tahu **saya** secara pribadi |
| Penerima | Semua yang berhak melihat tim | Hanya penerima yang relevan |
| Durabilitas | Boleh hilang (dipulihkan `resync`) | Wajib durable (`notifications`) |
| Transport | WebSocket | Tabel + delta ke pemiliknya (per-user, bukan per-tim) |

**Aturan:** notifikasi **tidak** disiarkan ke langganan tim. Ia dikirim ke kanal per-pengguna yang terautentikasi, agar tidak ada kebocoran (jumlah penugasan orang lain bukan urusan Anda).

---

## 5. Uji real-time (melengkapi `T-RT`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| **T-RT8** | Arsipkan status saat 20 klien membuka board: semua klien memindahkan kartu ke status default **dan** menampilkan banner | §3 |
| **T-RT9** | Cabut anggota tim saat ia terhubung: koneksi tim itu diputus < 5 s, cache dibersihkan, akses HTTP berikutnya 404 | §3, TC-15 |
| **T-RT10** | 200 delta dalam 1 detik: klien tidak membeku, maksimum 50 per frame, hasil akhir benar | §3 |
| **T-RT11** | Pengguna sedang mengedit judul; orang lain mengubah judul → field terkunci lokal tetap, penanda muncul, tidak ada teks tertimpa | §3 |
| **T-RT12** | Setiap objek baru wajib punya klasifikasi K1/K2/K3 (pemeriksaan daftar objek tersiarkan) | §1 |

---

## Bagian II — Pencarian (C8)

## 6. Apa yang dicari, dan dengan bobot apa

| Sumber | Untuk task | Untuk orang | Untuk tim/goal | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| Judul | **A** | — | **A** | Jalur tercepat (trigram prefix + FTS) |
| Nomor (`ENG-123`) | **A+** | — | — | Pencarian nomor harus **eksak dan instan**; ini yang paling sering dipakai |
| Deskripsi | B | — | B | FTS |
| Komentar | B | — | — | FTS; hasil menampilkan cuplikan komentar |
| Nama orang | — | **A** | — | Untuk filter assignee |
| Nama tim / goal | C | — | **A** | |

Bobot A/B/C dipakai untuk pengurutan; nilai numeriknya adalah keputusan implementasi (bukan kontrak), tetapi **urutannya mengikat**: nomor task > judul > nama orang > deskripsi > komentar > tim/goal.

**Batasan yang mengikat:** pencarian **selalu** ter-scope ke `workspace_id` (dan `team_id` bila diberikan). Pencarian global lintas tenant tidak ada (ADR-019, `INV-12`).

---

## 7. Perilaku query (yang harus bisa ditebak pengguna)

| Query | Perilaku |
| :--- | :--- |
| `ENG-123`, `eng-123`, `ENG123` | Langsung membuka task itu (jalur cepat, tanpa FTS) |
| Kosong | **Tidak** mengembalikan semua; menampilkan "terakhir dibuka" + pintasan (bukan daftar seluruh task) |
| 1 karakter | Tidak mencari (minimum 2 karakter) — dengan pesan "ketik minimal 2 karakter" |
| > 64 karakter | Dipotong, tidak ditolak |
| Karakter khusus (`"`, `&`, `<`) | Dilindungi (tidak pernah 500); diperlakukan sebagai teks |
| Hanya stopword (`dan`, `yang`) | Hasil kosong dengan pesan "kata umum diabaikan" |
| Salah ketik 1–2 huruf | Tetap menemukan judul (trigram) — untuk task, bukan untuk komentar |
| Digit (`2026`) | Dicocokkan pada nomor & tanggal bila relevan |
| `@nama` | Filter assignee, bukan pencarian teks |

**Aturan yang mengikat:** query yang tidak menghasilkan apa pun **wajib** menampilkan empty state pencarian (`onboarding.md` §4), bukan layar kosong.

---

## 8. Interaksi pencarian dengan toggle & izin

Ini bagian yang paling mudah salah, dan salahnya berbahaya.

| Situasi | Perilaku |
| :--- | :--- |
| Fitur `cycles`/`effort` dimatikan untuk tim | Hasil pencarian **mengabaikan** field yang dimatikan untuk **filter**, tetapi field itu tetap dapat ditemukan sebagai teks. Contoh: mencari "3" tidak memfilter effort, tetapi task dengan judul "3 bug" tetap muncul. |
| Task terhapus (soft delete) | **Tidak muncul**, kecuali pemanggil punya izin melihat yang terhapus dan mengaktifkannya eksplisit (`include_deleted`). |
| Task di tim yang bukan haknya | Tidak pernah muncul — bahkan sebagai hitungan (`T-A1`). |
| Guest | Hanya mencari di dalam grant-nya; hasil tidak menyebut keberadaan tim lain. |
| Filter tersimpan (R1) | Disimpan sebagai struktur tervalidasi (`api-contract.md` §8.2), **bukan** string pencarian bebas. |

**Aturan:** hasil pencarian **tidak boleh** membocorkan keberadaan objek. Jumlah hasil untuk scope yang tidak boleh dilihat = 404 (bukan `[]`), konsisten `api-contract.md` §5.5.

---

## 9. Command palette: bukan hanya pencarian

`Ctrl+K` adalah **satu-satunya** jalur cepat, jadi perilakunya ditetapkan:

| Urutan hasil | Kategori | Contoh |
| :--- | :--- | :--- |
| 1 | **Aksi pada konteks saat ini** | "Pindahkan ke Selesai", "Tugaskan ke saya" (untuk task yang sedang dibuka) |
| 2 | Navigasi | Tim: Engineering, Kotak masuk, Tugas saya |
| 3 | Buat | "Buat tugas: <teks yang diketik>" (selalu tersedia) |
| 4 | Task yang cocok | Maks 8, dengan nomor + status |

**Aturan:**
- Tekan `Enter` pada "Buat tugas" menghasilkan task **tanpa** membuka form penuh (`FR-106`: judul + status default).
- Palette **tidak** menjalankan aksi merusak tanpa konfirmasi (hapus, cabut akses).
- Palette tidak memuat aksi yang tidak diizinkan pengguna (bukan ditampilkan lalu gagal) — **kecuali** untuk kasus di mana tampil-nonaktif lebih informatif; itu diatur `api-contract.md` §5.4.
- Hasil task diambil dari pencarian yang sama (`NFR-006`), bukan jalur khusus — agar tidak ada dua perilaku pencarian.

---

## 10. Uji pencarian

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| **T-SEARCH1** | `ENG-123` (dan varian) langsung membuka task, < 50 ms | §7 |
| **T-SEARCH2** | Query kosong, 1 karakter, hanya stopword, karakter khusus → tidak error, pesan sesuai | §7 |
| **T-SEARCH3** | Salah ketik 2 huruf pada judul tetap menemukan | §6 |
| **T-SEARCH4** | Hasil tidak pernah memuat task dari tim yang bukan haknya, dan tidak membocorkan jumlahnya | §8, T-A1 |
| **T-SEARCH5** | Task terhapus tidak muncul kecuali diminta eksplisit dengan izin | §8 |
| **T-SEARCH6** | Urutan hasil mengikuti bobot (nomor > judul > orang > deskripsi > komentar) pada fixture tetap | §6 |
| **T-SEARCH7** | Palette menampilkan aksi konteks lebih dulu; `Enter` pada "Buat tugas" berhasil tanpa form | §9 |
| **T-SEARCH8** | Pencarian pada 500k task memenuhi `NFR-006` untuk istilah selektif; istilah umum dicatat terhadap `NFR-006a` | ADR-019 |

---

## 11. Rujukan silang

| Klaim | Dokumen |
| :--- | :--- |
| Mekanisme delta & `seq` | `architecture.md` ADR-006 |
| Batas payload delta/NOTIFY | `architecture.md` ADR-017 |
| Mesin pencarian & batasnya | `architecture.md` ADR-005, ADR-019 |
| Isolasi tenant pada pencarian | `architecture.md` ADR-012, `INV-12`, `T-A1` |
| Pencabutan akses saat aktif | `rbac.md` R4, TC-15 |
| Editor & penerapan delta saat mengetik | `editor-decision.md` §3.3 |
| Empty state pencarian | `onboarding.md` §4 |
| Kontrak endpoint `/search` & `/sync` | `api-contract.md` §8.3, §10.3 |

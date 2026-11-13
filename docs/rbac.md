# Otorisasi: Katalog Aksi, Peran, Matriks, dan Kasus Uji

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Mengikat:** implementasi middleware mengikuti dokumen ini apa adanya. Aksi yang tidak ada di §2 **ditolak** (ADR-003 butir 3).

Dokumen ini dibuat karena dua kegagalan paling umum pada produk sejenis:
1. **Definisi peran yang berubah-ubah** — v0 punya dua daftar peran yang berbeda (`Admin/Member/Commenter/Viewer` vs `Workspace Admin/Team Admin/Member/Guest`), yang tidak bisa diimplementasikan tanpa menebak.
2. **Otorisasi yang tersebar** — `if` izin yang ditulis ulang di setiap endpoint. Hasilnya: satu endpoint baru lupa dicek, dan data bocor.

---

## 1. Struktur Peran

Dua tingkat, eksplisit. Tidak ada pewarisan implisit di luar tabel §3.1 dan §3.2.

### 1.1 Peran workspace (`workspace_members.role`)

| Nilai | Nama | Arti |
| :---: | :--- | :--- |
| 1 | `owner` | Pemilik. Bisa melakukan semua aksi workspace, termasuk menghapus workspace dan memindahkan kepemilikan. Minimal satu per workspace (INV-01). |
| 2 | `admin` | Administrator. Semua aksi administratif kecuali hapus workspace dan ubah owner. |
| 3 | `member` | Anggota biasa. Hanya aksi yang berasal dari keanggotaan tim. |

### 1.2 Peran tim (`team_members.role`)

| Nilai | Nama | Arti |
| :---: | :--- | :--- |
| 1 | `team_admin` | Mengelola tim: pengaturan, status, label, anggota tim, template. Bisa mengedit semua task tim. |
| 2 | `member` | Bekerja: membuat & mengedit task, komentar, lampiran, checklist. |
| 3 | `commenter` | Hanya membaca dan berkomentar. Tidak bisa mengubah task. |
| 4 | `viewer` | Hanya membaca. Tidak bisa berkomentar. |
| 5 | `guest` *(R2, `guest_grants`)* | **Bukan anggota tim.** Hanya objek yang secara eksplisit diberikan (`guest_grants.scope`). |

### 1.3 Aturan yang mengikat peran

**R1 — Admin workspace bukan anggota tim secara otomatis.**
Admin workspace tidak otomatis mendapat hak *konten* (ubah task, komentar) di tim yang bukan keanggotaannya. Ia mendapat hak *manajemen* (lihat daftar tim, kelola anggota tim, arsipkan tim). Untuk kasus dukungan nyata, tersedia **mode dukungan** (R2): admin workspace dapat melakukan aksi konten, tetapi setiap aksi ditulis ke `audit_events` dengan sufiks `.via_workspace_admin` dan terlihat oleh admin tim. Tanpa mode ini, perubahan admin tidak terbedakan dari perubahan anggota biasa — sumber sengketa yang mahal.

**R2 — `owner` mencakup semua hak `admin`.**
Kecuali dinyatakan lain, tabel di §3 sudah mencerminkan ini (kolom Owner mengisi semua yang bisa dilakukan Admin).

**R3 — Hak tim tidak pernah lebih besar dari peran workspace yang mendasarinya.**
`member` workspace tidak bisa menjadi `team_admin` di tim mana pun tanpa keanggotaan tim; sebaliknya, keanggotaan tim **tidak** memberi hak administratif workspace. Contoh tegas: `team_admin` **tidak** bisa mengundang user baru ke workspace (itu `AC-04`).

**R4 — Mencabut akses berlaku segera, termasuk pada sesi real-time yang sedang terbuka.**
Pencabutan `team_members` atau `workspace_members` harus (a) memutus langganan real-time tim tersebut dalam < 5 detik, (b) menghapus entitas terkait dari cache klien pada delta berikutnya. Ini bukan optimasi; ini bagian dari SLO keamanan dan diuji di TC-15.

**R5 — Deny by default.** Aksi tanpa entri matriks = ditolak untuk semua peran, termasuk owner. Aksi baru wajib ditambahkan lebih dulu ke §2 dan §3.

**R6 — Isolasi tenant berbeda dari izin.** `can()` menjawab "apakah peran ini boleh melakukan aksi ini pada objek ini". Ia **wajib** dipanggil setelah objek dimuat dengan filter `workspace_id` (ADR-012, INV-12). Izinkan-tapi-salah-tenant adalah kebocoran, bukan eskalasi.

---

## 2. Katalog Aksi

Kolom **Lingkup**: `W` = workspace, `T` = tim, `O` = objek (task/komentar dll). Kolom **Audit**: apakah aksi wajib menulis `audit_events` (YA) atau cukup `task_events` bila menyentuh task (TE) atau tidak diaudit (—).

### 2.1 Workspace

| ID | Aksi | Lingkup | Audit | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| AC-01 | `workspace.view` | W | — | Melihat nama/anggota/daftar tim. |
| AC-02 | `workspace.update` | W | YA | Ubah nama, slug, pengaturan umum. |
| AC-03 | `workspace.delete` | W | YA | Grace 30 hari, konfirmasi ketik nama. |
| AC-04 | `workspace.member.invite` | W | YA | |
| AC-05 | `workspace.member.remove` | W | YA | Ikut mencabut semua keanggotaan tim (INV-02). |
| AC-06 | `workspace.member.role_change` | W | YA | Termasuk pemindahan kepemilikan. |
| AC-07 | `workspace.team.create` | W | YA | |
| AC-08 | `workspace.team.archive` | W | YA | Tim, bukan workspace. |
| AC-09 | `workspace.audit.view` | W | YA | Melihat audit log **itu sendiri** diaudit. |
| AC-10 | `workspace.export` | W | YA | Ekspor penuh (FR-114). |
| AC-11 | `workspace.token.manage` | W | YA | Membuat/mencabut token API. |
| AC-12 | `workspace.sso.manage` | W | YA | R2. |
| AC-13 | `workspace.scim.manage` | W | YA | R2. |
| AC-14 | `workspace.guest.grant` | W | YA | R2. |
| AC-15 | `workspace.support_mode.enter` | W | YA | R2; memberi hak konten sementara (R1 di §1.3) dengan alasan wajib. |

### 2.2 Tim

| ID | Aksi | Lingkup | Audit | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| AC-20 | `team.view` | T | — | Melihat board/list/task. |
| AC-21 | `team.update` | T | YA | Nama, toggle fitur, skala effort. |
| AC-22 | `team.archive` | T | YA | |
| AC-23 | `team.member.manage` | T | YA | Tambah/ubah peran/cabut anggota tim. |
| AC-24 | `team.status.manage` | T | YA | Buat/ubah/arsipkan status (dalam 5 kategori tetap). |
| AC-25 | `team.label.manage` | T | YA | |
| AC-26 | `team.template.create_from` | T | YA | Menyimpan tim sebagai template. |
| AC-27 | `task.view` | O | — | |
| AC-28 | `task.create` | T | TE | |
| AC-29 | `task.update` | O | TE | Patch field non-sensitif (judul, deskripsi, prioritas, due date, effort). |
| AC-30 | `task.update.status` | O | TE | Termasuk drag di board. |
| AC-31 | `task.assign` | O | TE | Mengubah assignee ke orang lain. |
| AC-32 | `task.delete` | O | TE | Soft delete. |
| AC-33 | `task.restore` | O | TE | Dalam 30 hari. |
| AC-34 | `task.move_team` | — | — | **Tidak ada aksinya.** FR-113 melarang; tidak boleh ada aksi yang mengizinkannya. |
| AC-35 | `comment.create` | O | — | |
| AC-36 | `comment.update.own` | O | TE | Hanya penulis, dalam 15 menit, atau kapan saja bila `edited_at` ditampilkan. |
| AC-37 | `comment.update.any` | O | TE | Moderasi oleh team_admin/workspace admin. |
| AC-38 | `comment.delete` | O | TE | Soft delete, placeholder dipertahankan. |
| AC-39 | `attachment.upload` | O | — | |
| AC-40 | `attachment.delete` | O | TE | |
| AC-41 | `checklist.manage` | O | TE | Tambah/ubah/centang/hapus item. |
| AC-42 | `task.label.assign` | O | TE | |
| AC-43 | `task.dependency.manage` | O | TE | R1. |
| AC-44 | `goal.create` | W | TE | R1; lintas tim, jadi di tingkat workspace. |
| AC-45 | `goal.update` | O | TE | R1; diatur lewat `owner_team` atau admin workspace. |
| AC-46 | `cycle.manage` | T | TE | R1; mulai/tutup/atur jadwal. |
| AC-47 | `cycle.task.move` | O | TE | R1; memindahkan task antar cycle. |
| AC-48 | `view.create` | T | — | R1; `view.share` terpisah di R1. |
| AC-49 | `notification.read` | O | — | Hanya notifikasi milik sendiri; bahkan owner tidak bisa menandai milik orang lain. |
| AC-50 | `realtime.subscribe.team` | T | — | Diperiksa **saat berlangganan dan saat fan-out** (T3). |
| AC-51 | `webhook.manage` | W | YA | R1. |
| AC-52 | `integration.git.manage` | W | YA | R1. |

---

## 3. Matriks Permission

Legenda: **✔** diizinkan · **—** ditolak · **○** hanya pemilik objek · **△** hanya bila `guest_grants` mencakup aksi itu · **✎** hanya via mode dukungan (audited, wajib alasan).

Kolom: `OWN` = owner workspace, `ADM` = admin workspace, `MEM` = member workspace, `TA` = team_admin, `TM` = team member, `TC` = commenter, `TV` = viewer, `GST` = guest.

### 3.1 Aksi workspace

| Aksi | OWN | ADM | MEM | TA | TM | TC | TV | GST |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| AC-01 `workspace.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| AC-02 `workspace.update` | ✔ | ✔ | — | — | — | — | — | — |
| AC-03 `workspace.delete` | ✔ | — | — | — | — | — | — | — |
| AC-04 `member.invite` | ✔ | ✔ | — | — | — | — | — | — |
| AC-05 `member.remove` | ✔ | ✔ | — | — | — | — | — | — |
| AC-06 `member.role_change` | ✔ | ✔ | — | — | — | — | — | — |
| AC-07 `team.create` | ✔ | ✔ | — | — | — | — | — | — |
| AC-08 `team.archive` | ✔ | ✔ | — | — | — | — | — | — |
| AC-09 `audit.view` | ✔ | ✔ | — | — | — | — | — | — |
| AC-10 `export` | ✔ | ✔ | — | — | — | — | — | — |
| AC-11 `token.manage` | ✔ | ✔ | ○ | ○ | ○ | — | — | — |
| AC-12 `sso.manage` | ✔ | ✔ | — | — | — | — | — | — |
| AC-13 `scim.manage` | ✔ | ✔ | — | — | — | — | — | — |
| AC-14 `guest.grant` | ✔ | ✔ | — | — | — | — | — | — |
| AC-15 `support_mode.enter` | ✔ | ✔ | — | — | — | — | — | — |

**Catatan AC-03:** hanya `owner`. Admin yang ingin menghapus workspace harus dipromosikan dulu — dan promosi itu diaudit. Ini mencegah satu admin menghapus tenant perusahaan.

**Catatan AC-11:** member boleh mengelola **token miliknya sendiri** (○), tidak pernah token orang lain dan tidak pernah lebih dari haknya (T4).

### 3.2 Aksi tim

| Aksi | OWN | ADM | MEM | TA | TM | TC | TV | GST |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| AC-20 `team.view` | ✔ | ✔ | — | ✔ | ✔ | ✔ | ✔ | △ |
| AC-21 `team.update` | ✔ | ✔ | — | ✔ | — | — | — | — |
| AC-22 `team.archive` | ✔ | ✔ | — | — | — | — | — | — |
| AC-23 `team.member.manage` | ✔ | ✔ | — | ✔ | — | — | — | — |
| AC-24 `status.manage` | ✔ | ✔ | — | ✔ | — | — | — | — |
| AC-25 `label.manage` | ✔ | ✔ | — | ✔ | — | — | — | — |
| AC-26 `template.create_from` | ✔ | ✔ | — | ✔ | — | — | — | — |
| AC-27 `task.view` | ✔ | ✎ | — | ✔ | ✔ | ✔ | ✔ | △ |
| AC-28 `task.create` | ✔ | ✎ | — | ✔ | ✔ | — | — | — |
| AC-29 `task.update` | ✔ | ✎ | — | ✔ | ✔ | — | — | — |
| AC-30 `task.update.status` | ✔ | ✎ | — | ✔ | ✔ | — | — | — |
| AC-31 `task.assign` | ✔ | ✎ | — | ✔ | ✔ | — | — | — |
| AC-32 `task.delete` | ✔ | ✎ | — | ✔ | ○ | — | — | — |
| AC-33 `task.restore` | ✔ | ✎ | — | ✔ | — | — | — | — |
| AC-35 `comment.create` | ✔ | ✎ | — | ✔ | ✔ | ✔ | — | △ |
| AC-36 `comment.update.own` | ✔ | ✎ | — | ✔ | ✔ | ✔ | — | △ |
| AC-37 `comment.update.any` | ✔ | ✎ | — | ✔ | — | — | — | — |
| AC-38 `comment.delete` | ✔ | ✎ | — | ✔ | ○ | ○ | — | — |
| AC-39 `attachment.upload` | ✔ | ✎ | — | ✔ | ✔ | ✔ | — | △ |
| AC-40 `attachment.delete` | ✔ | ✎ | — | ✔ | ○ | ○ | — | — |
| AC-41 `checklist.manage` | ✔ | ✎ | — | ✔ | ✔ | — | — | — |
| AC-42 `task.label.assign` | ✔ | ✎ | — | ✔ | ✔ | — | — | — |
| AC-43 `dependency.manage` | ✔ | ✎ | — | ✔ | ✔ | — | — | — |
| AC-44 `goal.create` | ✔ | ✔ | — | ✔ | — | — | — | — |
| AC-45 `goal.update` | ✔ | ✔ | — | ○ | — | — | — | — |
| AC-46 `cycle.manage` | ✔ | ✔ | — | ✔ | — | — | — | — |
| AC-47 `cycle.task.move` | ✔ | ✎ | — | ✔ | ✔ | — | — | — |
| AC-48 `view.create` | ✔ | ✎ | — | ✔ | ✔ | ✔ | ✔ | — |
| AC-49 `notification.read` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| AC-50 `realtime.subscribe.team` | ✔ | ✎ | — | ✔ | ✔ | ✔ | ✔ | △ |
| AC-51 `webhook.manage` | ✔ | ✔ | — | — | — | — | — | — |
| AC-52 `integration.git.manage` | ✔ | ✔ | — | — | — | — | — | — |

**Hal yang sengaja tidak boleh:**

- `team_admin` tidak bisa `AC-23` menaikkan dirinya menjadi admin workspace (itu `AC-06`). Tidak ada jalur eskalasi dari tim ke workspace.
- `commenter` tidak bisa mengubah task apa pun (termasuk status) — inilah perannya.
- `viewer` tidak bisa berkomentar; `commenter` tidak bisa membuat task. Perbedaan ini harus terlihat di UI (tombol nonaktif dengan alasan), bukan hanya 403.
- `guest` tidak bisa melihat `AC-01` (workspace view) maupun daftar tim: guest hanya melihat objek yang dibagikan. Karena itu `AC-20` = △, bukan ✔.
- `member` workspace tanpa keanggotaan tim **tidak bisa** melihat task tim tersebut (`AC-27` = —). Workspace yang transparan untuk semua anggota adalah pilihan sah, tetapi itu keputusan produk lain (dan bertentangan dengan P4/enterprise), jadi **bukan default**.

### 3.3 Aturan pewarisan (yang boleh disederhanakan implementasinya)

Implementasi `can()` boleh memakai urutan peringkat, asalkan hasil akhirnya identik dengan tabel:

- Untuk aksi bertingkat tim: `OWN` dan `ADM` diperlakukan sebagai `TA` **hanya untuk aksi manajemen** (AC-21…AC-26, AC-44…AC-46, AC-51, AC-52). Untuk aksi konten (AC-27…AC-43), `OWN`/`ADM` masuk lewat **✎ mode dukungan**, bukan langsung.
- `TA` ⊃ `TM` ⊃ `TC` ⊃ `TV` untuk aksi baca/komentar; `TA` ⊃ `TM` untuk aksi konten.
- `○` tidak bisa diturunkan dari peringkat; ia butuh pemeriksaan kepemilikan objek eksplisit.

---

## 4. Mengapa "Commenter" dan "Viewer" Dipertahankan

Ini dua peran yang sering dianggap remeh lalu dihapus, dan akibatnya pelanggan membuat akun "penipu" (satu akun dipakai bersama) atau memberi hak edit kepada pihak yang seharusnya hanya membaca.

- **Commenter** dipakai untuk: QA yang melaporkan temuan tanpa mengubah status, tim legal yang memberi catatan, klien yang boleh menanggapi.
- **Viewer** dipakai untuk: eksekutif, auditor, dan calon klien yang hanya melihat papan.

Keduanya juga **mengurangi permukaan ancaman** (T8): viewer tidak bisa memicu notifikasi massal.

---

## 5. Aksi yang Wajib Diaudit

Semua aksi dengan kolom Audit = YA pada §2. Tambahan:

| Kejadian | Ditulis ke | Alasan |
| :--- | :--- | :--- |
| Login berhasil/gagal, logout global, reset password | `audit_events` (workspace_id bisa null) | Investigasi insiden |
| Token API dibuat/dicabut/dipakai pertama kali | `audit_events` | T4 |
| Ekspor dibuat & diunduh | `audit_events` | T5 |
| Impor dijalankan (sumber, jumlah item, jumlah gagal) | `audit_events` | T5, ADR-013 |
| Mode dukungan dimasuki/ditinggalkan | `audit_events` | §1.3 R1 |
| Perubahan toggle fitur tim | `audit_events` | Menjelaskan "data saya hilang" (T9) |
| Akses ditolak (403) yang berulang ≥ 5×/menit oleh user yang sama | `audit_events` | Deteksi penyelidikan IDOR (T1, T10) |

**Aturan isi audit:** tidak boleh memuat isi komentar/deskripsi, token, password, atau data pribadi melebihi ID. Metadata dibatasi pada nilai sebelum/sesudah untuk field administratif.

---

## 6. Kasus Uji Otorisasi (wajib ada di CI)

Tidak cukup "sudah dicek di kode". Setiap kasus di bawah harus berupa test otomatis.

### 6.1 Kasus dasar

| ID | Skenario | Hasil yang diharapkan |
| :--- | :--- | :--- |
| **TC-01** | `viewer` mencoba mengubah status task lewat API | 403; tidak ada `task_events` tertulis; UI menampilkan tombol nonaktif dengan alasan |
| **TC-02** | `commenter` mencoba membuat task | 403; tidak ada task dibuat |
| **TC-03** | `member` tim mencoba mengubah pengaturan tim (toggle) | 403; `team.version` tidak berubah |
| **TC-04** | `member` mencoba menghapus task milik orang lain | 403 (AC-32 = ○ hanya untuk task sendiri) |
| **TC-05** | `team_admin` tim A mencoba mengubah status, label, anggota tim B | 403 untuk semua; tidak ada kebocoran nama anggota tim B |
| **TC-06** | `admin` workspace mencoba mengubah task di tim yang bukan keanggotaannya (tanpa mode dukungan) | 403; dengan mode dukungan: 200 **dan** `audit_events` memuat sufiks `.via_workspace_admin` + alasan |
| **TC-07** | `member` workspace mencoba `workspace.member.invite` | 403 |
| **TC-08** | `admin` mencoba `workspace.delete` | 403 (hanya owner) |
| **TC-09** | `owner` mencoba menandai notifikasi milik user lain sebagai dibaca | 403 (AC-49 = ○) |
| **TC-10** | `guest` mencoba `task.view` pada tim yang tidak diberikan | 403 **dan** respons tidak membocorkan keberadaan tim (404, bukan 403, untuk menghindari enumerasi) |
| **TC-11** | `guest` dengan grant `can_comment=false` mencoba berkomentar | 403 |
| **TC-12** | User tanpa keanggotaan apa pun mencoba `AC-01` di workspace | 403/404 sesuai kebijakan anti-enumerasi |

### 6.2 Kasus keamanan (dipetakan ke model ancaman `architecture.md` §5)

| ID | Skenario | Hasil yang diharapkan | Ancaman |
| :--- | :--- | :--- | :--- |
| **TC-13** | Setiap aksi Audit=YA dijalankan, lalu `audit_events` diperiksa | Semua aksi menghasilkan tepat satu baris audit dalam transaksi yang sama; bila transaksi gagal, tidak ada baris audit "hantu" | T5 |
| **TC-14** | Untuk **setiap** endpoint, panggil dengan ID objek dari workspace lain | Selalu 404 (bukan 403, bukan 200); tidak ada field objek yang bocor; `INV-12` terpenuhi | T1 |
| **TC-15** | User A login, membuka board tim X, lalu akunnya dicabut dari tim X | Koneksi real-time terputus < 5 detik; cache klien tidak lagi memuat data tim X setelah delta berikutnya; permintaan HTTP berikutnya 403 | T2 |
| **TC-16** | User A logout, user B login di browser/perangkat yang sama | Tidak ada sisa data workspace A di memori yang bisa diakses B; reload penuh tidak menampilkan data A | T2 |
| **TC-17** | Klien mengirim permintaan langganan real-time (`AC-50`) untuk tim yang bukan haknya, atau memalsukan `team_id` pada langganan | Ditolak saat berlangganan; bila langganan sah lalu hak dicabut, tidak ada event tim itu terkirim setelah pencabutan | T3 |
| **TC-18** | User membuat token API dengan scope di luar haknya (mis. `viewer` meminta `task.update`), lalu memakai token itu | Pembuatan ditolak, atau token dibuat dengan scope terpangkas & terlihat oleh pembuat; pemakaian di luar scope → 403; pencabutan token berlaku < 60 s | T4 |
| **TC-19** | Webhook/konfigurasi integrasi diarahkan ke `http://127.0.0.1`, `169.254.169.254`, atau nama host internal | Ditolak saat disimpan **dan** saat dikirim (DNS re-check); tidak ada request keluar; tidak ada redirect diikuti | T6 |
| **TC-20** | Klien meminta lampiran dengan `storage_key` palsu, atau memakai presigned URL setelah kedaluwarsa / untuk objek lain | 403/410; `storage_key` tidak pernah muncul di respons API mana pun (`INV-09`) | T7 |
| **TC-21** | Satu komentar berisi 500 `@mention` | Ditolak atau dipotong pada batas keras dengan pesan jelas; jumlah notifikasi terkirim ≤ batas; tidak ada job yang meledak | T8 |
| **TC-22** | Toggle `cycles`/`effort` dimatikan, lalu dinyalakan lagi | Tidak ada baris data terhapus; nilai lama kembali utuh; API tetap mengembalikan nilai selama toggle mati (`INV-10`) | T9 |
| **TC-23** | Akses objek anak (`checklist_items`, `comments`, `attachments`) lewat ID anak dari task di tim lain, atau anak yang task-nya sudah dihapus | 404; otorisasi selalu lewat induk (`INV-13`); anak dari task terhapus tidak bisa diakses/diubah | T10 |
| **TC-24** | Status/label dari tim lain dipasang pada task (lewat API langsung) | Ditolak oleh trigger DB (`INV-08`), bukan hanya aplikasi | T1 |
| **TC-25** | Pencabutan keanggotaan tim sementara user punya job/ekspor berjalan | Job yang menyentuh data tim itu gagal aman dan tercatat di audit; tidak ada data yang dikirim ke user yang sudah dicabut | T2 |

### 6.3 Aturan untuk kasus uji baru

Setiap endpoint baru **wajib** menambahkan minimal:
1. satu kasus positif untuk peran terendah yang diizinkan,
2. satu kasus negatif untuk peran tepat di bawahnya,
3. partisipasi otomatis di TC-14 (dijalankan oleh harness, bukan manual).

Endpoint yang tidak ikut TC-14 dianggap belum selesai. Ini ditegakkan dengan daftar endpoint yang di-generate dari definisi route, sehingga endpoint baru otomatis masuk.

---

## 7. Rujukan Silang

| Konsep | Dokumen |
| :--- | :--- |
| Struktur otorisasi & deny-by-default | `architecture.md` ADR-003 |
| Isolasi tenant, RLS | `architecture.md` ADR-012 |
| Kolom peran (`role`) | `data-model.md` ENT-03, ENT-05, ENT-30 |
| Aksi audit → tabel | `data-model.md` ENT-16 |
| Model ancaman T1–T10 | `architecture.md` §5 |
| Requirement yang dirujuk | `prd.md` FR-105, FR-107, FR-112, FR-113, FR-114, FR-115, FR-303…FR-306 |

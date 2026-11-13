# Email Keluar: Transport, Deliverability, dan Kegagalan (C4)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat. Menutup celah **C4** di `gaps-analysis.md`.
**Keputusan singkat:** email adalah **jalur sekunder yang boleh mati dengan jujur**. Inbox dalam aplikasi tetap sumber utama (`FR-206`). Tidak ada satu pun alur inti yang **gagal** karena email tidak dikonfigurasi — tetapi operator **selalu diberi tahu** bahwa email mati.

---

## 1. Kenapa ini dianggap berbahaya

Pada pilot T2 (`decisions-r0.md` D-04), pengguna tidak akan melaporkan "fitur email belum selesai". Mereka akan melaporkan **"produknya rusak"** — karena:

| Gejala | Persepsi pengguna | Akar masalah sebenarnya |
| :--- | :--- | :--- |
| Undangan tidak sampai | "Aplikasinya tidak bisa dipakai" | Email masuk spam (SPF/DKIM tidak disetel) |
| Email penugasan tidak datang | "Sistemnya tidak memberi tahu" | SMTP belum dikonfigurasi di instalasi itu |
| Email masuk spam massal | "Produk ini tidak profesional" | `From:` memakai domain yang tidak sah — dan **reputasi domain pelanggan ikut rusak** |
| Notifikasi membanjir | "Sama saja seperti Jira" | Tidak ada batas kirim/digest |

Empat-empatnya masalah **konfigurasi & kebijakan**, bukan fitur. Karena itu dokumen ini mengatur transport, penolakan yang aman, dan cara memberi tahu operator — bukan menambah fitur.

---

## 2. Keputusan desain

### 2.1 Tiga mode transport (dipilih operator, bukan disembunyikan)

| Mode | Konfigurasi | Perilaku aplikasi |
| :--- | :--- | :--- |
| **`none`** (default saat instalasi) | Tidak ada SMTP | Email **tidak dikirim**. Inbox dalam aplikasi tetap berfungsi. Banner permanen di **panel admin** (bukan ke semua pengguna): "Email belum dikonfigurasi — undangan akan tampil sebagai tautan untuk dibagikan manual." |
| **`smtp`** | Host, port, TLS, kredensial, `From` | Kirim lewat SMTP langsung. Wajib lolos **preflight** (§3.1) sebelum diaktifkan. |
| **`relay`** (disarankan) | Kredensial penyedia (SES/Postmark/Mailgun/SMTP2GO dsb., semua lewat SMTP atau API HTTP) | Sama seperti `smtp`, tetapi penyedia menangani DKIM/reputasi. **Rekomendasi tertulis**, bukan keharusan — self-host tanpa internet boleh memakai mode `none`. |

**Aturan pengikat:** aplikasi **tidak pernah** diam-diam mencoba mengirim email ketika mode `none`. Tidak ada percobaan koneksi, tidak ada job email. Alasan: percobaan yang gagal berulang mengotori log dan membuat operator mengira ada bug, padahal hanya belum dikonfigurasi.

### 2.2 Email tidak boleh memblokir alur inti

| Alur | Bila email mati |
| :--- | :--- |
| Undang anggota (`AC-04`) | Anggota tetap dibuat; UI menampilkan **tautan undangan yang bisa disalin** (berlaku 7 hari). Operator membagikannya manual. |
| Reset password | Tautan reset **hanya** lewat email — ini pengecualian sah. Bila email mati, UI menyatakan jelas: "Reset mandiri tidak tersedia; hubungi admin." Admin dapat membuat tautan reset sekali-pakai dari panel admin (teraudit). |
| Verifikasi email (`FR-112`) | Bila email mati, verifikasi **nonaktif** (bukan "menunggu selamanya"), dicatat di panel admin sebagai penurunan keamanan. |
| Penugasan / mention | Hanya notifikasi. Tidak ada yang gagal. |

**Aturan:** fitur yang **bergantung** pada email wajib menyatakan perilakunya saat email mati. Fitur yang hanya "memanfaatkan" email tidak boleh berubah perilaku.

### 2.3 Kebijakan kirim: sedikit, terkumpul, bisa dimatikan

| Kategori | Default | Bisa dimatikan pengguna | Alasan |
| :--- | :--- | :--- | :--- |
| Keamanan (reset, sesi baru, perubahan password, token dibuat) | **Wajib** | ❌ Tidak | Pengguna harus tahu bila akunnya dipakai. Ini bukan preferensi. |
| Undangan | Segera | — | Satu kali, tidak berulang |
| Penugasan ke saya | Segera, **maks 1 email per task per 15 menit** (gabung) | ✅ | Mencegah 40 email saat task dipindah-pindahkan |
| `@mention` | Segera, maks 1 per komentar | ✅ | |
| Perubahan pada task yang saya ikuti | **Digest** (ringkasan per jam, atau harian) | ✅ (pilihan) | Ini yang membuat orang membenci Jira |
| Laporan/insight | Mati | — | Belum ada di R0 |

**Batas keras:** maksimum **6 email per penerima per jam** dan **20 per hari** untuk kategori non-keamanan. Melebihi → digabung menjadi satu digest. Alasan: batas adalah satu-satunya cara menjamin produk ini tidak menjadi sumber spam — dan reputasi domain pelanggan yang menanggung akibatnya.

**Aturan subjek:** subjek memuat kunci task + judul (mis. `[ENG-123] Perbaikan SSO`). **Tidak pernah** memuat isi deskripsi, komentar, atau lampiran. Alasannya privasi: subjek email bisa terbaca di notifikasi layar kunci, dan tidak boleh membocorkan isi pekerjaan. Operator dapat menonaktifkan judul pada subjek (mode "subjek minimal") untuk organisasi yang sensitif.

---

## 3. Deliverability: yang wajib diperiksa, bukan diasumsikan

### 3.1 Preflight (dijalankan sebelum mode diaktifkan, dan bisa diulang dari panel admin)

| Pemeriksaan | Gagal → |
| :--- | :--- |
| Koneksi TCP + STARTTLS/TLS ke host:port | Blokir aktivasi; tampilkan error jaringan yang spesifik |
| Autentikasi SMTP | Blokir |
| `From` memakai domain yang **tidak** dikenal publik (mis. `@gmail.com`, `@yahoo.com`, `@hotmail.com`) | **Blokir keras.** Pesan: kirim lewat relay, atau pakai domain milik organisasi. Alasan: mengirim "dari" Gmail akan masuk spam dan **merusak reputasi domain pelanggan**. Ini penolakan yang menyelamatkan mereka. |
| `From` domain tanpa catatan SPF/DKIM | **Peringatan** (bukan blokir) + panduan teks apa yang harus ditambahkan |
| HELO/EHLO nama host bukan IP mentah | Peringatan |
| Kirim email uji ke alamat admin | Wajib untuk aktivasi |

### 3.2 Panduan yang disediakan aplikasi (bukan diserahkan ke pengetahuan operator)

Panel admin menampilkan daftar periksa dengan nilai konkret untuk domain pelanggan:

1. **SPF** — catatan TXT: `v=spf1 include:<relay> ~all` (atau IP server bila `smtp` langsung).
2. **DKIM** — bila memakai relay: aktifkan di penyedia, salin selector ke DNS. Bila `smtp` langsung: aplikasi **menandatangani** DKIM dengan kunci yang dibuat operator (`kelindan email dkim:generate`), dan menampilkan catatan TXT yang harus dipasang.
3. **DMARC** — mulai `p=none` dengan alamat laporan, naikkan ke `quarantine` setelah 2 minggu bersih.
4. **rDNS/PTR** — untuk `smtp` langsung; tidak perlu bila memakai relay.
5. **Port** — 587 (STARTTLS) disarankan; 25 sering diblokir penyedia cloud (sebutkan eksplisit).

**Alasan menaruh ini di dalam produk:** sysadmin yang tidak tahu apa itu DKIM akan menyimpulkan "produknya tidak bisa kirim email". Panduan di dalam aplikasi mengubah kegagalan produk menjadi tugas konfigurasi yang jelas — dan itu perbedaan antara pilot yang berhasil dan pilot yang berhenti.

### 3.3 Identitas pengirim dan balasan

- `From`: `"Kelindan" <notifikasi@domain-pelanggan>` — nama tampilan dapat dikonfigurasi.
- `Reply-To`: **tidak** diarahkan ke kotak yang tidak ada. Default: alamat admin yang dikonfigurasi; bila kosong, `Reply-To` dihilangkan. Alasan: `Reply-To` yang tidak dimonitor menghasilkan balasan pengguna yang hilang dan keluhan "tidak ada yang menjawab".
- `Message-ID` deterministik per `email_messages.id` (mencegah duplikat di beberapa server).
- `List-Unsubscribe` + `List-Id` untuk email non-keamanan, agar klien email tidak menandai sebagai spam.

---

## 4. Arsitektur pengiriman

```
mutasi (transaksi) → notifications (in-app) → jobs: email.dispatch  ← outbox (ADR-008)
                                                ↓
                                       email_messages (status)
                                                ↓
                          transport (none | smtp | relay) → hasil
                                                ↓
                            sukses | soft-fail (retry) | hard-fail (suppress)
```

**Aturan:**

1. **Tidak pernah mengirim di dalam request HTTP.** Semua lewat `jobs` (`ENT-20`). Alasan: SMTP bisa menggantung 30 s; itu akan menjadi latensi `NFR-005` dan memblokir pool DB.
2. Job `email.dispatch` idempoten per `email_messages.id` — pengiriman ulang tidak menghasilkan dua email (dijaga status).
3. Retry: 6 percobaan, backoff eksponensial ~1 menit → 12 jam. Setelah itu `failed` dan **terlihat di panel admin** (bukan hanya di log).
4. Kegagalan **tidak** memicu kegagalan mutasi. Email selalu boleh hilang; data tidak.
5. Semua email non-keamanan melewati pemeriksaan batas (§2.3) dan antrean digest sebelum dibuat.

---

## 5. Bounce, keluhan, dan penekanan (suppression)

| Kejadian | Deteksi (R0) | Tindakan |
| :--- | :--- | :--- |
| Hard bounce (5xx permanen, alamat tidak ada) | Kode SMTP 5xx saat pengiriman | Tandai alamat **suppressed** (`ENT-32`), hentikan pengiriman ke alamat itu, tampilkan ke admin |
| Soft bounce (4xx, kotak penuh, greylist) | Kode SMTP 4xx | Retry sampai batas, lalu `failed` (tidak di-suppress) |
| Keluhan spam (FBL/ARF) | **Tidak dideteksi otomatis di R0** | Dinyatakan terbuka: operator meneruskan laporan manual → tombol "suppress alamat" di admin |
| Penyedia memblokir pengirim | 5xx berulang pada banyak penerima | Job mendeteksi ≥ 5 hard-fail dalam 10 menit → **matikan pengiriman otomatis** dan beri tahu admin. Alasan: lebih baik berhenti daripada merusak reputasi lebih jauh. |

**Batas yang diakui:** tanpa parsing DSN dan tanpa FBL otomatis, deteksi keluhan tidak lengkap di R0. Ini **dinyatakan** di panel admin, bukan disembunyikan. Parsing DSN masuk rencana R2.

**Aturan etika operasional:** aplikasi tidak boleh mengirim ke alamat yang pernah hard-bounce, walau pengguna memintanya, sampai admin membuka penekanan secara eksplisit.

---

## 6. Keamanan

| Risiko | Mitigasi |
| :--- | :--- |
| Token reset bocor lewat email yang diteruskan | Token sekali pakai, TTL 30 menit, diikat ke `session_epoch`, dicabut setelah dipakai; email menyatakan "jika bukan Anda, abaikan" |
| Kebocoran isi pekerjaan di subjek | Subjek hanya kunci + judul; deskripsi/komentar/lampiran **tidak pernah** (§2.3) |
| Penyalahgunaan sebagai relay spam | Aplikasi tidak menyediakan fitur "kirim email bebas"; semua email berasal dari template sistem, penerima dibatasi anggota workspace (`T8`) |
| Enumerasi alamat lewat reset password | Respons reset **selalu sama** ("jika email terdaftar, tautan dikirim"), tanpa membedakan ada/tidak |
| Kredensial SMTP di log | Dilarang; uji canary (`T-SEC1`), dan kredensial disimpan terenkripsi di konfigurasi server, bukan di DB domain |
| Header injection lewat nama pengguna di subjek | Sanitasi `\r\n` pada semua nilai yang masuk header (`T-EMAIL6`) |
| Lampiran berbahaya dikirim lewat email | Email **tidak membawa lampiran** sama sekali di R0 — hanya tautan ke aplikasi. Ini menghilangkan seluruh kelas masalah ini. |

**Keputusan: tidak ada lampiran email.** Alasannya tiga: (a) menghindari batas ukuran & malware, (b) menghindari duplikasi sumber kebenaran file, (c) memaksa pengguna membuka aplikasi (yang memang tujuannya). Ini juga mengurangi biaya relay.

---

## 7. Data & skema

Tambahan `data-model.md` (masuk migration pertama, bukan tambahan):

**ENT-32 `email_messages`**

| Kolom | Tipe | Null | Default | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | tidak | (app) | PK; dasar `Message-ID` |
| `workspace_id` | uuid | ya | null | null untuk email pra-workspace |
| `recipient_id` | uuid | ya | null | FK users; null bila alamat eksternal (undangan) |
| `recipient_address_hash` | text | tidak | — | **Hash**, bukan alamat mentah (privasi log & ekspor) |
| `address_ciphertext` | bytea | tidak | — | Alamat terenkripsi untuk pengiriman ulang |
| `category` | smallint | tidak | — | 1=security, 2=invite, 3=assignment, 4=mention, 5=digest, 6=test |
| `template` | text | tidak | — | nama template berversi |
| `subject_hash` | text | tidak | — | tidak menyimpan subjek penuh (bisa memuat judul task) |
| `status` | smallint | tidak | 1 | 1=queued, 2=sending, 3=sent, 4=soft_failed, 5=failed, 6=suppressed, 7=cancelled |
| `attempts` | smallint | tidak | 0 | |
| `last_error` | text | ya | null | **Disanitasi**: kode SMTP + kategori, bukan respons mentah |
| `sent_at` | timestamptz | ya | null | |
| `created_at` | timestamptz | tidak | now() | |

Index: `(workspace_id, status, created_at)`, `(recipient_id, category, created_at DESC)` untuk pemeriksaan batas kirim.

**ENT-33 `email_suppressions`** — `id`, `workspace_id`, `address_hash` (unik per workspace), `reason` (1=hard_bounce, 2=manual, 3=complaint), `created_at`, `created_by`. Index unik `(workspace_id, address_hash)`.

**Catatan penting:** alamat email disimpan **terenkripsi** (kolom `address_ciphertext`) + hash untuk pencarian. Alasan: `audit_events` dan ekspor membawa serta data; alamat mentah di tabel yang di-ekspor memperbesar risiko. Enkripsi memakai kunci konfigurasi server (bukan kolom DB), sehingga backup DB saja tidak cukup untuk membaca alamat — dan itu **dinyatakan** di dokumen backup.

---

## 8. Uji wajib (`T-EMAIL`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| **T-EMAIL1** | Mode `none`: tidak ada job email dibuat, tidak ada percobaan koneksi SMTP, banner admin tampil, alur inti tetap berhasil | §2.2 |
| **T-EMAIL2** | `From` `@gmail.com` → aktivasi **ditolak** dengan pesan yang menyebut relay/domain sendiri | §3.1 |
| **T-EMAIL3** | SMTP menggantung 30 s → request mutasi tetap selesai < 300 ms (`NFR-005`); email gagal di job, data utuh | §4.1 |
| **T-EMAIL4** | 40 perubahan status berturut-turut pada task yang sama → maksimum 1 email per 15 menit (digabung), dan ≤ 6/jam per penerima | §2.3 |
| **T-EMAIL5** | Hard bounce 5xx → alamat suppressed; pengiriman berikutnya **tidak** dicoba; terlihat di admin | §5 |
| **T-EMAIL6** | Nama pengguna berisi `\r\n` atau header injection → header tersanitasi; tidak ada header tambahan | Keamanan |
| **T-EMAIL7** | Reset password: respons identik untuk email terdaftar & tidak; token sekali pakai; TTL 30 menit; dicabut setelah dipakai | §6 |
| **T-EMAIL8** | Subjek/isi email tidak pernah memuat deskripsi, isi komentar, atau lampiran | Privasi |
| **T-EMAIL9** | ≥ 5 hard-fail dalam 10 menit → pengiriman otomatis berhenti + notifikasi admin | §5 |
| **T-EMAIL10** | Kredensial SMTP & alamat mentah tidak muncul di log (canary) | `T-SEC1` |
| **T-EMAIL11** | Undangan dibuat walau email mati; tautan undangan berlaku 7 hari dan bisa disalin | §2.2 |

Diuji dengan **SMTP palsu in-process** (bukan server sungguhan), dengan kemampuan menyuntikkan 4xx/5xx/hang — agar uji cepat dan deterministik.

---

## 9. Yang secara sadar belum dikerjakan

| Belum ada | Alasan | Kapan |
| :--- | :--- | :--- |
| Parsing DSN / FBL otomatis | Butuh banyak variasi format & tidak memblokir pilot | R2 |
| Template yang bisa diedit admin | Menambah permukaan injeksi & dukungan | Setelah R1; untuk sekarang template berversi di kode |
| Email masuk (reply-to-task) | Fitur besar tersendiri; mailbox parsing adalah sumber bug dan spam | Tidak direncanakan |
| Multi-bahasa template | Satu bahasa (Indonesia) di R0 bersama UI (`gaps-analysis.md` C12) | Saat i18n dibuka |
| Lampiran email | Menghindari seluruh kelas masalah (§6) | Tidak direncanakan |

---

## 10. Rujukan silang

- Transport async & outbox: `architecture.md` ADR-021 (baru), ADR-008
- Tabel `jobs`: `data-model.md` ENT-20
- Notifikasi in-app sebagai sumber utama: `prd.md` `FR-206`
- Privasi log & canary: `testing-strategy.md` `T-SEC1`
- Perilaku saat email mati sebagai keputusan produk (bukan bug): `ux-principles.md` UX-5
- Undangan & RBAC: `rbac.md` `AC-04`, `AC-06`

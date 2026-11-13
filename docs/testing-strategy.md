# Strategi Pengujian (C3)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat. Menutup celah **C3** di `gaps-analysis.md`.

**Masalah yang dokumen ini selesaikan.** Bug paling mahal di arsitektur Kelindan **tidak** muncul pada uji unit. Ia muncul pada: dua orang mengedit field yang sama (ADR-015), klien putus saat delta dikirim (ADR-006), user kehilangan akses tapi masih memegang cache (T2), migrasi dijalankan pada data yang sudah ada (`NFR-012`), dan `NOTIFY` yang gagal di dalam transaksi (ADR-017). Semua itu tidak akan tertangkap oleh uji yang hanya memanggil fungsi.

Prinsip pengikatnya: **setiap klaim di dokumen desain harus punya uji yang bisa gagal.** Klaim tanpa uji adalah opini.

---

## 1. Piramida & target

| Lapisan | Jumlah relatif | Waktu jalan (target) | Yang dijamin | Yang **tidak** dijamin |
| :--- | :--- | :--- | :--- | :--- |
| **Unit** | banyak (70%) | < 60 s total | Logika murni: validasi, pemetaan, state machine status, perhitungan metrik, pembuatan UUIDv7 | Otorisasi nyata, DB, jaringan |
| **Integrasi** (DB nyata) | sedang (20%) | < 5 menit | Invariant DB, index terpakai, transaksi, trigger, migrasi | UI, WebSocket, konkurensi antar proses |
| **Kontrak API** | sedang | < 2 menit | Bentuk request/response, enum `code`, 404 vs 403, OpenAPI ↔ route | Perilaku UI |
| **End-to-end + konkurensi + chaos** | sedikit (10%) | < 15 menit | Real-time, optimistic UI, multi-klien, jaringan putus, izin dicabut saat aktif | Skala (lihat §9) |

**Target cakupan: tidak dipakai sebagai gerbang.** Cakupan baris mudah dimanipulasi dan tidak mengukur hal yang penting di sini. Gerbang yang dipakai adalah **daftar uji wajib** (§5–§8) dan **anggaran performa** (§9).

**Aturan yang mengikat:** setiap PR yang menambah endpoint, kolom, atau event **wajib** menambah uji pada lapisan yang sesuai. PR tanpa uji untuk perilaku baru ditolak — bukan karena aturan formal, tapi karena tanpa itu lapisan di atasnya menjadi tidak bermakna.

---

## 2. Lingkungan uji

| Lingkungan | Isi | Dipakai untuk |
| :--- | :--- | :--- |
| **L1 — lokal/CI cepat** | Postgres 16 & 17 (matriks), object storage palsu (filesystem), tanpa pooler | Unit, integrasi, kontrak |
| **L2 — CI lengkap** | Postgres 16/17 + pooler (PgBouncer, **transaction mode**) + storage S3-compatible | E2E, konkurensi, chaos jaringan, migrasi |
| **L3 — staging** | Profil Standar, data sintetis ukuran dataset acuan (`prd.md` §7.1) | Uji performa, uji migrasi pada data besar, drill restore |
| **L4 — produksi (instance kita)** | Data nyata | Hanya asap (smoke) setelah deploy + uji sintetis baca-saja |

**Wajib:** L2 menguji **pooler dalam mode transaction**, karena ADR-020 menyatakan mode itu melarang `SET` sesi dan prepared statement lintas transaksi. Uji yang berjalan tanpa pooler akan **lolos** padahal produksi gagal — kesalahan klasik yang dokumen ini sengaja cegah.

Matriks versi: Postgres **16 dan 17** (minimum yang didukung, ADR-018). Rilis wajib hijau di keduanya.

---

## 3. Aturan data uji

1. **Setiap uji membuat datanya sendiri** dengan fixture builder (bukan `seed.sql` bersama). Alasan: uji yang berbagi data menjadi saling bergantung dan gagal acak.
2. **Dua tenant wajib ada di setiap uji integrasi otorisasi.** Uji dengan satu tenant tidak bisa membuktikan isolasi.
3. **Data sintetis untuk skala**: generator deterministik (benih tetap) agar angka performa bisa dibandingkan antar-rilis. Ukuran: 500k task, 3M event, 1.5M komentar (§7.1 PRD).
4. **Larangan:** uji tidak boleh bergantung pada waktu sistem nyata (`now()`), zona waktu mesin, atau urutan UUID acak. Waktu disuntikkan; zona waktu dipaksa UTC kecuali uji khusus zona waktu.
5. **Fixture Jira** (`tests/fixtures/jira/`) dipakai bersama oleh uji importer dan uji kontrak ekspor. Menambah fixture = menambah cakupan nyata, bukan sekadar angka.

---

## 4. Uji yang **wajib** ada (gerbang)

Daftar ini adalah gerbang pipeline. Nomor `T-*` dipakai di commit dan PR.

### 4.1 Invariant data & skema (`T-SCHEMA`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| T-S1 | Semua DDL dari `data-model.md` dijalankan dari nol, lalu **dijalankan ulang** (idempoten/tidak) pada 16 & 17 | Skema bisa dibuat |
| T-S2 | Setiap invariant INV-01…INV-17 punya uji **negatif**: percobaan melanggar **ditolak** DB/aplikasi | Constraint benar-benar menegakkan, bukan hanya tertulis |
| T-S3 | `EXPLAIN` untuk 8 query terpanas (board, list, filter saya, pencarian, riwayat, delta sync, progress goal, count) **wajib** memakai index yang diharapkan; Seq Scan pada tabel > 100k baris = gagal | `NFR-017`, ADR-019 |
| T-S4 | Unique partial index INV-05 & constraint INV-15 diuji dengan data yang mencoba melanggarnya | Constraint yang rumit memang bekerja |
| T-S5 | Generated column `tsvector` terisi otomatis pada INSERT **dan** UPDATE (tanpa trigger) | Asumsi V7 |
| T-S6 | `changes.payload` > 4 KB dan `changes` dengan `description` → **ditolak** dengan `server.error` + trace ID (bukan dipotong) | ADR-017 |
| T-S7 | Mutasi task dengan deskripsi 100 KB (batas §7.4) **berhasil** tersimpan dan delta-nya < 4 KB | Bug NOTIFY tidak kembali |

### 4.1b Editor (`T-EDIT`)

Mengacu `editor-decision.md` §7: T-EDIT1 keamanan Markdown (XSS), T-EDIT2 tempel dari Word, T-EDIT3 konflik tanpa kehilangan draf, T-EDIT4 round-trip format subset v1, T-EDIT5 pencarian di dalam markup, T-EDIT6 batas ukuran di klien & server, T-EDIT7 keyboard penuh, T-EDIT8 render 200 komentar < 100 ms.

### 4.1c Email & media (`T-EMAIL`, `T-MEDIA`)

Mengacu `email.md` §8 dan `attachments-media.md` §8: T-EMAIL1…11 (mode `none` tidak mengirim, penolakan `From` domain publik, SMTP menggantung tidak menyentuh latensi mutasi, batas & digest, hard bounce, header injection, privasi subjek) dan T-MEDIA1…12 (kompresi/thumbnail, EXIF, board tanpa byte asli, CLS, presigned, tidak ada objek publik, allowlist tipe, SVG/HTML, kegagalan unggah, verifikasi `complete`, rate limit, pembersihan objek yatim).

### 4.1d Onboarding, real-time lanjutan, pencarian, ADF (`T-ONB`, `T-RT8+`, `T-SEARCH`, `T-ADF`)

- `T-ONB1…T-ONB8` (`onboarding.md` §10): instalasi < 5 menit tanpa akun default, setiap empty state punya tepat satu aksi & 0 istilah terlarang, error ≠ empty, task pertama < 60 detik, impor tidak bisa tanpa pratinjau.
- `T-RT8…T-RT12` (`realtime-and-search.md` §5): status diarsipkan saat board terbuka, akses dicabut saat terhubung, 200 delta/detik, field terkunci lokal, klasifikasi objek wajib.
- `T-SEARCH1…T-SEARCH8` (`realtime-and-search.md` §10): nomor task instan, query tepi, hasil tidak membocorkan tim, urutan bobot, palette.
- `T-ADF1…T-ADF8` (`spike-jira-importer.md` §8): tidak ada teks hilang, tidak ada HTML mentah, level L1–L4 benar, node tak dikenal aman.

### 4.2 Konsistensi tulis (`T-WRITE`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| T-W1 | 50 mutasi paralel pada **field berbeda** task yang sama → semua diterapkan, tidak ada yang hilang | ADR-015 butir 3 |
| T-W2 | 2 permintaan dengan **`Idempotency-Key` sama + body sama** → tepat satu `task_events`, `version` naik 1, respons identik + `Idempotent-Replay: true` | §6 API |
| T-W3 | Key sama + body **berbeda** → `409 conflict.idempotency_key_reuse` | §6 API |
| T-W4 | Retry otomatis setelah respons hilang (jaringan putus di tengah) **tidak** membuat task/komentar ganda | Skenario nyata, bukan teoretis |
| T-W5 | `expected_version` basi → `409 conflict.version` + `current` berisi entitas terbaru | §7.3 |
| T-W6 | Deskripsi diedit dua pengguna bersamaan tanpa `expected_version` → **ditolak** (wajib versi) | ADR-015 butir 4 |
| T-W7 | Patch tanpa perubahan bersih → `version` **tidak** naik, tidak ada event | `INV-04` |
| T-W8 | `completed_at` first-touch: status bolak-balik Selesai→Dikerjakan→Selesai tidak menimpa nilai awal | `INV-07` |
| T-W9 | Semua mutasi menulis `task_events` **dalam transaksi yang sama**: paksa gagal setelah update → tidak ada event, tidak ada perubahan | ADR-004 |
| T-W10 | `seq` pada `changes` monoton per workspace di bawah 20 penulis paralel; tidak ada duplikat & tidak ada celah | ADR-006 |

### 4.3 Otorisasi (`T-AUTHZ`)

Mengacu ke `rbac.md` **TC-01…TC-25** (tidak diduplikasi di sini). Tambahan yang mengikat:

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| T-A1 | **TC-14 dijalankan otomatis untuk setiap route** yang terdaftar di OpenAPI, termasuk route baru. Route tanpa entri di daftar = gagal | `INV-12`, isolasi tenant |
| T-A2 | Tabel matriks `rbac.md` §3 diuji sebagai **matriks**: setiap sel (aksi × peran) diuji minimal sekali; sel yang tidak ada di dokumen → dianggap ditolak dan diuji | Deny-by-default (R5) |
| T-A3 | Action ID yang dipakai di kode **harus** ada di katalog `rbac.md` §2; kode dengan action tak terdaftar → build gagal | Tidak ada izin "liar" |
| T-A4 | Setiap aksi ber-`Audit = YA` menghasilkan **tepat satu** baris `audit_events`; transaksi gagal → tidak ada baris audit hantu | TC-13 |
| T-A5 | Mode dukungan (`AC-15`): aksi konten tanpa mode ditolak; dengan mode, berhasil **dan** teraudit dengan sufiks `.via_workspace_admin` | `rbac.md` §1.3 R1 |

### 4.4 Real-time (`T-RT`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| T-R1 | Dua klien, satu mengubah status → klien lain melihat < 1 s p95 (target `NFR-007`); diukur, bukan diasumsikan | ADR-006 |
| T-R2 | Klien putus 10 s, lalu reconnect dengan `since_seq` → **semua** delta yang terlewat diterima, urut, tanpa celah | Bagian terpenting ADR-006 |
| T-R3 | Klien putus > retensi (24 jam) → `resync_required` / `410` dan klien memuat ulang, **tidak** crash | Penanganan batas |
| T-R4 | Delta duplikat & delta lebih tua **diabaikan** oleh klien (idempoten) | ADR-015 butir 5 |
| T-R5 | 50 klien di board yang sama, 1 perubahan → 49 menerima tepat satu delta; fan-out tidak meledak | `NFR-007` |
| T-R6 | **Reconnect storm**: putuskan 200 klien serentak, sambungkan ulang → tidak ada lonjakan error, backoff+jitter bekerja, DB tidak jenuh | Skenario deploy |
| T-R7 | `NOTIFY` yang gagal (payload terlalu besar, dipaksa) **tidak** menggagalkan mutasi task; delta tetap tersedia lewat `changes` | ADR-017 |

### 4.5 UI & waktu nyata di klien (`T-UI`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| T-UI1 | Aksi task mengubah frame < 100 ms p95 tanpa indikator loading (`NFR-003`), diukur pada build produksi | Janji utama produk |
| T-UI2 | Mutasi gagal (500) → UI **kembali** ke nilai kanonik + notifikasi yang bisa di-retry. Tidak ada state "berhasil padahal gagal" | Prinsip §3.5 |
| T-UI3 | List 10.000 baris: scroll ≥ 50 fps, render awal < 1 s (`NFR-009`) | Virtualisasi |
| T-UI4 | Aksesibilitas: seluruh alur inti (buat task, ubah status, komentar, navigasi keyboard) lulus axe + uji keyboard manual (`NFR-015`) | Bukan setelah R2 |
| T-UI5 | Layar 375 px: tidak ada horizontal scroll pada Board/List/detail (`FR-110`) | PWA |
| T-UI6 | 403 menampilkan tombol nonaktif **dengan alasan**; 404 tidak menampilkan apa pun yang membocorkan keberadaan (`api-contract.md` §5.4–5.5) | Konsistensi UI ↔ API |
| **T-UX1** | `UX-B1`–`UX-B5`, `UX-B9` diukur pada build produksi; regresi melewati ambang **memblokir merge** | `ux-principles.md` §4 |
| **T-UX2** | `UX-B7`: 0 istilah terlarang (`issue`, `sprint`, `story point`, `epic`, `JQL`) pada string UI | `ux-principles.md` UX-3 |
| **T-UX3** | Semua pintasan pada tabel kanonik terdaftar, tidak bertabrakan, dan tidak aktif saat fokus di input teks | `ux-principles.md` §7 |

### 4.6 Kontrak API (`T-API`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| T-API1 | Setiap route di kode ada di OpenAPI dan sebaliknya (dua arah) | §9.2 `api-contract.md` |
| T-API2 | Setiap respons diuji terhadap skema OpenAPI saat runtime uji | Tipe tidak cukup |
| T-API3 | Setiap `code` di §5.3 punya uji yang memicunya; kode tak terdaftar tidak pernah muncul di respons | Enum tertutup |
| T-API4 | `oasdiff` antara rilis sebelumnya dan sekarang: breaking change → gagal kecuali berlabel `breaking-api` | Rekognisi breaking change |
| T-API5 | Field tak dikenal pada PATCH → `422 validation.unknown_field` (bukan diabaikan) | §7.1 |
| T-API6 | `limit` > 200 → `422`; `offset` → `422`; cursor yang dirusak → `422`/`400` bukan 500 | Batas eksplisit |
| T-API7 | Semua `POST`/`PATCH`/`DELETE` tanpa `Idempotency-Key` → `400` | §6 |
| T-API8 | `trace_id` ada di **semua** respons (sukses & gagal) | Prinsip §3.5 |

### 4.7 Migrasi (`T-MIG`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| T-MIG1 | Migrasi dari **versi rilis sebelumnya** (dengan data sintetis ukuran dataset acuan) selesai tanpa kehilangan data | `NFR-012`, celah C1 |
| T-MIG2 | Tidak ada migrasi yang mengunci tabel > 5 s pada dataset acuan (diukur, bukan diklaim) | `NFR-012` |
| T-MIG3 | Aplikasi versi **lama** tetap berjalan terhadap skema **baru** selama satu rilis (expand/contract) | Jendela deploy |
| T-MIG4 | Migrasi dijalankan dua kali (idempoten atau gagal jelas), tidak pernah setengah jadi | Kegagalan deploy |
| T-MIG5 | Downgrade **tidak** didukung: percobaan downgrade memberi pesan jelas, tidak merusak data | Ekspektasi jujur |

### 4.8 Importer (`T-IMP`)

Mengacu `import-contract.md` §7. Tambahan gerbang:

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| T-IMP1 | Impor ulang **tidak** menggandakan data (`IC-8`) dan **tidak** menimpa perubahan lokal (`IC-9`) | Idempotensi & kepercayaan |
| T-IMP2 | Setiap level kegagalan L1–L5 dihasilkan oleh fixture nyata; laporan dapat diunduh; jumlah di laporan = jumlah di DB | Kontrak laporan |
| T-IMP3 | Impor tanpa laporan → status tidak boleh "selesai" (`INV-17`) | Tidak ada impor tanpa jejak |

### 4.9 Keamanan (`T-SEC`)

| # | Uji | Membuktikan |
| :--- | :--- | :--- |
| T-SEC1 | Canary string (token/email/isi komentar) tidak pernah muncul di log aplikasi maupun log query | Aturan log §4 `architecture.md` |
| T-SEC2 | Logout → user lain login di browser yang sama: tidak ada sisa data (TC-16); cache dibersihkan | T2 |
| T-SEC3 | Pencabutan akses saat klien aktif: WS diputus < 5 s, HTTP berikutnya 403/404 (TC-15) | R4 `rbac.md` |
| T-SEC4 | Webhook ke `127.0.0.1`, `169.254.169.254`, hostname internal → ditolak saat simpan **dan** kirim (TC-19) | T6 |
| T-SEC5 | Presigned URL kedaluwarsa/diubah → 403/410; `storage_key` tidak pernah di respons (TC-20) | T7, INV-09 |
| T-SEC6 | Token API dengan scope di luar hak pembuat → ditolak saat dibuat (TC-18) | T4 |
| T-SEC7 | 500 mention dalam satu komentar → ditolak/dipotong, notifikasi ≤ batas (TC-21) | T8 |
| T-SEC8 | Pemeriksaan lisensi dependensi (ADR-014) + `npm audit` tingkat tinggi = gagal build | Supply chain |
| T-SEC9…T-SEC16 | Tidak ada SQL string terangkai, header keamanan di semua rute, pemindaian image (non-root, tanpa secret, CVE kritis), SBOM, tidak ada rahasia di repo, rate limit & batas body, image bertanda tangan | `security-policy.md` §10 |

---

## 5. Uji performa (`T-PERF`)

Dijalankan di **L3** (data ukuran dataset acuan), bukan di laptop.

| # | Uji | Ambang (gagal bila melewati) |
| :--- | :--- | :--- |
| T-PERF1 | API baca board/list 100 item | p95 < 200 ms, p99 < 500 ms (`NFR-004`) |
| T-PERF2 | API tulis mutasi task | p95 < 300 ms, p99 < 800 ms (`NFR-005`) |
| T-PERF3 | Pencarian judul & istilah umum | p95 < 150 ms untuk istilah selektif; istilah umum dicatat & dibandingkan antar-rilis (`NFR-006`, `NFR-006a`) |
| T-PERF4 | 150 klien konkuren, 60 detik, campuran baca/tulis | Tanpa error 5xx; p95 sesuai di atas; pool DB tidak habis (`NFR-019`) |
| T-PERF5 | Propagasi real-time p95 150 klien | < 1 s (`NFR-007`) |
| T-PERF6 | Muat awal PWA | p75 < 2,5 s, bundle awal < 300 KB gzip (`NFR-008`) |
| T-PERF7 | Job latar: 10.000 notifikasi terjadwal | Selesai < 5 menit, tanpa mengunci tabel |

**Aturan:** angka performa dicatat per commit pada grafik tren. Regresi > 20% pada p95 **memblokir merge**, bukan sekadar memberi peringatan. Alasan: SLO adalah janji produk; tanpa gerbang, ia menjadi hiasan.

---

## 6. Uji konkurensi & chaos (`T-CHAOS`)

Ini lapisan yang paling sering dihilangkan dan paling relevan untuk arsitektur ini.

| # | Skenario | Harapan |
| :--- | :--- | :--- |
| T-CH1 | Jaringan klien diputus 3 s di tengah mutasi, lalu disambungkan | Tidak ada data hilang/ganda; UI berakhir di state kanonik (T-W4, T-UI2) |
| T-CH2 | Latensi jaringan naik ke 2 s selama 60 s | UI tetap responsif (optimistic), antrean tidak meledak, tidak ada error yang tak bisa di-retry |
| T-CH3 | Proses aplikasi mati (SIGKILL) di tengah job | Job diklaim ulang setelah `locked_until`, tidak hilang (`ENT-20`, ADR-008) |
| T-CH4 | Pooler habis (paksa 100% koneksi terpakai) | `503 server.busy` dengan `Retry-After`, bukan menggantung (`NFR-019`) |
| T-CH5 | Deploy baru saat 500 klien aktif | Reconnect storm tertangani (T-R6), tidak ada error 5xx beruntun |
| T-CH6 | Dua admin mengubah toggle fitur & status bersamaan | Tidak ada status yatim; `is_default` tetap tepat satu (INV-05) |
| T-CH7 | Impor dijalankan sementara pengguna mengedit task yang sama | Impor tidak menimpa (`IC-9`), konflik dilaporkan |

---

## 7. Uji UI: apa yang diuji, apa yang tidak

- **Diuji otomatis:** alur inti (buat task, ubah status, komentar, checklist), state error (`T-UI2`, `T-UI6`), aksesibilitas, layout responsif, dan **anggaran performa interaksi** (`T-UI1`).
- **Tidak diotomatiskan:** estetika, keputusan tata letak, dan kualitas mikro-teks. Ini ditinjau manusia pada setiap rilis (lihat §8).
- **Rendering uji** memakai build produksi, bukan dev server. Alasan: dev server memalsukan performa dan menghasilkan angka yang tidak berarti.

---

## 8. Gerbang rilis (definisi "layak dirilis")

Rilis **tidak** boleh keluar bila salah satu gagal:

1. Semua `T-SCHEMA`, `T-WRITE`, `T-AUTHZ`, `T-API`, `T-MIG`, `T-SEC` hijau di **Postgres 16 dan 17**.
2. `T-RT`, `T-UI`, `T-CHAOS` hijau di L2.
3. `T-PERF` memenuhi ambang di L3 (untuk rilis minor: tidak ada regresi > 20%).
4. **Satu drill restore** lulus (`NFR-011`, D-03 `decisions-r0.md`).
5. Tidak ada temuan terbuka tingkat tinggi pada pemeriksaan dependensi.
6. `rbac.md` TC lengkap & hijau untuk setiap route yang ada.
7. Catatan rilis menyebut: perubahan skema, breaking change API (bila ada), dan batasan baru.

**Aturan yang paling sering dilanggar dan karena itu ditulis:** gerbang rilis **tidak** boleh dilewati dengan alasan "ini hanya perbaikan kecil". Justru perbaikan kecil yang menyebabkan insiden besar, karena ia yang paling jarang diuji.

---

## 9. Yang **tidak** dibuktikan oleh uji ini

Kejujuran batas, agar tidak ada klaim berlebih:

| Tidak dibuktikan | Kenapa | Kapan dibuktikan |
| :--- | :--- | :--- |
| Perilaku pada **10.000 pengguna** sungguhan | Uji beban mensimulasikan pola, bukan perilaku manusia | Setelah ada pilot nyata (T2) |
| Bahwa SLO terpenuhi di **infrastruktur pelanggan** | Perangkat keras & jaringan berbeda | Ukur di tiap pilot; sediakan `/metrics` (`NFR-018`) |
| Kebenaran **migrasi Jira** untuk semua variasi | Fixture terbatas | Laporan L1–L5 jujur, bukan janji 100% |
| Bahwa tidak ada **kebocoran data** | Tidak ada uji yang bisa membuktikan negatif secara umum | Audit keamanan eksternal sebelum R2 (gate R2) |
| Performa **frontend di perangkat lambat** | Uji memakai headless browser | Uji manual pada perangkat kelas menengah sebelum T3 |

---

## 10. Perkakas & konvensi (tanpa memilih pustaka)

Dokumen ini **tidak** menetapkan pustaka uji (itu keputusan implementasi), tetapi menetapkan **kemampuan** yang wajib ada:

1. Menjalankan uji integrasi terhadap Postgres **nyata** (bukan tiruan/in-memory), karena hampir semua invariant bergantung pada DB.
2. Membuat database terisolasi per uji integrasi (template database + `CREATE DATABASE … TEMPLATE`), bukan transaksi yang di-rollback — karena uji konkurensi butuh commit nyata.
3. Mengukur waktu di klien (browser nyata) untuk `T-UI1`, bukan hanya di server.
4. Merekam `EXPLAIN` untuk `T-S3` dan menyimpannya sebagai artefak agar bisa dibandingkan.
5. Mengemulasi kondisi jaringan (putus, lambat) di klien.
6. Menjalankan matriks Postgres 16/17 di CI.

Konvensi penamaan uji: `T-<kelompok><nomor> <perilaku> — <ID dokumen yang dibuktikan>`. Contoh: `T-W4 retry tidak menggandakan task — api-contract §6, ADR-015`. Dengan begitu, setiap uji bisa dilacak ke klaim yang ia jaga.

---

## 11. Rujukan silang

| Klaim | Uji yang menjaganya |
| :--- | :--- |
| INV-01…INV-17 (`data-model.md` §7) | T-S2, T-W*, T-A1 |
| TC-01…TC-25 (`rbac.md` §6) | T-AUTHZ, T-A1 |
| ADR-015 (konsistensi tulis) | T-W1…T-W8 |
| ADR-006/ADR-017 (real-time, batas payload) | T-R1…T-R7, T-S6, T-S7 |
| ADR-019 (pencarian) | T-S3, T-PERF3 |
| ADR-020 (pooler transaction mode) | §2 (L2 wajib pooler), T-CH4 |
| `api-contract.md` §5–§8 | T-API1…T-API8, T-UI6 |
| `import-contract.md` | T-IMP1…T-IMP3 |
| `NFR-010`/`NFR-011` (RPO/RTO) | §8 butir 4 (drill restore) |

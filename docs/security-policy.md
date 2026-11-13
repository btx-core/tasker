# Kebijakan Keamanan & Supply Chain (C9)

**Versi:** 1.0 · **Tanggal:** 2026-11-12
**Status:** Aktif. Mengikat. Menutup celah **C9** di `gaps-analysis.md`.

**Kenapa dokumen ini menentukan adopsi.** Sysadmin perusahaan tidak menolak perangkat lunak karena kurang fitur. Mereka menolaknya karena **tidak bisa menjawab satu pertanyaan**: "kalau ada CVE di dependensi kalian bulan depan, bagaimana saya dapat tambalannya?" Tanpa jawaban tertulis, produk ini tidak akan pernah masuk lingkungan produksi — sebaik apa pun desainnya.

Aturan pengikat: **setiap janji di sini harus punya prosedur yang dijalankan, bukan hanya niat.** Yang tidak bisa dijalankan tidak ditulis.

---

## 1. Batas tanggung jawab (dinyatakan lebih dulu, agar tidak ada salah paham)

| Peran | Tanggung jawab |
| :--- | :--- |
| **Kami (maintainer)** | Kode, dependensi yang kami pilih, image/artefak rilis, patch keamanan untuk versi yang didukung, pengungkapan kerentanan dengan koordinasi, SBOM. |
| **Operator (pelanggan)** | Infrastruktur, OS, database, jaringan, backup, konfigurasi SMTP/SSO, kontrol akses fisik & cloud. |
| **Di luar tanggung jawab kami** | Operator dengan akses root ke database (self-host = mereka memegang data), serangan fisik, kepatuhan regulasi spesifik per negara, keamanan perangkat pengguna. |

**Dinyatakan tegas** karena produk self-host sering disalahpahami: kami **tidak bisa** menjamin keamanan instalasi yang dikonfigurasi dengan `admin/admin`. Yang kami jamin adalah **kode dan artefak** yang kami kirim, dan **jalur tambalan** untuk itu.

---

## 2. Versi yang didukung (harus dijawab sebelum ada rilis)

| Aturan | Nilai |
| :--- | :--- |
| Versi yang menerima patch keamanan | **Rilis minor terakhir + satu sebelumnya** (mis. 1.4.x dan 1.3.x) |
| Versi lebih lama | Tidak ditambal; dokumen upgrade disediakan |
| Masa dukungan satu rilis minor | Minimal **6 bulan** sejak rilis |
| Patch keamanan untuk rilis LTS (bila ada) | Ditentukan saat LTS pertama; belum ada di R0–R2 |

**Konsekuensi yang diterima:** pengguna versi lama **tidak** mendapat tambalan. Ini ditulis sekarang supaya tidak menjadi janji yang dilanggar nanti — dan menjadi alasan `migrations.md` menekankan jalur upgrade yang mulus (orang harus mau upgrade).

---

## 3. SLA respons (berbasis tingkat keparahan, bukan permintaan)

Mengikuti CVSS v4 bila tersedia; bila tidak, penilaian manual dengan alasan tertulis.

| Tingkat | Contoh | Konfirmasi | Perbaikan | Pengungkapan |
| :--- | :--- | :--- | :--- | :--- |
| **Kritis** | Eksekusi kode tanpa autentikasi, kebocoran lintas-tenant, bypass otorisasi, RCE lewat lampiran | ≤ 24 jam | ≤ 7 hari | Setelah patch tersedia + 14 hari |
| **Tinggi** | Eskalasi hak istimewa, SSRF ke metadata cloud, kebocoran data terbatas | ≤ 3 hari | ≤ 30 hari | Setelah patch + 30 hari |
| **Sedang** | DoS terbatas, kebocoran informasi minor, XSS yang butuh interaksi | ≤ 7 hari | ≤ 90 hari | Bersama rilis berikutnya |
| **Rendah** | Hardening, informasi versi, header | ≤ 14 hari | Sesuai jadwal rilis | Catatan rilis |

**Catatan jujur:** angka ini adalah komitmen tim kecil, bukan SLA komersial. Untuk pelanggan dengan dukungan berbayar (`decisions-r0.md` D-06), SLA dapat diperketat lewat perjanjian — tetapi **angka di atas tetap menjadi batas bawah tanpa perjanjian**.

---

## 4. Proses menangani kerentanan

### 4.1 Pelaporan masuk

| Jalur | Aturan |
| :--- | :--- |
| `security@<domain>` (bukan issue publik) | Wajib ada sebelum T3; diteruskan ke semua maintainer |
| Pelaporan lewat issue publik | Ditutup sebagai issue, dipindahkan ke jalur privat, pelapor diberi tahu |
| Kunci PGP untuk laporan sensitif | Diterbitkan bersama kontak |

**Kewajiban kami pada pelapor** (ini yang membuat peneliti mau melapor lagi): konfirmasi diterima ≤ 3 hari kerja, kabar status setiap 7 hari sampai selesai, kredit di pengungkapan (kecuali diminta anonim).

### 4.2 Alur penanganan (mengikat)

1. **Triage** — tentukan tingkat (§3), catat di dokumen internal privat. **Tidak** di issue publik.
2. **Reproduksi** — buat uji yang gagal (verifikasi kerentanan **sebelum** memperbaiki; ini juga mencegah "perbaikan" yang tidak menutup apa pun).
3. **Perbaikan** — di branch privat, lalu rilis patch ke versi yang didukung (§2).
4. **Backport** — patch ke rilis minor sebelumnya bila memenuhi §2. Bila tidak bisa di-backport, nyatakan dan sarankan upgrade.
5. **Pengungkapan** — setelah patch tersedia, dengan: deskripsi, versi terdampak, versi yang memperbaiki, **langkah mitigasi sementara** untuk yang belum bisa upgrade, dan kredit.
6. **Post-mortem internal** — apa yang membuat bug ini mungkin, dan uji/aturan apa yang mencegahnya terulang. Ditambahkan ke dokumen ini bila mengubah kebijakan.

### 4.3 Yang dilarang

| Dilarang | Alasan |
| :--- | :--- |
| Menutup laporan keamanan tanpa penjelasan | Menghilangkan kepercayaan pelapor |
| Memperbaiki diam-diam di rilis biasa tanpa catatan | Operator tidak tahu bahwa mereka perlu upgrade **segera** |
| Menunda patch karena "sedang sibuk fitur" | Fitur tidak berguna bila instalasi ditinggalkan karena tidak ditambal |
| Meminta pelapor menandatangani NDA sebagai syarat laporan | Menghalangi pelaporan; tidak diperlukan untuk perbaikan |

---

## 5. Dependensi: kebijakan yang bisa dijalankan

### 5.1 Menambah dependensi baru (gerbang di PR)

Dependensi baru **wajib** memenuhi semua yang berikut. Tanpa itu, PR ditolak — bukan didiskusikan.

| Kriteria | Ambang | Cara memeriksa |
| :--- | :--- | :--- |
| Lisensi kompatibel AGPL-3.0-only | Allowlist: MIT, BSD-2/3, Apache-2.0, ISC, MPL-2.0, 0BSD, Unlicense, CC0 | Pemeriksaan otomatis di CI (ADR-014) |
| Tidak ada maintainer tunggal tanpa rilis 12 bulan | — | Pemeriksaan manual; dicatat di PR |
| Tidak menggantikan < 50 baris kode sendiri | — | Pertanyaan pertama: apakah ini layak jadi dependensi? |
| Ukuran & kedalaman pohon | Tidak menambah > 10 paket transitif untuk fungsi non-inti | `npm ls` / laporan ukuran |
| Riwayat CVE | Tidak ada CVE terbuka yang belum ditambal | `npm audit` + riwayat advisori |
| Native/binary | Dihindari kecuali tidak ada alternatif; bila ada, harus multi-arsitektur | Pertimbangan deploy (`NFR-016`) |

**Aturan yang paling sering menyelamatkan proyek:** *"bisa ditulis sendiri dalam < 50 baris?"* Dependensi kecil untuk hal sepele adalah sumber utama CVE dan beban pemeliharaan di produk berumur panjang.

### 5.2 Rutinitas (terjadwal, bukan "kalau ingat")

| Frekuensi | Kegiatan | Keluaran |
| :--- | :--- | :--- |
| **Setiap PR** | `npm audit` (high/critical = gagal), pemeriksaan lisensi, pemeriksaan ukuran bundle | Gerbang CI |
| **Mingguan** | Tinjauan otomatis dependensi (PR otomatis dari bot) | PR yang di-review manusia, tidak di-merge otomatis |
| **Bulanan** | Tinjauan manual: advisori yang belum tercakup tooling, dependensi tanpa rilis 12 bulan | Catatan di repo |
| **Kuartalan** | Tinjauan **menghapus** dependensi yang tidak dipakai / bisa diganti; tinjauan SBOM | Daftar dependensi menyusut atau tetap |
| **Sebelum setiap rilis** | SBOM digenerate & dilampirkan; image dipindai | Artefak rilis |

**Keputusan: pembaruan dependensi tidak pernah otomatis di-merge.** Alasannya: pembaruan otomatis adalah sumber regresi halus, dan produk ini tidak punya kapasitas menanggung regresi tak terdeteksi. Bot membuka PR; manusia menyetujui.

### 5.3 Ketika CVE muncul di dependensi kami

1. Tentukan apakah jalur kode kita **mencapai** kode yang rentan (banyak CVE tidak tercapai — ini dicatat, bukan diasumsikan).
2. Bila tercapai: terapkan §3 (tingkat), rilis patch.
3. Bila tidak tercapai dan tidak bisa diperbaiki cepat: tambahkan **advisori internal** + uji yang memastikan jalur tidak tercapai; tetap rencanakan upgrade.
4. Bila dependensi **tidak dirawat**: ganti, atau fork dengan alasan tertulis (fork = tanggung jawab baru, jadi pilihan terakhir).

---

## 6. Artefak rilis: yang harus bisa diperiksa pelanggan

| Artefak | Wajib | Alasan |
| :--- | :--- | :--- |
| **Image container** yang ditandatangani (Sigstore/cosign) | Mulai T3 | Pelanggan bisa memverifikasi bahwa image berasal dari kami dan tidak diubah |
| **SBOM** (CycloneDX) per rilis | Ya | Syarat procurement; juga memungkinkan pelanggan memeriksa sendiri saat CVE baru muncul |
| **Checksum & hash commit** | Ya | Keterlacakan; wajib untuk AGPL §13 (`FR-115`) |
| **Build reproducible** | Target R2 | Memungkinkan verifikasi independen bahwa image = source |
| **Base image minimal** (distroless/alpine), non-root, read-only FS | Ya | Mengurangi permukaan serangan; `NFR-016` tetap terpenuhi |
| **Tidak ada secret di image** | Ya | Diuji: pemindaian image untuk pola kredensial |

**Batas yang diakui:** build reproducible penuh sangat sulit dicapai. Komitmen kami: **semua** dependensi terkunci (`lockfile`) dan build berjalan di lingkungan yang didefinisikan; kami **tidak** mengklaim reproducible sempurna sampai diverifikasi dua kali oleh pihak ketiga.

---

## 7. Keamanan kode: aturan yang diuji, bukan diharapkan

| Aturan | Penegakan |
| :--- | :--- |
| Semua query lewat repository yang menyertakan `workspace_id` (`INV-12`) | Lint tipe + `T-A1` |
| Tidak ada SQL string yang dirangkai dari input | Pemeriksaan statis (`T-SEC9`) |
| Semua output HTML disanitasi allowlist | `T-EDIT1` |
| Tidak ada `dangerouslySetInnerHTML` di luar satu komponen sanitasi | Lint |
| Rahasia tidak masuk log/repo | Canary `T-SEC1` + pemindaian pre-commit |
| Semua endpoint punya uji otorisasi | `T-A1` |
| Tidak ada `eval`, `new Function`, atau deserialisasi tidak aman | Lint |
| Dependency confusion: paket diambil dari registry resmi + lockfile | Konfigurasi + CI |
| Header keamanan (CSP, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) | Uji header pada setiap rute |
| Rate limit & ukuran body di semua endpoint | `NFR-014`, uji |
| Rotasi kunci sesi/token terdokumentasi | `migrations`-like runbook |

**CSP dinyatakan:** `default-src 'self'` dengan pengecualian eksplisit untuk domain storage (`attachments-media.md` §6). Bila CSP tidak bisa ketat karena kebutuhan kode, itu harus dibahas di PR — bukan dilonggarkan diam-diam.

---

## 8. Insiden keamanan: rencana, bukan reaksi

| Tahap | Tindakan |
| :--- | :--- |
| **Deteksi** | Laporan, advisori dependensi, atau audit. Catat waktu deteksi. |
| **Penilaian** | Apakah ada data pelanggan terdampak? (untuk produk self-host: kami **tidak** punya akses ke data pelanggan — ini membatasi dampak sekaligus membatasi visibilitas. Dinyatakan.) |
| **Penahanan** | Rilis patch / mitigasi yang bisa diterapkan operator (konfigurasi, aturan firewall) |
| **Komunikasi** | Advisori publik + catatan rilis + pesan upgrade yang jelas. Untuk dampak tinggi: pemberitahuan langsung ke pelanggan berbayar. |
| **Pemulihan** | Panduan langkah demi langkah; bila data mungkin disusupi di sisi pelanggan, panduan forensik dasar |
| **Pasca-insiden** | Post-mortem publik (diringkas, tanpa detail eksploitasi) + perubahan kebijakan/uji |

**Kewajiban yang tidak bisa dihindari:** bila kerentanan bisa dieksploitasi tanpa autentikasi dan memungkinkan eksekusi kode, kami merilis **mitigasi konfigurasi** dalam 24 jam walau patch belum siap. Mitigasi yang tidak sempurna jauh lebih baik daripada diam.

---

## 9. Kepatuhan: apa yang kami bantu, apa yang bukan

| Yang pelanggan butuhkan | Status kami |
| :--- | :--- |
| Audit log akses administratif | Ada (`FR-305`, `ENT-16`) |
| SSO/SCIM | R2 (`FR-303`, `FR-304`) |
| Enkripsi data saat transit & istirahat | Transit: TLS. Istirahat: tanggung jawab operator (disk encryption) — **dinyatakan**, bukan diklaim sebagai fitur kami |
| Data residency | Self-host = di infrastruktur pelanggan (NG-10) |
| SOC 2 / ISO 27001 **untuk produk kami** | **Tidak ada dan tidak diklaim.** Yang kami sediakan: dokumen, SBOM, dan proses di atas untuk **audit pelanggan sendiri** |
| DPA / perjanjian pemrosesan data | Tidak relevan untuk self-host (kami tidak memproses data pelanggan). Untuk hosting terkelola (setelah D-01 butir 4): wajib ada |
| Penghapusan data atas permintaan | Self-host: operator melakukannya. Fitur bantu: ekspor & purge (`FR-114`, `NFR-013`) |

**Pernyataan tegas:** kami **tidak** mengklaim sertifikasi apa pun. Mengklaim tanpa sertifikat adalah cara tercepat kehilangan kepercayaan procurement — dan mereka akan meminta buktinya.

---

## 10. Uji & pemeriksaan yang wajib ada

| # | Pemeriksaan | Gerbang |
| :--- | :--- | :--- |
| **T-SEC9** | Tidak ada SQL yang dirangkai dari input (analisis statis) | PR |
| **T-SEC10** | Header keamanan hadir & benar pada semua rute (CSP, HSTS, `nosniff`, `Referrer-Policy`) | PR |
| **T-SEC11** | Pemindaian image: tidak ada CVE kritis yang belum ditambal, tidak berjalan sebagai root, tidak ada secret | Rilis |
| **T-SEC12** | Lisensi semua dependensi ada di allowlist; SBOM tergenerate | PR & rilis |
| **T-SEC13** | `npm audit` high/critical = 0 | PR |
| **T-SEC14** | Tidak ada rahasia di repo/riwayat commit (pemindaian) | PR |
| **T-SEC15** | Rate limit & batas ukuran body berlaku di semua endpoint | PR |
| **T-SEC16** | Image ditandatangani & bisa diverifikasi | Rilis (mulai T3) |

Semua ini terhubung ke `testing-strategy.md` §4.9.

---

## 11. Yang belum ada (dinyatakan, bukan disembunyikan)

| Belum ada | Dampak | Rencana |
| :--- | :--- | :--- |
| Audit keamanan eksternal | Klaim keamanan belum diverifikasi pihak ketiga | Wajib sebelum gate R2 (`prd.md` §5) |
| Program bug bounty | Peneliti tidak punya insentif | Setelah ada pendanaan; kontak & kredit tetap tersedia |
| Sertifikasi (SOC 2/ISO) | Tidak bisa dipakai di procurement yang mensyaratkannya | Tidak direncanakan untuk R0–R2 |
| Build reproducible terverifikasi | Verifikasi independen belum mungkin | Target R2 |
| Pemindaian malware lampiran bawaan | Operator harus menyediakan sendiri | Opsional (`attachments-media.md` §6) |
| Pen-testing tahunan | Regresi keamanan tidak terdeteksi berkala | Setelah R2 |

---

## 12. Rujukan silang

- Lisensi & kompatibilitas dependensi: `architecture.md` ADR-014
- Uji keamanan: `testing-strategy.md` §4.9 (`T-SEC1`–`T-SEC16`)
- Model ancaman aplikasi: `architecture.md` §5
- Audit log: `prd.md` `FR-305`, `data-model.md` ENT-16
- Jalur upgrade (agar orang mau menambal): `migrations.md` §9
- Batas tanggung jawab hosting: `decisions-r0.md` D-01

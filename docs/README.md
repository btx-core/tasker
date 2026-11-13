# Kelindan — Cetak Biru Desain & Arsitektur

Direktori ini berisi dokumen **desain** (bukan implementasi). Tidak ada kode di sini. Tujuannya: setiap keputusan yang mahal diubah sudah diputuskan dan dicatat alasannya, sehingga engineer bisa mulai menulis kode tanpa rapat desain tambahan.

## Status desain

Per 2026-11-12, **seluruh 12 celah desain sudah ditutup** (`gaps-analysis.md`), dan dua dokumen prasyarat kode sudah ada (`repo-layout.md`, `versioning.md`). **Tidak ada lagi dokumen yang memblokir penulisan kode.** Yang tersisa bukan dokumen:

1. **Spike importer S1/S4** — butuh berkas ekspor Jira nyata (`spike-jira-importer.md` §2).
2. **Dua keputusan pemilik** — komitmen waktu & anggaran infrastruktur (`decisions-r0.md` §7).
3. **Validasi performa pada dataset acuan penuh** — butuh lingkungan uji, bukan dokumen (`prd.md` §7.1).
4. **Empat peran operasional + pengganti** yang benar-benar menjalankan tugasnya (`decisions-r0.md` D-02).

## Status dokumen

| Dokumen | Isi | Status |
| :--- | :--- | :--- |
| [`prd.md`](./prd.md) | PRD eksekutabel: persona, non-goals, requirement ber-ID + acceptance criteria, SLO terukur, gate rilis berbasis bukti | **Aktif** — sumber kebenaran lingkup |
| [`architecture.md`](./architecture.md) | Keputusan arsitektur (ADR-001…ADR-014), topologi, profil deployment, model ancaman cache klien | **Aktif** — sumber kebenaran teknis |
| [`data-model.md`](./data-model.md) | Kamus data Fase 1 siap-DDL: entitas, kolom, constraint, index, invariant, state machine | **Aktif** — sumber kebenaran skema |
| [`rbac.md`](./rbac.md) | Katalog aksi, peran, matriks permission, invariant, kasus uji | **Aktif** — sumber kebenaran otorisasi |
| [`repo-layout.md`](./repo-layout.md) | **Dokumen A** — tata letak repo, batas modul, kontrak perintah, konfigurasi, definisi "selesai" PR, alur git | **Aktif** — prasyarat kode |
| [`versioning.md`](./versioning.md) | **Dokumen B** — SemVer & janji tiap angka, saluran rilis, format catatan rilis, deprecation, konvensi kontribusi | **Aktif** — mengikat |
| [`support.md`](./support.md) | Dukungan: kanal & janji respons, triase P1–P5, bundle diagnostik aman, batas dukungan | **Aktif** — mengikat |
| [`i18n.md`](./i18n.md) | Internasionalisasi: satu bahasa tapi terpusat, format tanggal/zona waktu, triger bahasa kedua | **Aktif** — mengikat |
| [`security-policy.md`](./security-policy.md) | Kebijakan keamanan & supply chain: versi didukung, SLA respons, alur kerentanan, kebijakan dependensi, artefak rilis, insiden | **Aktif** — mengikat |
| [`onboarding.md`](./onboarding.md) | Menit pertama: instalasi, undangan, empty state (naskah), pratinjau impor, nada penulisan | **Aktif** — mengikat |
| [`realtime-and-search.md`](./realtime-and-search.md) | Perilaku real-time (K1/K2/K3, tepi kasus) & pencarian (bobot, query, izin, palette) | **Aktif** — mengikat |
| [`spike-jira-importer.md`](./spike-jira-importer.md) | Rancangan spike importer: spesifikasi ADF→Markdown, matriks pemetaan, fixture pegangan, kebutuhan data | **Aktif** — sebagian menunggu data |
| [`email.md`](./email.md) | Email keluar: 3 mode transport, deliverability, batas kirim, bounce/suppression, privasi subjek | **Aktif** — mengikat |
| [`attachments-media.md`](./attachments-media.md) | Lampiran & media: kompresi/thumbnail di klien, EXIF, HEIC, SVG, domain storage, batas | **Aktif** — mengikat |
| [`ux-principles.md`](./ux-principles.md) | Prinsip UX & anggaran "ringan" terukur: `UX-1…UX-10`, `UX-B1…UX-B10`, pintasan kanonik, anti-pola | **Aktif** — mengikat |
| [`editor-decision.md`](./editor-decision.md) | Keputusan editor: Markdown subset + editor visual terbatas, keamanan, konflik, batas, uji `T-EDIT` | **Aktif** — mengikat |
| [`migrations.md`](./migrations.md) | Aturan migrasi: forward-only, expand/contract, header wajib, runner, jalur upgrade self-host | **Aktif** — mengikat |
| [`api-contract.md`](./api-contract.md) | Kontrak API v1: bentuk respons, model error + enum `code`, patch field-level, idempotensi, paginasi cursor, 404 vs 403, real-time, lampiran | **Aktif** — mengikat |
| [`testing-strategy.md`](./testing-strategy.md) | Strategi pengujian: piramida, lingkungan, uji wajib `T-*`, uji konkurensi/chaos, uji performa, gerbang rilis | **Aktif** — mengikat |
| [`gaps-analysis.md`](./gaps-analysis.md) | Analisis celah jujur: 12 hal yang belum ada, dampaknya, dan urutan penutupannya | **Aktif** — rencana kerja |
| [`naming-and-validation.md`](./naming-and-validation.md) | Keputusan nama (Kelindan) + hasil validasi skema pada PostgreSQL nyata (V1–V11) | **Aktif** |
| [`decisions-r0.md`](./decisions-r0.md) | Keputusan operasi & go-to-market: model operasi, 4 peran, backup/restore, tahap GTM, batas open-core | **Aktif** — mengikat |
| [`import-contract.md`](./import-contract.md) | Kontrak importer Jira: pemetaan, taksonomi kegagalan L1–L5, kolom skema wajib, kriteria spike | **Aktif** — mengikat |
| [`prd-review.md`](./prd-review.md) | Review kritis atas cetak biru v0 ("Next-Jira") | **Arsip** — konteks, bukan spesifikasi |

Dokumen v0 tidak lagi menjadi acuan. Di mana dokumen v0 dan direktori ini berbeda, **direktori ini yang berlaku**.

## Urutan baca

1. `prd.md` §1–§4 — apa yang dibangun dan **apa yang secara sadar tidak dibangun**.
2. `prd.md` §7 — SLO dan dataset acuan (semua klaim performa diukur terhadap ini).
3. `architecture.md` — ADR-001 (arsitektur data klien), ADR-002 (hierarki), ADR-003 (otorisasi) adalah tiga keputusan fondasi; sisanya turunan.
4. `data-model.md` + `rbac.md` — spesifikasi yang langsung dipakai saat menulis migration dan middleware.
5. `decisions-r0.md` — siapa mengoperasikan, bagaimana backup dibuktikan, dan kapan boleh diumumkan.
6. `api-contract.md` + `testing-strategy.md` — bentuk API dan cara membuktikannya (menutup C2 & C3).
7. `migrations.md` + `editor-decision.md` — dua bloker terakhir sebelum kode (menutup C1 & C6).
8. `email.md` + `attachments-media.md` — dua celah yang akan terlihat sebagai "produk rusak" bila dilewati (C4 & C5).
9. `security-policy.md` — yang ditanyakan sysadmin sebelum produk ini boleh dipasang (C9).
10. `realtime-and-search.md` + `onboarding.md` — perilaku tepi real-time, pencarian, dan menit pertama (C7, C8, C11).
11. `spike-jira-importer.md` — apa yang bisa diselesaikan tanpa data Jira dan apa yang **tidak** (S1–S6).
12. `support.md` + `i18n.md` — dua celah terakhir (C10, C12).
13. `repo-layout.md` + `versioning.md` — **baca sebelum commit pertama**: struktur repo, batas modul, definisi "selesai", dan aturan rilis.
14. `ux-principles.md` — bagaimana "ramah, mudah, ringan" diukur, bukan diklaim.
15. `gaps-analysis.md` — apa yang belum ada dan urutan penutupannya (§6).
16. `import-contract.md` — **baca sebelum menulis migration pertama**: ia menambah kolom wajib pada `tasks`, `comments`, `attachments`, `task_events`.

## Konvensi ID

Semua requirement, invariant, aksi, dan keputusan punya ID stabil agar bisa dirujuk dari issue, test, dan PR:

- `FR-1xx` / `FR-2xx` / `FR-3xx` — functional requirement per fase (`prd.md`)
- `NFR-0xx` — non-functional requirement / SLO (`prd.md` §7)
- `NG-0x` — non-goal (`prd.md` §4)
- `ADR-0xx` — architecture decision record (`architecture.md`)
- `ENT-xx`, `INV-xx` — entitas dan invariant data (`data-model.md`)
- `AC-xx` — action ID pada katalog aksi (`rbac.md`)
- `TC-xx` — test case otorisasi (`rbac.md`)
- `T-xx` — uji wajib pada gerbang pipeline (`testing-strategy.md` §4–§6)
- `UX-n`, `UX-B*`, `UX-E*` — prinsip, anggaran, dan elemen UX yang mengikat (`ux-principles.md`)

Aturan traceability: setiap `FR-*` harus merujuk minimal satu `AC-*` dan satu `INV-*` (jika menyentuh data). PR yang menutup `FR-*` wajib menyebut ID-nya.

## Nama

Produk bernama **Kelindan** (dari bahasa Indonesia: benang yang melilitkan beberapa helai menjadi satu ikatan). Repository dan branch masih bernama `tasker`; penggantian nama repo adalah keputusan pemilik akun dan tidak memengaruhi dokumen. Alasan pemilihan & verifikasi kolisi nama: `naming-and-validation.md` §1.

## Lisensi

Proyek ini **AGPL-3.0-only** (lihat `../LICENSE`). Implikasi praktisnya dicatat di `architecture.md` ADR-014. Ringkasnya: AGPL dipilih untuk mencegah pihak ketiga menawarkan versi hosted tanpa membuka source; kewajiban §13 berlaku, sehingga aplikasi wajib menyediakan tautan "Source" di UI untuk pengguna jaringan.

## Cara mengubah dokumen ini

Dokumen ini adalah artefak hidup, tetapi **bukan** wiki. Perubahan aturan:

1. Keputusan yang berubah → tulis ADR baru bernomor lebih tinggi; ADR lama **tidak dihapus**, ditandai "Digantikan oleh ADR-0xx".
2. Requirement yang berubah → ubah di tempat, dan catat di §12 `prd.md` (Log Perubahan) beserta alasannya.
3. Non-goal yang dicabut → pindahkan ke `prd.md` §4.1 (Non-goals yang pernah ditinjau) dengan alasan pencabutan.

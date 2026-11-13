-- migration: 0021_schema_migrations
-- intent: Membuat tabel catatan migrasi yang dibaca runner (migrations.md §8).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: migrations.md §8 "Pencatatan"

-- Tabel ini dibuat PALING AKHIR, bukan paling awal, dan itu disengaja:
-- bila runner gagal di tengah migrasi sebelumnya, kita bisa melihat bahwa
-- tabel ini belum ada, artinya skema belum pernah dicatat sama sekali.
-- Alasan yang sama: tabel ini TIDAK ditulis oleh migrasi ini, melainkan oleh
-- runner saat migrasi 0001 dijalankan. Migrasi ini hanya menjamin bentuknya.
CREATE TABLE schema_migrations (
  version      integer     NOT NULL,
  name         text        NOT NULL,
  checksum     text        NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  duration_ms  integer     NOT NULL,
  app_version  text,

  CONSTRAINT pk_schema_migrations PRIMARY KEY (version),
  CONSTRAINT ck_schema_migrations_version CHECK (version >= 1),
  CONSTRAINT ck_schema_migrations_checksum
    CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_schema_migrations_duration CHECK (duration_ms >= 0)
);

-- Runner memeriksa celah: nomor 1..N harus lengkap. Query ini dipakai
-- `kelindan migrate` untuk mendeteksi migrasi yang hilang dari repo.
CREATE INDEX ix_schema_migrations_applied ON schema_migrations (applied_at);

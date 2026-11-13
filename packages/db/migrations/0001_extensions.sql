-- migration: 0001_extensions
-- intent: Memasang ekstensi minimum yang dibutuhkan skema (citext, pg_trgm, pgcrypto).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md §1 V1

-- IF NOT EXISTS wajib: sebagian instalasi sudah punya ekstensi ini
-- (dipasang operator untuk keperluan lain). Tanpa IF NOT EXISTS, migrasi gagal
-- di tempat yang seharusnya berhasil. Lihat migrations.md §5.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

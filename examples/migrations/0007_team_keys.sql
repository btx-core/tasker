-- migration: 0007_team_keys
-- intent: Membuat `team_keys` (counter penomoran manusiawi ENG-123).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-06

CREATE TABLE team_keys (
  team_id         uuid   NOT NULL,
  workspace_id    uuid   NOT NULL,
  next_number     bigint NOT NULL DEFAULT 1,
  -- Blok nomor yang sudah dipesan aplikasi. Dipakai untuk menghindari
  -- SELECT FOR UPDATE pada setiap pembuatan task.
  allocated_until bigint NOT NULL DEFAULT 0,

  CONSTRAINT pk_team_keys PRIMARY KEY (team_id),
  CONSTRAINT fk_team_keys_team FOREIGN KEY (team_id) REFERENCES teams (id),
  -- CATATAN KOREKSI (T5, demo-migrations-report.md):
  -- Versi pertama migrasi ini memuat
  --   CHECK (next_number >= allocated_until - 1000)
  -- yang SALAH: angka 1000 tidak berasal dari aturan apa pun, dan constraint
  -- itu bisa dilanggar secara sah saat counter sengaja direset. Constraint yang
  -- tidak menyatakan aturan bisnis nyata lebih buruk daripada tidak ada,
  -- karena memberi rasa aman palsu dan akhirnya dilonggarkan saat insiden.
  -- Kesahihan jendela blok adalah urusan logika pemesanan di kode, bukan CHECK.
  CONSTRAINT ck_team_keys_range CHECK (next_number >= 1 AND allocated_until >= 0)
);

-- Konsekuensi yang DITERIMA dan didokumentasikan: nomor bisa bolong bila
-- proses mati setelah memesan blok. Pengguna lebih memaafkan nomor yang
-- hilang daripada antrean pembuatan task.

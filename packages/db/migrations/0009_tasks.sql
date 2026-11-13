-- migration: 0009_tasks
-- intent: Membuat `tasks` - entitas inti - beserta pencarian teks dan indeks board.
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: s
-- backfill: none
-- docs: data-model.md ENT-08

CREATE TABLE tasks (
  id               uuid        NOT NULL,
  workspace_id     uuid        NOT NULL,
  team_id          uuid        NOT NULL,
  number           bigint      NOT NULL,
  title            text        NOT NULL,
  description      text,
  -- 1=markdown-v1 (editor-decision.md §3.1). Ditambahkan dari awal agar
  -- format kedua (R1) tidak butuh migrasi berisiko pada tabel terbesar.
  description_format smallint NOT NULL DEFAULT 1,
  -- Generated column, BUKAN trigger (diverifikasi V7).
  -- to_tsvector('simple', ...) dipakai karena stemming bahasa Indonesia
  -- tidak tersedia di Postgres standar dan hasilnya mengejutkan.
  description_tsv  tsvector GENERATED ALWAYS AS (
                     to_tsvector('simple',
                       coalesce(title, '') || ' ' || coalesce(description, ''))
                   ) STORED,
  -- 1=Tugas, 2=Bug, 3=Permintaan, 4=Insiden
  category         smallint    NOT NULL DEFAULT 1,
  status_id        uuid        NOT NULL,
  -- 0=tidak ada, 1=rendah, 2=sedang, 3=tinggi, 4=mendesak
  priority         smallint    NOT NULL DEFAULT 0,
  effort           smallint,
  assignee_id      uuid,
  created_by       uuid        NOT NULL,
  -- Tanggal kalender, SENGAJA tanpa zona: "jatuh tempo 15 Nov" harus tetap
  -- 15 Nov di Jakarta maupun Berlin (S5, i18n.md §3).
  due_date         date,
  -- First-touch: hanya diisi bila null, tidak pernah ditimpa (INV-07).
  started_at       timestamptz,
  completed_at     timestamptz,
  canceled_at      timestamptz,
  -- Kolom R1 yang sudah ada di R0 agar tidak perlu migrasi ulang pada tabel
  -- terbesar. NULL berarti "belum dijadwalkan".
  goal_id          uuid,
  cycle_id         uuid,
  -- Jejak impor (import-contract.md). source_raw WAJIB agar konversi lossy
  -- bisa diperbaiki kelak tanpa ekspor ulang dari Jira.
  source_system       smallint,
  source_instance_id  text,
  source_id           text,
  source_raw          jsonb,
  reconstructed       boolean     NOT NULL DEFAULT false,
  imported_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- ADR-015: versi dinaikkan tepat 1 pada setiap mutasi yang mengubah kolom
  -- yang dapat diedit. Dasar resolusi konflik.
  version          integer     NOT NULL DEFAULT 1,
  deleted_at       timestamptz,

  CONSTRAINT pk_tasks PRIMARY KEY (id),
  CONSTRAINT fk_tasks_team FOREIGN KEY (team_id) REFERENCES teams (id),
  CONSTRAINT fk_tasks_status FOREIGN KEY (status_id) REFERENCES statuses (id),
  CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES users (id),
  CONSTRAINT fk_tasks_created_by FOREIGN KEY (created_by) REFERENCES users (id),

  CONSTRAINT ck_tasks_number_pos CHECK (number >= 1),
  CONSTRAINT ck_tasks_title_len CHECK (char_length(title) BETWEEN 1 AND 300),
  CONSTRAINT ck_tasks_description_len CHECK (description IS NULL OR char_length(description) <= 102400),
  CONSTRAINT ck_tasks_category CHECK (category IN (1, 2, 3, 4)),
  CONSTRAINT ck_tasks_priority CHECK (priority IN (0, 1, 2, 3, 4)),
  CONSTRAINT ck_tasks_effort CHECK (effort IS NULL OR effort > 0),
  CONSTRAINT ck_tasks_version CHECK (version >= 1),
  CONSTRAINT ck_tasks_description_format CHECK (description_format IN (1)),
  CONSTRAINT ck_tasks_source_system CHECK (source_system IS NULL OR source_system IN (1)),
  -- Sumber impor harus lengkap: tanpa instance_id + source_id, idempotensi
  -- impor tidak mungkin (IC-8). Setengah data lebih buruk daripada tidak ada.
  CONSTRAINT ck_tasks_source_complete CHECK (
    source_system IS NULL
    OR (source_instance_id IS NOT NULL AND source_id IS NOT NULL)
  ),

  CONSTRAINT uq_tasks_team_number UNIQUE (team_id, number)
);

-- Board & list default: query paling panas (NFR-004).
--
-- ARAH `id DESC` ITU WAJIB, BUKAN HIASAN. Versi pertama index ini memakai
-- `id` (ASC bawaan), sementara board mengurutkan `updated_at DESC, id DESC`.
-- PostgreSQL tidak bisa memakai index untuk campuran arah itu, sehingga ia
-- menambahkan `Incremental Sort` di atas 7.200 baris per kolom — terlihat
-- langsung di EXPLAIN, dan itulah yang membuat P2-04 gagal (p95 ~900 ms di
-- PGlite pada 50 rb task). Setelah arah `id` disamakan, rencananya menjadi
-- `Index Only Scan` + `Limit`, tanpa Sort sama sekali.
--
-- Pelajaran: "index sudah ada" tidak sama dengan "index dipakai".
CREATE INDEX ix_tasks_board
  ON tasks (workspace_id, team_id, status_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- "Tugas saya".
CREATE INDEX ix_tasks_assignee
  ON tasks (workspace_id, assignee_id, status_id)
  WHERE deleted_at IS NULL AND assignee_id IS NOT NULL;

-- Resolusi ENG-123 (pencarian nomor harus instan, realtime-and-search.md §6).
CREATE INDEX ix_tasks_ws_team_number
  ON tasks (workspace_id, team_id, number);

-- Tampilan tenggat & pengingat.
CREATE INDEX ix_tasks_due
  ON tasks (workspace_id, due_date)
  WHERE deleted_at IS NULL AND completed_at IS NULL AND due_date IS NOT NULL;

-- Progress Goal (R1).
CREATE INDEX ix_tasks_goal
  ON tasks (workspace_id, goal_id)
  WHERE goal_id IS NOT NULL AND deleted_at IS NULL;

-- Cycle view (R1).
CREATE INDEX ix_tasks_cycle
  ON tasks (workspace_id, cycle_id)
  WHERE cycle_id IS NOT NULL AND deleted_at IS NULL;

-- Pencarian penuh (ADR-005).
CREATE INDEX ix_tasks_tsv ON tasks USING gin (description_tsv);

-- Pencarian judul dengan salah ketik.
CREATE INDEX ix_tasks_title_trgm ON tasks USING gin (title gin_trgm_ops);

-- Idempotensi impor (IC-8): satu issue Jira tidak bisa masuk dua kali.
CREATE UNIQUE INDEX uq_tasks_source
  ON tasks (workspace_id, source_system, source_instance_id, source_id)
  WHERE source_system IS NOT NULL;

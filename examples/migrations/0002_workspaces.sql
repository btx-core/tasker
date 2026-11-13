-- migration: 0002_workspaces
-- intent: Membuat tabel akar tenant `workspaces` beserta counter delta `seq_next`.
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-01

CREATE TABLE workspaces (
  id          uuid        NOT NULL,
  name        text        NOT NULL,
  slug        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer     NOT NULL DEFAULT 1,
  -- Counter delta real-time (ENT-17). Satu-satunya penjaga urutan per workspace.
  seq_next    bigint      NOT NULL DEFAULT 1,
  deleted_at  timestamptz,
  settings    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT pk_workspaces PRIMARY KEY (id),
  CONSTRAINT ck_workspaces_name_len  CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT ck_workspaces_slug_form CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  CONSTRAINT ck_workspaces_version   CHECK (version >= 1),
  CONSTRAINT ck_workspaces_seq_next  CHECK (seq_next >= 1)
);

-- Slug boleh dipakai ulang SETELAH workspace dihapus (soft delete).
-- Karena itu partial index, bukan UNIQUE biasa.
CREATE UNIQUE INDEX uq_workspaces_slug
  ON workspaces (slug)
  WHERE deleted_at IS NULL;

-- Untuk job purge (NFR-013: soft delete 30 hari).
CREATE INDEX ix_workspaces_purge
  ON workspaces (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- CATATAN: workspace demo TIDAK dibuat oleh migrasi (migrations.md §6).
-- Pembuatan workspace demo adalah perintah CLI terpisah, dan tanda
-- `is_demo` sengaja TIDAK dijadikan kolom: ia dapat diturunkan dari slug
-- berawalan `demo-`, dan kolom yang hanya dipakai satu fitur adalah
-- kolom yang akan salah ditebak maknanya enam bulan kemudian.

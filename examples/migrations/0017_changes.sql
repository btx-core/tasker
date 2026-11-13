-- migration: 0017_changes
-- intent: Membuat `changes` - log delta real-time, plus penjaga ukuran payload (ADR-017).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-17

CREATE TABLE changes (
  workspace_id uuid        NOT NULL,
  seq          bigint      NOT NULL,
  -- 1=task 2=comment 3=status 4=team 5=goal 6=checklist 7=label
  entity_type  smallint    NOT NULL,
  entity_id    uuid        NOT NULL,
  -- Untuk filter langganan per tim (realtime-and-search.md §1).
  team_id      uuid,
  -- 1=upsert, 2=delete
  op           smallint    NOT NULL,
  -- Versi entitas setelah perubahan (ADR-015).
  version      integer,
  -- PATCH MINIMAL, bukan entitas penuh.
  payload      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_changes PRIMARY KEY (workspace_id, seq),
  CONSTRAINT fk_changes_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT ck_changes_seq CHECK (seq >= 1),
  CONSTRAINT ck_changes_entity_type CHECK (entity_type BETWEEN 1 AND 7),
  CONSTRAINT ck_changes_op CHECK (op IN (1, 2)),
  -- BATAS KERAS (ADR-017): payload maksimum 4 KB. Alasan bukan estetika:
  -- pg_notify gagal pada payload >= 8000 byte DI DALAM TRANSAKSI (V8),
  -- sehingga satu deskripsi panjang bisa menggagalkan penyimpanan.
  -- Payload hanya membawa (workspace_id, seq); sisanya dibaca dari tabel ini.
  CONSTRAINT ck_changes_payload_size
    CHECK (payload IS NULL OR pg_column_size(payload) <= 4096)
);

-- Pemangkas delta (retensi minimum 24 jam; lebih lama = bootstrap ulang).
CREATE INDEX ix_changes_created ON changes (created_at);

-- Klien yang baru tersambung membaca delta per tim.
CREATE INDEX ix_changes_team
  ON changes (workspace_id, team_id, seq)
  WHERE team_id IS NOT NULL;

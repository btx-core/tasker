-- migration: 0005_teams
-- intent: Membuat `teams`, pemegang toggle fitur per tim (ADR-007).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-04

CREATE TABLE teams (
  id                 uuid        NOT NULL,
  workspace_id       uuid        NOT NULL,
  name               text        NOT NULL,
  -- Bagian dari ENG-123. 2-6 huruf besar.
  key                text        NOT NULL,
  description        text,
  -- Toggle disimpan sebagai kolom eksplisit, BUKAN jsonb: harus bisa
  -- di-query dan di-index, dan menambah toggle = migrasi aditif.
  feat_cycles        boolean     NOT NULL DEFAULT false,
  feat_goals         boolean     NOT NULL DEFAULT true,
  feat_effort        boolean     NOT NULL DEFAULT false,
  feat_dependencies  boolean     NOT NULL DEFAULT true,
  feat_timeline      boolean     NOT NULL DEFAULT false,
  feat_time_tracking boolean     NOT NULL DEFAULT false,
  feat_releases      boolean     NOT NULL DEFAULT false,
  feat_capacity      boolean     NOT NULL DEFAULT false,
  -- 1=fibonacci(1,2,3,5,8), 2=kaos(S,M,L,XL)
  effort_scale       smallint    NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer     NOT NULL DEFAULT 1,
  deleted_at         timestamptz,

  CONSTRAINT pk_teams PRIMARY KEY (id),
  CONSTRAINT fk_teams_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT ck_teams_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT ck_teams_key_form CHECK (key ~ '^[A-Z]{2,6}$'),
  CONSTRAINT ck_teams_effort_scale CHECK (effort_scale IN (1, 2)),
  CONSTRAINT ck_teams_version CHECK (version >= 1)
);

-- Key tim boleh dipakai ulang setelah tim dihapus, dan tidak boleh bentrok
-- antar workspace? BENTROK BOLEH: ENG di dua workspace berbeda adalah hal wajar.
CREATE UNIQUE INDEX uq_teams_ws_key
  ON teams (workspace_id, key)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_teams_ws ON teams (workspace_id) WHERE deleted_at IS NULL;

-- migration: 0004_workspace_members
-- intent: Membuat `workspace_members` (peran user di dalam workspace).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-03

CREATE TABLE workspace_members (
  id           uuid        NOT NULL,
  workspace_id uuid        NOT NULL,
  user_id      uuid        NOT NULL,
  -- 1=owner, 2=admin, 3=member (rbac.md)
  role         smallint    NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Dicabut != dihapus: baris tetap ada untuk audit.
  revoked_at   timestamptz,

  CONSTRAINT pk_workspace_members PRIMARY KEY (id),
  CONSTRAINT fk_workspace_members_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_workspace_members_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT ck_workspace_members_role CHECK (role IN (1, 2, 3))
);

-- Satu baris per (workspace, user) — bukan partial, agar user yang dicabut
-- tidak bisa punya dua baris dan membingungkan pembaca riwayat.
CREATE UNIQUE INDEX uq_workspace_members_ws_user
  ON workspace_members (workspace_id, user_id);

-- Query "workspace apa saja milik user ini" (layar awal setelah login).
CREATE INDEX ix_workspace_members_user_active
  ON workspace_members (user_id)
  WHERE revoked_at IS NULL;

-- INV-01 (setiap workspace punya >= 1 owner aktif) TIDAK bisa dinyatakan
-- sebagai CHECK sederhana: butuh agregat lintas baris. Ditegakkan aplikasi
-- + job pemeriksa harian (data-model.md ENT-03).

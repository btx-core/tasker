-- migration: 0006_team_members
-- intent: Membuat `team_members` (peran user di dalam tim).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-05

CREATE TABLE team_members (
  id           uuid        NOT NULL,
  -- Denormalisasi disengaja (S2): index komposit selalu diawali workspace_id.
  workspace_id uuid        NOT NULL,
  team_id      uuid        NOT NULL,
  user_id      uuid        NOT NULL,
  -- 1=admin_tim, 2=member, 3=commenter, 4=viewer
  role         smallint    NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,

  CONSTRAINT pk_team_members PRIMARY KEY (id),
  CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES teams (id),
  -- FK komposit: user HARUS sudah jadi anggota workspace ini (T2).
  -- Klaim lama "tidak bisa dinyatakan sebagai FK" terlalu luas. Yang tidak
  -- bisa dinyatakan adalah bagian "AKTIF" (revoked_at bisa berubah tanpa
  -- menyentuh baris ini) - itu tetap urusan aplikasi + job pemeriksa.
  -- Tetapi bagian "punya workspace_members" sepenuhnya bisa, dan itu yang
  -- mencegah mayoritas bug nyata: seseorang ditambahkan ke tim di workspace
  -- yang belum pernah ia masuki.
  CONSTRAINT fk_team_members_workspace_member
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_members (workspace_id, user_id),
  CONSTRAINT ck_team_members_role CHECK (role IN (1, 2, 3, 4))
);

CREATE UNIQUE INDEX uq_team_members_team_user
  ON team_members (team_id, user_id);

CREATE INDEX ix_team_members_user_active
  ON team_members (workspace_id, user_id)
  WHERE revoked_at IS NULL;

-- INV-03 (team_members hanya boleh ada bila user punya workspace_members
-- aktif di workspace yang sama) butuh join lintas tabel yang tidak bisa
-- dinyatakan sebagai FK/CHECK. Ditegakkan aplikasi + job pemeriksa harian.
-- Dinyatakan terbuka, bukan diabaikan.

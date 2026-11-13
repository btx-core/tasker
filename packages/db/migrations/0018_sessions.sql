-- migration: 0018_sessions
-- intent: Membuat `sessions` dengan token-hash dan epoch pencabutan global (FR-112).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-18

CREATE TABLE sessions (
  id           uuid        NOT NULL,
  -- NULL untuk sesi sebelum workspace dipilih.
  workspace_id uuid,
  user_id      uuid        NOT NULL,
  -- SHA-256 dari token acak 256-bit. Token asli TIDAK PERNAH disimpan:
  -- dump database tidak boleh menjadi daftar sesi yang bisa dipakai.
  token_hash   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Diperbarui maksimal 1x/5 menit (menghindari write amplification).
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  -- Salinan users.session_epoch saat dibuat. epoch lebih lama => ditolak.
  epoch        integer     NOT NULL,
  ip           inet,
  user_agent   text,

  CONSTRAINT pk_sessions PRIMARY KEY (id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT ck_sessions_token_hash_form CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_sessions_expires CHECK (expires_at > created_at),
  CONSTRAINT ck_sessions_epoch CHECK (epoch >= 0)
);

CREATE UNIQUE INDEX uq_sessions_token_hash ON sessions (token_hash);

CREATE INDEX ix_sessions_user_revoke ON sessions (user_id, revoked_at);

CREATE INDEX ix_sessions_expiry
  ON sessions (expires_at)
  WHERE revoked_at IS NULL;

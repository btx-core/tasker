-- migration: 0016_audit_events
-- intent: Membuat `audit_events` untuk jejak administratif (kepatuhan).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-16

CREATE TABLE audit_events (
  id               uuid        NOT NULL,
  -- NULL untuk aksi pra-login (mis. login gagal): tidak ada tenant.
  workspace_id     uuid,
  -- NULL = sistem.
  actor_id         uuid,
  actor_ip         inet,
  actor_user_agent text,
  -- ID aksi dari rbac.md, mis. 'workspace.member.role_changed'.
  action           text        NOT NULL,
  target_type      text,
  target_id        uuid,
  -- TANPA rahasia, TANPA isi konten pengguna. Ditegakkan di lapisan penulisan.
  metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_audit_events PRIMARY KEY (id),
  CONSTRAINT fk_audit_events_actor FOREIGN KEY (actor_id) REFERENCES users (id),
  CONSTRAINT ck_audit_events_action_len CHECK (char_length(action) BETWEEN 1 AND 120),
  CONSTRAINT ck_audit_events_ua_len
    CHECK (actor_user_agent IS NULL OR char_length(actor_user_agent) <= 300),
  CONSTRAINT ck_audit_events_action_form
    CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

CREATE INDEX ix_audit_events_ws_time
  ON audit_events (workspace_id, created_at DESC);

CREATE INDEX ix_audit_events_ws_action
  ON audit_events (workspace_id, action, created_at DESC);

CREATE INDEX ix_audit_events_actor
  ON audit_events (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

-- migration: 0020_jobs
-- intent: Membuat `jobs` - antrean kerja in-process berbasis SKIP LOCKED (ADR-008).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-20

CREATE TABLE jobs (
  id           uuid        NOT NULL,
  workspace_id uuid,
  -- mis. notify.mention, webhook.send, cycle.rollover, attachment.gc, export.build
  kind         text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  run_after    timestamptz NOT NULL DEFAULT now(),
  attempts     smallint    NOT NULL DEFAULT 0,
  max_attempts smallint    NOT NULL DEFAULT 8,
  locked_until timestamptz,
  locked_by    text,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  CONSTRAINT pk_jobs PRIMARY KEY (id),
  CONSTRAINT ck_jobs_kind_form CHECK (kind ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT ck_jobs_attempts CHECK (attempts >= 0 AND attempts <= max_attempts),
  CONSTRAINT ck_jobs_max_attempts CHECK (max_attempts BETWEEN 1 AND 100),
  -- Job yang terkunci harus menyebut siapa yang mengunci; kalau tidak,
  -- lock yang tertinggal tidak bisa didiagnosis.
  CONSTRAINT ck_jobs_lock_complete
    CHECK ((locked_until IS NULL) = (locked_by IS NULL))
);

-- Inti poll SKIP LOCKED: hanya job yang belum selesai dan sudah waktunya.
CREATE INDEX ix_jobs_ready
  ON jobs (run_after)
  WHERE completed_at IS NULL;

-- Untuk query "job yang macet" di halaman status admin (support.md §5).
CREATE INDEX ix_jobs_stuck
  ON jobs (locked_until)
  WHERE completed_at IS NULL AND locked_until IS NOT NULL;

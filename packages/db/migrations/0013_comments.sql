-- migration: 0013_comments
-- intent: Membuat `comments` dan `comment_revisions` (bukti "diedit", FR-108).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-12, ENT-13

CREATE TABLE comments (
  id              uuid        NOT NULL,
  workspace_id    uuid        NOT NULL,
  task_id         uuid        NOT NULL,
  author_id       uuid        NOT NULL,
  body            text        NOT NULL,
  body_format     smallint    NOT NULL DEFAULT 1,
  body_tsv        tsvector GENERATED ALWAYS AS (
                    to_tsvector('simple', coalesce(body, ''))
                  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  source_id       text,
  source_raw      jsonb,
  imported_at     timestamptz,

  CONSTRAINT pk_comments PRIMARY KEY (id),
  CONSTRAINT fk_comments_task FOREIGN KEY (task_id) REFERENCES tasks (id),
  CONSTRAINT fk_comments_author FOREIGN KEY (author_id) REFERENCES users (id),
  CONSTRAINT ck_comments_body_len CHECK (char_length(body) BETWEEN 1 AND 16384),
  CONSTRAINT ck_comments_body_format CHECK (body_format IN (1)),
  -- edited_at harus ada bila revisi disimpan; ini mencegah "diedit" tanpa bukti.
  CONSTRAINT ck_comments_edited_after_created
    CHECK (edited_at IS NULL OR edited_at >= created_at)
);

-- Thread pada detail task.
CREATE INDEX ix_comments_task ON comments (task_id, created_at);

-- Pencarian komentar (realtime-and-search.md §6: bobot terendah, tetap dicari).
CREATE INDEX ix_comments_tsv ON comments USING gin (body_tsv);

CREATE TABLE comment_revisions (
  id           uuid        NOT NULL,
  comment_id   uuid        NOT NULL,
  workspace_id uuid        NOT NULL,
  body         text        NOT NULL,
  edited_by    uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_comment_revisions PRIMARY KEY (id),
  CONSTRAINT fk_comment_revisions_comment FOREIGN KEY (comment_id) REFERENCES comments (id),
  CONSTRAINT ck_comment_revisions_body_len CHECK (char_length(body) BETWEEN 1 AND 16384)
);

CREATE INDEX ix_comment_revisions_comment
  ON comment_revisions (comment_id, created_at DESC);

-- Append-only (S7): revisi tidak pernah diubah. Ditegakkan dengan mencabut
-- hak UPDATE/DELETE dari peran aplikasi (dilakukan pada migrasi peran, bukan
-- di sini, karena peran belum ada saat migrasi ini dijalankan).

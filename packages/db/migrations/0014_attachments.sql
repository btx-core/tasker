-- migration: 0014_attachments
-- intent: Membuat `attachments` dengan kunci terpisah per varian (ADR-022).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-14, attachments-media.md §7

CREATE TABLE attachments (
  id              uuid        NOT NULL,
  workspace_id    uuid        NOT NULL,
  task_id         uuid        NOT NULL,
  comment_id      uuid,
  uploader_id     uuid        NOT NULL,
  file_name       text        NOT NULL,
  content_type    text        NOT NULL,
  size_bytes      bigint      NOT NULL,
  -- storage_key tunggal dari desain lama DIGANTI tiga kunci: satu kunci
  -- tunggal memaksa semua klien mengunduh ukuran penuh.
  storage_key     text        NOT NULL,
  checksum_sha256 text        NOT NULL,
  thumb_key       text,
  display_key     text,
  original_key    text,
  width           integer,
  height          integer,
  blurhash        text,
  dominant_color  text,
  -- 1=pending_upload, 2=ready, 3=failed, 4=expired
  state           smallint    NOT NULL DEFAULT 1,
  source_url      text,
  -- 1=berhasil, 2=gagal sementara, 3=dilewati (mis. melebihi batas)
  import_status   smallint,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_attachments PRIMARY KEY (id),
  CONSTRAINT fk_attachments_task FOREIGN KEY (task_id) REFERENCES tasks (id),
  CONSTRAINT fk_attachments_comment FOREIGN KEY (comment_id) REFERENCES comments (id),
  CONSTRAINT fk_attachments_uploader FOREIGN KEY (uploader_id) REFERENCES users (id),
  CONSTRAINT ck_attachments_file_name_len CHECK (char_length(file_name) BETWEEN 1 AND 255),
  CONSTRAINT ck_attachments_size
    CHECK (size_bytes > 0 AND size_bytes <= 104857600),
  CONSTRAINT ck_attachments_state CHECK (state IN (1, 2, 3, 4)),
  CONSTRAINT ck_attachments_import_status
    CHECK (import_status IS NULL OR import_status IN (1, 2, 3)),
  CONSTRAINT ck_attachments_comment_has_task
    CHECK (comment_id IS NULL OR task_id IS NOT NULL),
  CONSTRAINT ck_attachments_checksum_form
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX ix_attachments_task ON attachments (workspace_id, task_id);
CREATE INDEX ix_attachments_comment
  ON attachments (comment_id)
  WHERE comment_id IS NOT NULL;
-- Job pembersih: unggahan yang tidak pernah selesai.
CREATE INDEX ix_attachments_pending
  ON attachments (created_at)
  WHERE state = 1;

-- INV-09: storage_key tidak pernah dikirim ke klien; ditegakkan di lapisan
-- serialisasi DTO (T7), bukan di DB - kolomnya sendiri harus ada di sini.

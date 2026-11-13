-- migration: 0019_idempotency_keys
-- intent: Membuat `idempotency_keys` agar retry tidak menggandakan mutasi (ADR-015).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-19

CREATE TABLE idempotency_keys (
  actor_id       uuid        NOT NULL,
  -- ULID yang dikirim klien, disimpan sebagai uuid.
  operation_id   uuid        NOT NULL,
  endpoint       text        NOT NULL,
  -- Hash dari body permintaan. Bila operation_id sama tapi hash berbeda -> 409.
  request_hash   text        NOT NULL,
  response_status smallint   NOT NULL,
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_idempotency_keys PRIMARY KEY (actor_id, operation_id),
  CONSTRAINT fk_idempotency_keys_actor FOREIGN KEY (actor_id) REFERENCES users (id),
  CONSTRAINT ck_idempotency_keys_endpoint_len
    CHECK (char_length(endpoint) BETWEEN 1 AND 200),
  CONSTRAINT ck_idempotency_keys_status
    CHECK (response_status BETWEEN 100 AND 599)
);

-- Pemangkas (retensi 24 jam).
CREATE INDEX ix_idempotency_keys_created ON idempotency_keys (created_at);

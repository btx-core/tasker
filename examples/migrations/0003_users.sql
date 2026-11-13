-- migration: 0003_users
-- intent: Membuat `users` (identitas global lintas workspace).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-02

CREATE TABLE users (
  id                uuid        NOT NULL,
  email             citext      NOT NULL,
  email_verified_at timestamptz,
  display_name      text        NOT NULL,
  -- NULL bila akun hanya memakai SSO/OAuth (R2) atau akun placeholder importer.
  password_hash     text,
  avatar_url        text,
  locale            text        NOT NULL DEFAULT 'id-ID',
  timezone          text        NOT NULL DEFAULT 'Asia/Jakarta',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer     NOT NULL DEFAULT 1,
  deleted_at        timestamptz,
  external_identity text,
  is_placeholder    boolean     NOT NULL DEFAULT false,
  -- Dinaikkan saat "cabut semua sesi" (FR-112).
  session_epoch     integer     NOT NULL DEFAULT 0,

  CONSTRAINT pk_users PRIMARY KEY (id),
  CONSTRAINT ck_users_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 100),
  CONSTRAINT ck_users_version CHECK (version >= 1),
  CONSTRAINT ck_users_session_epoch CHECK (session_epoch >= 0),
  -- Akun placeholder TIDAK boleh punya kata sandi; akun non-placeholder boleh
  -- tanpa kata sandi (SSO). Ini mencegah "placeholder yang bisa login".
  CONSTRAINT ck_users_placeholder_no_password
    CHECK (NOT is_placeholder OR password_hash IS NULL)
);

CREATE UNIQUE INDEX uq_users_email ON users (email);

-- Job pengingat verifikasi.
CREATE INDEX ix_users_unverified
  ON users (created_at)
  WHERE email_verified_at IS NULL AND deleted_at IS NULL;

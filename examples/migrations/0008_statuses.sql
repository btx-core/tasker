-- migration: 0008_statuses
-- intent: Membuat `statuses` dengan 5 kategori tetap dan tepat satu default per tim.
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-07

CREATE TABLE statuses (
  id           uuid        NOT NULL,
  workspace_id uuid        NOT NULL,
  team_id      uuid        NOT NULL,
  name         text        NOT NULL,
  -- 1=Antrean, 2=Siap, 3=Dikerjakan, 4=Selesai, 5=Dibatalkan.
  -- Kategori TIDAK bisa ditambah (NG-03) - ini yang membuat metrik lintas
  -- tim bisa dibandingkan.
  category     smallint    NOT NULL,
  position     integer     NOT NULL,
  is_default   boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,

  CONSTRAINT pk_statuses PRIMARY KEY (id),
  CONSTRAINT fk_statuses_team FOREIGN KEY (team_id) REFERENCES teams (id),
  CONSTRAINT ck_statuses_name_len CHECK (char_length(name) BETWEEN 1 AND 40),
  CONSTRAINT ck_statuses_category CHECK (category IN (1, 2, 3, 4, 5)),
  CONSTRAINT ck_statuses_position CHECK (position >= 0),
  -- Status default yang diarsipkan adalah kontradiksi: INV-05 mensyaratkan
  -- tepat satu default AKTIF. Ini mencegah keadaan mustahil masuk ke DB.
  CONSTRAINT ck_statuses_default_not_archived
    CHECK (NOT is_default OR archived_at IS NULL)
);

-- Nama unik per tim, hanya untuk yang belum diarsipkan.
CREATE UNIQUE INDEX uq_statuses_team_name
  ON statuses (team_id, name)
  WHERE archived_at IS NULL;

-- Urutan kolom unik per tim, hanya untuk yang belum diarsipkan.
CREATE UNIQUE INDEX uq_statuses_team_position
  ON statuses (team_id, position)
  WHERE archived_at IS NULL;

-- INV-05: tepat SATU status default aktif per tim.
-- Dinyatakan sebagai unique partial index, bukan trigger - ini yang membuat
-- invariant ini tidak bisa dilanggar sama sekali, termasuk oleh bug aplikasi.
CREATE UNIQUE INDEX uq_statuses_team_single_default
  ON statuses (team_id)
  WHERE is_default AND archived_at IS NULL;

-- Board: kolom dikelompokkan per kategori, diurutkan.
CREATE INDEX ix_statuses_team_category
  ON statuses (team_id, category, position)
  WHERE archived_at IS NULL;

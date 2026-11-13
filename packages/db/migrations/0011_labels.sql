-- migration: 0011_labels
-- intent: Membuat `labels` dan `task_labels` beserta penjaga satu-tim (INV-08).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-09, ENT-10

CREATE TABLE labels (
  id           uuid        NOT NULL,
  workspace_id uuid        NOT NULL,
  team_id      uuid        NOT NULL,
  name         text        NOT NULL,
  -- 7 karakter hex (#RRGGBB)
  color        text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,

  CONSTRAINT pk_labels PRIMARY KEY (id),
  CONSTRAINT fk_labels_team FOREIGN KEY (team_id) REFERENCES teams (id),
  CONSTRAINT ck_labels_name_len CHECK (char_length(name) BETWEEN 1 AND 40),
  CONSTRAINT ck_labels_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- Case-insensitive per tim: "Backend" dan "backend" adalah label yang sama.
CREATE UNIQUE INDEX uq_labels_team_name
  ON labels (team_id, lower(name))
  WHERE archived_at IS NULL;

CREATE TABLE task_labels (
  workspace_id uuid        NOT NULL,
  task_id      uuid        NOT NULL,
  label_id     uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_task_labels PRIMARY KEY (task_id, label_id),
  CONSTRAINT fk_task_labels_task FOREIGN KEY (task_id) REFERENCES tasks (id),
  CONSTRAINT fk_task_labels_label FOREIGN KEY (label_id) REFERENCES labels (id)
);

-- Untuk "semua task berlabel X".
CREATE INDEX ix_task_labels_label ON task_labels (workspace_id, label_id);

-- INV-08: label dan task harus satu tim. Alasan sama dengan status:
-- ini kebocoran lintas-tim, jadi ditegakkan di DB.
CREATE OR REPLACE FUNCTION task_labels_guard_team_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  task_team  uuid;
  label_team uuid;
BEGIN
  SELECT t.team_id INTO task_team FROM tasks t WHERE t.id = NEW.task_id;
  SELECT l.team_id INTO label_team FROM labels l WHERE l.id = NEW.label_id;

  IF task_team IS DISTINCT FROM label_team THEN
    RAISE EXCEPTION
      'label % milik tim %, task % milik tim %', NEW.label_id, label_team, NEW.task_id, task_team
      USING ERRCODE = 'check_violation',
            HINT = 'Label dan task harus satu tim (INV-08).';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_labels_guard_team
  BEFORE INSERT OR UPDATE ON task_labels
  FOR EACH ROW EXECUTE FUNCTION task_labels_guard_team_consistency();

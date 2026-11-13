-- migration: 0012_checklist_items
-- intent: Membuat `checklist_items` - pemecahan task tanpa status (NG-05).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-11

CREATE TABLE checklist_items (
  id                uuid        NOT NULL,
  workspace_id      uuid        NOT NULL,
  task_id           uuid        NOT NULL,
  content           text        NOT NULL,
  is_done           boolean     NOT NULL DEFAULT false,
  assignee_id       uuid,
  due_date          date,
  position          integer     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  converted_task_id uuid,

  CONSTRAINT pk_checklist_items PRIMARY KEY (id),
  CONSTRAINT fk_checklist_items_task FOREIGN KEY (task_id) REFERENCES tasks (id),
  CONSTRAINT fk_checklist_items_assignee FOREIGN KEY (assignee_id) REFERENCES users (id),
  CONSTRAINT fk_checklist_items_converted FOREIGN KEY (converted_task_id) REFERENCES tasks (id),
  CONSTRAINT ck_checklist_items_content_len CHECK (char_length(content) BETWEEN 1 AND 500),
  CONSTRAINT ck_checklist_items_position CHECK (position >= 0)
);

-- Urutan item dalam satu task.
CREATE UNIQUE INDEX uq_checklist_items_position
  ON checklist_items (task_id, position);

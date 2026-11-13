-- migration: 0015_task_events
-- intent: Membuat `task_events` - tabel paling penting di R0 (ADR-004, ADR-006).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-15

CREATE TABLE task_events (
  id            uuid        NOT NULL,
  workspace_id  uuid        NOT NULL,
  team_id       uuid        NOT NULL,
  task_id       uuid        NOT NULL,
  -- Urutan per workspace. Counter yang SAMA dengan `changes.seq`
  -- (workspaces.seq_next) - satu counter, bukan dua.
  seq           bigint      NOT NULL,
  -- NULL = sistem (impor, otomasi, rollover).
  actor_id      uuid,
  -- 1=pengguna, 2=sistem, 3=impor. Metrik bisa menyaring event rekonstruksi.
  source        smallint    NOT NULL DEFAULT 1,
  -- 1=status 2=assignee 3=prioritas 4=judul 5=due_date 6=effort 7=goal
  -- 8=cycle 9=dibuat 10=dihapus 11=dipulihkan 12=label 13=checklist
  kind          smallint    NOT NULL,
  from_value    jsonb,
  to_value      jsonb,
  -- Denormalisasi SENGAJA: metrik tidak boleh bergantung pada tabel statuses
  -- yang bisa diarsipkan/dinamai ulang, dan join berlapis pada 3 juta baris
  -- per tahun terlalu mahal untuk dashboard.
  category_from smallint,
  category_to   smallint,
  cycle_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_task_events PRIMARY KEY (id),
  CONSTRAINT fk_task_events_task FOREIGN KEY (task_id) REFERENCES tasks (id),
  CONSTRAINT fk_task_events_actor FOREIGN KEY (actor_id) REFERENCES users (id),
  CONSTRAINT ck_task_events_seq CHECK (seq >= 1),
  CONSTRAINT ck_task_events_source CHECK (source IN (1, 2, 3)),
  CONSTRAINT ck_task_events_kind CHECK (kind BETWEEN 1 AND 13),
  CONSTRAINT ck_task_events_category
    CHECK (category_from IS NULL OR category_from IN (1, 2, 3, 4, 5)),
  CONSTRAINT ck_task_events_category_to
    CHECK (category_to IS NULL OR category_to IN (1, 2, 3, 4, 5)),
  -- V3 (diverifikasi): event status SELALU membawa kategori.
  -- Tanpa ini, satu event status tanpa kategori merusak metrik forever.
  CONSTRAINT ck_task_events_status_has_category
    CHECK ((kind = 1) = (category_to IS NOT NULL))
);

-- Detail task: riwayat terbaru lebih dulu.
CREATE INDEX ix_task_events_task ON task_events (task_id, created_at DESC);

-- Timeline tim.
CREATE INDEX ix_task_events_ws_team
  ON task_events (workspace_id, team_id, created_at DESC);

-- Query metrik (§8.3): hanya event status.
CREATE INDEX ix_task_events_status
  ON task_events (workspace_id, category_from, category_to, created_at)
  WHERE kind = 1;

CREATE INDEX ix_task_events_cycle
  ON task_events (workspace_id, cycle_id)
  WHERE cycle_id IS NOT NULL;

-- Append-only (S7). Hak UPDATE/DELETE dicabut pada migrasi peran, BUKAN di
-- sini: saat migrasi ini berjalan, peran aplikasi belum tentu ada. Urutan
-- ini disengaja agar migrasi ini bisa dijalankan pada instalasi baru maupun
-- lama.

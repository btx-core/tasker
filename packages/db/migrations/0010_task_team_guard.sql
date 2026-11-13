-- migration: 0010_task_team_guard
-- intent: Menegakkan bahwa status/label task selalu berasal dari tim yang sama (INV-08, kebocoran lintas-tim).
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-08 "Constraint konsistensi status/tim"

-- KENAPA TRIGGER, BUKAN CHECK:
-- `statuses.team_id = tasks.team_id` butuh membaca baris di tabel lain.
-- CHECK tidak boleh berisi subquery di Postgres, dan FK komposit akan
-- memaksa kolom tambahan yang justru mengubah model. Karena ini menyangkut
-- KEBOCORAN LINTAS-TIM (task di tim A memakai status tim B -> task muncul di
-- board tim yang salah), ditegakkan di DB, bukan hanya di repository.
-- data-model.md menyebut trigger ini WAJIB.

CREATE OR REPLACE FUNCTION tasks_guard_team_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  status_team uuid;
BEGIN
  SELECT s.team_id INTO status_team
  FROM statuses s
  WHERE s.id = NEW.status_id;

  IF status_team IS NULL THEN
    -- FK sudah menangani ini; pesan eksplisit agar mudah didiagnosis.
    RAISE EXCEPTION 'status % tidak ditemukan', NEW.status_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF status_team <> NEW.team_id THEN
    RAISE EXCEPTION
      'status % milik tim %, bukan tim task %', NEW.status_id, status_team, NEW.team_id
      USING ERRCODE = 'check_violation',
            HINT = 'Status harus berasal dari tim yang sama dengan task (INV-08).';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tasks_guard_team
  BEFORE INSERT OR UPDATE OF status_id, team_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_guard_team_consistency();

-- Catatan biaya: trigger BEFORE ROW hanya melakukan satu SELECT pada PK
-- `statuses` (index lookup). Pada 150 mutasi/detik itu 150 lookup/detik ke
-- shared buffer - tidak terukur. Alternatif (menyimpan team_id di status
-- cache aplikasi) memindahkan risiko kebocoran ke kode, dan itu lebih buruk.

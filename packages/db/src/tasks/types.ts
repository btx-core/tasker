export interface TaskRow {
  id: string;
  workspace_id: string;
  team_id: string;
  number: number;
  title: string;
  description: string | null;
  status_id: string;
  assignee_id: string | null;
  priority: number;
  effort: number | null;
  due_date: string | null;
  version: number;
  deleted_at: Date | null;
}

/** Delta yang disiarkan. Payload TIDAK PERNAH memuat description (ADR-017). */
export interface ChangeRecord {
  workspaceId: string;
  seq: number;
  entityType: number;
  entityId: string;
  teamId: string;
  op: 1 | 2;
  version: number;
  payload: Record<string, unknown>;
}

/**
 * Katalog action. Sumber kebenaran: rbac.md. ID TIDAK BOLEH dikarang di kode
 * (repo-layout.md §3.2) - berkas ini cerminan daftar di dokumen.
 */
export const ACTIONS = {
  TASK_CREATE: "task.create",
  TASK_UPDATE: "task.update",
  TASK_UPDATE_STATUS: "task.update.status",
  TASK_UPDATE_ASSIGNEE: "task.update.assignee",
  TASK_UPDATE_TITLE: "task.update.title",
  TASK_UPDATE_DESCRIPTION: "task.update.description",
  TASK_UPDATE_PRIORITY: "task.update.priority",
  TASK_UPDATE_EFFORT: "task.update.effort",
  TASK_UPDATE_DUE_DATE: "task.update.due_date",
  TASK_DELETE: "task.delete",
  /** Melihat task. Dimiliki SEMUA peran tim (AC-27); bukan hak istimewa. */
  TASK_VIEW: "task.view",
  /** Melihat task yang sudah dihapus. Hanya ADM/owner (api-contract.md §8.2). */
  TASK_VIEW_DELETED: "task.view.deleted",
  BOARD_READ: "board.read",
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

/** Peran tim (team_members.role). */
export const TEAM_ROLE = {
  ADMIN: 1,
  MEMBER: 2,
  COMMENTER: 3,
  VIEWER: 4,
} as const;

export type TeamRole = (typeof TEAM_ROLE)[keyof typeof TEAM_ROLE];

/**
 * Matriks izin. DENY BY DEFAULT: action yang tidak ada di daftar peran =
 * ditolak. Menambah action baru tanpa menambah baris di sini berarti action
 * itu tidak bisa dipakai siapa pun - dan itu kegagalan yang aman.
 *
 * Catatan rbac.md: viewer & commenter TIDAK bisa menulis task.
 */
const PERMISSIONS: Record<TeamRole, readonly Action[]> = {
  [TEAM_ROLE.ADMIN]: [
    ACTIONS.TASK_CREATE, ACTIONS.TASK_UPDATE, ACTIONS.TASK_UPDATE_STATUS,
    ACTIONS.TASK_UPDATE_ASSIGNEE, ACTIONS.TASK_UPDATE_TITLE,
    ACTIONS.TASK_UPDATE_DESCRIPTION, ACTIONS.TASK_UPDATE_PRIORITY,
    ACTIONS.TASK_UPDATE_EFFORT, ACTIONS.TASK_UPDATE_DUE_DATE,
    ACTIONS.TASK_DELETE, ACTIONS.TASK_VIEW, ACTIONS.TASK_VIEW_DELETED,
    ACTIONS.BOARD_READ,
  ],
  [TEAM_ROLE.MEMBER]: [
    ACTIONS.TASK_CREATE, ACTIONS.TASK_UPDATE, ACTIONS.TASK_UPDATE_STATUS,
    ACTIONS.TASK_UPDATE_ASSIGNEE, ACTIONS.TASK_UPDATE_TITLE,
    ACTIONS.TASK_UPDATE_DESCRIPTION, ACTIONS.TASK_UPDATE_PRIORITY,
    ACTIONS.TASK_UPDATE_EFFORT, ACTIONS.TASK_UPDATE_DUE_DATE,
    ACTIONS.TASK_VIEW, ACTIONS.BOARD_READ,
  ],
  [TEAM_ROLE.COMMENTER]: [ACTIONS.TASK_VIEW, ACTIONS.BOARD_READ],
  [TEAM_ROLE.VIEWER]: [ACTIONS.TASK_VIEW, ACTIONS.BOARD_READ],
};

export interface Actor {
  userId: string;
  workspaceId: string;
  teamRole: TeamRole;
}

/** Satu-satunya implementasi izin (ADR-003). */
export function can(actor: Actor, action: Action): boolean {
  return PERMISSIONS[actor.teamRole]?.includes(action) ?? false;
}

/** Field patch -> action yang dibutuhkan. Dipakai untuk memeriksa per-field. */
export const FIELD_ACTION: Readonly<Record<string, Action>> = {
  title: ACTIONS.TASK_UPDATE_TITLE,
  description: ACTIONS.TASK_UPDATE_DESCRIPTION,
  status_id: ACTIONS.TASK_UPDATE_STATUS,
  assignee_id: ACTIONS.TASK_UPDATE_ASSIGNEE,
  priority: ACTIONS.TASK_UPDATE_PRIORITY,
  effort: ACTIONS.TASK_UPDATE_EFFORT,
  due_date: ACTIONS.TASK_UPDATE_DUE_DATE,
};

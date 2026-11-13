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

  // --- Komentar (rbac.md AC-35..AC-38) ---
  /**
   * KENAPA `comment.update.own` TERPISAH dari `comment.update.any`:
   * keduanya punya aturan yang berbeda secara mendasar. Yang pertama dibatasi
   * kepemilikan (hanya penulisnya), yang kedua adalah moderasi dan hanya
   * dimiliki admin. Menggabungkannya menjadi satu action akan memaksa
   * pemeriksaan kepemilikan masuk ke dalam `can()` — dan `can()` tidak tahu
   * siapa pemilik objek. Lebih baik dua action dengan satu aturan masing-masing.
   */
  COMMENT_CREATE: "comment.create",
  COMMENT_UPDATE_OWN: "comment.update.own",
  COMMENT_UPDATE_ANY: "comment.update.any",
  COMMENT_DELETE: "comment.delete",

  /** Checklist: tambah/ubah/centang/hapus item (rbac.md AC-41). */
  CHECKLIST_MANAGE: "checklist.manage",
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

/** Peran workspace (workspace_members.role). Sumber: rbac.md. */
export const WORKSPACE_ROLE = {
  OWNER: 1,
  ADMIN: 2,
  MEMBER: 3,
} as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLE)[keyof typeof WORKSPACE_ROLE];

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
    ACTIONS.COMMENT_CREATE, ACTIONS.COMMENT_UPDATE_OWN, ACTIONS.COMMENT_UPDATE_ANY,
    ACTIONS.COMMENT_DELETE, ACTIONS.CHECKLIST_MANAGE,
  ],
  [TEAM_ROLE.MEMBER]: [
    ACTIONS.TASK_CREATE, ACTIONS.TASK_UPDATE, ACTIONS.TASK_UPDATE_STATUS,
    ACTIONS.TASK_UPDATE_ASSIGNEE, ACTIONS.TASK_UPDATE_TITLE,
    ACTIONS.TASK_UPDATE_DESCRIPTION, ACTIONS.TASK_UPDATE_PRIORITY,
    ACTIONS.TASK_UPDATE_EFFORT, ACTIONS.TASK_UPDATE_DUE_DATE,
    ACTIONS.TASK_VIEW, ACTIONS.BOARD_READ,
    ACTIONS.COMMENT_CREATE, ACTIONS.COMMENT_UPDATE_OWN, ACTIONS.COMMENT_DELETE,
    ACTIONS.CHECKLIST_MANAGE,
  ],
  [TEAM_ROLE.COMMENTER]: [
    ACTIONS.TASK_VIEW, ACTIONS.BOARD_READ,
    /**
     * Inilah SELURUH alasan peran `commenter` ada (rbac.md baris 188: "commenter
     * tidak bisa mengubah task apa pun — inilah perannya"). Sebelum baris ini
     * ditambahkan, peran tersebut secara harfiah tidak bisa berkomentar —
     * namanya berbohong tentang kemampuannya.
     */
    ACTIONS.COMMENT_CREATE, ACTIONS.COMMENT_UPDATE_OWN, ACTIONS.COMMENT_DELETE,
  ],
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

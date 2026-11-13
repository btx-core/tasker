/**
 * Komentar (ENT-12/ENT-13).
 *
 * DUA ATURAN YANG MENGATUR SELURUH BERKAS INI:
 *
 *  1. **Otorisasi lewat INDUK** (INV-13, TC-23). Komentar tidak punya izin
 *     sendiri; ia milik task, dan task milik tim. Karena itu setiap query di
 *     sini memfilter lewat `tasks` — bukan hanya `comments.workspace_id`.
 *     Tanpa itu, ID komentar dari task yang sudah dihapus (atau dari tim lain)
 *     tetap bisa dibaca dan diubah, dan `workspace_id` saja TIDAK cukup:
 *     satu workspace berisi banyak tim.
 *
 *  2. **Soft delete mempertahankan placeholder** (AC-38). Baris tidak dibuang.
 *     Percakapan yang berlubang lebih menyesatkan daripada percakapan dengan
 *     satu pesan bertanda "dihapus": pembaca tidak bisa membedakan "tidak
 *     pernah ada balasan" dari "balasannya dihapus".
 */
import { randomBytes } from "node:crypto";
import { ApiError } from "@kelindan/shared";
import type { SqlClient } from "../client.js";

export interface CommentRow {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string;
  body: string | null;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
}

const COMMENT_COLUMNS = `
  c.id, c.task_id, c.author_id, u.display_name AS author_name,
  c.body, c.created_at, c.edited_at, c.deleted_at
`;

/**
 * Memastikan task ada DAN terlihat oleh workspace pemanggil, lalu
 * mengembalikan `team_id`-nya untuk pemeriksaan peran.
 *
 * Task terhapus diperlakukan seperti tidak ada (TC-23): komentar pada task
 * terhapus tidak bisa dibaca maupun diubah.
 */
export async function taskScope(
  client: SqlClient,
  workspaceId: string,
  taskId: string,
): Promise<{ taskId: string; teamId: string }> {
  const { rows } = await client.query<{ id: string; team_id: string }>(
    "SELECT id, team_id FROM tasks WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
    [taskId, workspaceId],
  );
  const row = rows[0];
  if (!row) throw ApiError.notFound("Task");
  return { taskId: row.id, teamId: row.team_id };
}

/**
 * Membaca komentar. `body` NULL untuk komentar terhapus — placeholder tetap
 * dikirim dengan `deleted_at` terisi, supaya UI bisa menampilkan "pesan ini
 * dihapus" di posisi yang benar.
 */
export async function listComments(
  client: SqlClient,
  opts: { workspaceId: string; taskId: string; limit?: number; before?: Date },
): Promise<CommentRow[]> {
  await taskScope(client, opts.workspaceId, opts.taskId);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const { rows } = await client.query<CommentRow>(
    `SELECT c.id, c.task_id, c.author_id, u.display_name AS author_name,
            CASE WHEN c.deleted_at IS NULL THEN c.body ELSE NULL END AS body,
            c.created_at, c.edited_at, c.deleted_at
       FROM comments c
       JOIN users u ON u.id = c.author_id
       JOIN tasks t ON t.id = c.task_id
      WHERE c.task_id = $1 AND t.workspace_id = $2 AND t.deleted_at IS NULL
        AND ($3::timestamptz IS NULL OR c.created_at < $3)
      ORDER BY c.created_at DESC
      LIMIT $4`,
    [opts.taskId, opts.workspaceId, opts.before?.toISOString() ?? null, limit],
  );
  // Dikirim ASCENDING untuk tampilan thread; query mengambil dari ujung
  // terbaru agar thread panjang tidak mengirim ribuan baris.
  return rows.reverse();
}

export async function createComment(
  client: SqlClient,
  opts: { workspaceId: string; taskId: string; authorId: string; body: string },
): Promise<CommentRow> {
  await taskScope(client, opts.workspaceId, opts.taskId);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO comments (id, workspace_id, task_id, author_id, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [randomUuid(), opts.workspaceId, opts.taskId, opts.authorId, opts.body],
  );
  const created = await loadComment(client, opts.workspaceId, rows[0]!.id);
  if (!created) throw new Error("komentar hilang setelah dibuat");
  return created;
}

/**
 * Memuat satu komentar lewat INDUK. Mengembalikan null bila tidak ada, tidak
 * terlihat, atau task-nya terhapus — pemanggil yang memutuskan 400/403/404.
 */
export async function loadComment(
  client: SqlClient,
  workspaceId: string,
  commentId: string,
): Promise<CommentRow | null> {
  const { rows } = await client.query<CommentRow>(
    `SELECT ${COMMENT_COLUMNS}
       FROM comments c
       JOIN users u ON u.id = c.author_id
       JOIN tasks t ON t.id = c.task_id
      WHERE c.id = $1 AND t.workspace_id = $2 AND t.deleted_at IS NULL`,
    [commentId, workspaceId],
  );
  return rows[0] ?? null;
}

/**
 * Menyimpan versi lama ke `comment_revisions` LALU memperbarui komentar.
 *
 * Urutannya penting: revisi ditulis lebih dulu. Bila UPDATE gagal setelahnya,
 * kita punya revisi tanpa perubahan — tidak berbahaya. Urutan sebaliknya akan
 * menghilangkan teks lama secara diam-diam bila penulisan revisi gagal.
 */
export async function updateComment(
  client: SqlClient,
  opts: { workspaceId: string; commentId: string; editorId: string; body: string; now?: Date },
): Promise<CommentRow> {
  const before = await loadComment(client, opts.workspaceId, opts.commentId);
  if (!before) throw ApiError.notFound("Komentar");

  const now = opts.now ?? new Date();
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO comment_revisions (id, comment_id, workspace_id, body, edited_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUuid(), before.id, opts.workspaceId, before.body ?? "", opts.editorId],
    );
    await client.query(
      "UPDATE comments SET body = $2, edited_at = $3 WHERE id = $1",
      [before.id, opts.body, now.toISOString()],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  const after = await loadComment(client, opts.workspaceId, opts.commentId);
  if (!after) throw new Error("komentar hilang setelah diubah");
  return after;
}

/**
 * Soft delete (AC-38): `deleted_at` diisi, baris tetap ada sebagai placeholder.
 *
 * KENAPA `body` TIDAK DIKOSONGKAN — dan ini bukan kelalaian:
 * `ck_comments_body_len` mewajibkan `body` 1–16384 karakter, jadi
 * `SET body = ''` **melanggar constraint** dan muncul sebagai galat database.
 * Percobaan pertama saya memang begitu dan gagal pada uji, bukan pada tinjauan.
 *
 * Jadi "hapus" di sini berarti: **teks tidak lagi dikembalikan ke pengguna**
 * (`listComments` mengirim `body = NULL`), tetapi tetap tersimpan. Itu berguna
 * untuk moderasi dan audit (FR-305), dan sesuai maksud skema yang menolak body
 * kosong.
 *
 * KONSEKUENSI YANG HARUS DISADARI: ini BUKAN penghapusan data. Permintaan
 * "hapus data saya" menuntut hard delete atau penyaringan kolom, dan itu
 * keputusan retensi/privacy yang belum diambil. Dicatat sebagai T-38.
 */
export async function deleteComment(
  client: SqlClient,
  opts: { workspaceId: string; commentId: string; now?: Date },
): Promise<{ alreadyDeleted: boolean }> {
  const before = await loadComment(client, opts.workspaceId, opts.commentId);
  if (!before) throw ApiError.notFound("Komentar");
  if (before.deleted_at !== null) return { alreadyDeleted: true };

  await client.query(
    "UPDATE comments SET deleted_at = $2 WHERE id = $1",
    [before.id, (opts.now ?? new Date()).toISOString()],
  );
  return { alreadyDeleted: false };
}

/** Revisi komentar (ENT-13), untuk fitur "lihat riwayat edit" kelak. */
export async function listCommentRevisions(
  client: SqlClient,
  opts: { workspaceId: string; commentId: string },
): Promise<Array<{ id: string; body: string; created_at: Date; edited_by: string }>> {
  const { rows } = await client.query<{ id: string; body: string; created_at: Date; edited_by: string }>(
    `SELECT r.id, r.body, r.created_at, r.edited_by
       FROM comment_revisions r
       JOIN comments c ON c.id = r.comment_id
       JOIN tasks t ON t.id = c.task_id
      WHERE r.comment_id = $1 AND t.workspace_id = $2 AND t.deleted_at IS NULL
      ORDER BY r.created_at DESC`,
    [opts.commentId, opts.workspaceId],
  );
  return rows;
}

function randomUuid(): string {
  // Sama seperti sesi: kolomnya uuid, tidak butuh urutan waktu.
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

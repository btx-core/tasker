/**
 * Rute kolaborasi: komentar (AC-35..AC-38) dan checklist (AC-41).
 *
 * Pola yang SAMA di semua rute (ADR-015 "tidak ada handler yang menyimpang"):
 *   1. wajib sesi
 *   2. resolve task -> team (404 bila tidak terlihat; JANGAN 403, itu
 *      membocorkan keberadaan task)
 *   3. resolve peran tim pemanggil (null = bukan anggota = 404)
 *   4. periksa `can()` SEBELUM menyentuh data
 *   5. panggil use-case
 *
 * KENAPA 404 UNTUK "BUKAN ANGGOTA": 403 akan memberi tahu penyerang bahwa
 * task itu ADA. 404 untuk keduanya membuat "tidak ada" dan "bukan milikmu"
 * tidak bisa dibedakan dari luar — dan itu yang dijanjikan api-contract.md.
 */
import { ApiError, ACTIONS, can, canDeleteComment, canEditComment, type Actor } from "@kelindan/shared";
import {
  addChecklistItem, createComment, deleteChecklistItem, deleteComment,
  listChecklist, listComments, loadComment, updateChecklistItem, updateComment,
} from "@kelindan/db";
import type { Handler, Router } from "./router.js";
import type { Deps } from "./routes.js";

const MAX_COMMENT_LEN = 16_384;

/**
 * Resolusi aktor untuk sebuah task. Melempar 404 bila task tidak terlihat atau
 * pemanggil bukan anggota timnya — pemanggil tidak perlu memikirkan ini lagi.
 */
async function actorForTask(
  deps: Deps,
  auth: { userId: string; workspaceId: string },
  taskId: string,
): Promise<{ actor: Actor; teamId: string }> {
  const teamId = await deps.teamIdOfTask(auth.workspaceId, taskId);
  if (!teamId) throw ApiError.notFound("Task");
  const role = await deps.teamRoleOf(auth.userId, auth.workspaceId, teamId);
  if (role === null) throw ApiError.notFound("Task");
  return { actor: { userId: auth.userId, workspaceId: auth.workspaceId, teamRole: role }, teamId };
}

function requireAuth(ctx: { auth?: { userId: string; workspaceId: string } }) {
  if (!ctx.auth) throw new ApiError(401, "auth.unauthenticated", "Sesi tidak sah");
  return ctx.auth;
}

/**
 * Body komentar divalidasi di sini, bukan diserahkan ke CHECK skema.
 * Pelanggaran constraint muncul sebagai 500 tanpa nama field; klien yang
 * mengirim komentar kosong harus melihat 400 `field: "body"`.
 */
function parseCommentBody(raw: unknown): string {
  if (typeof raw !== "string") throw ApiError.validation("body wajib berupa teks", "body");
  const body = raw.trim();
  if (body.length === 0) throw ApiError.validation("komentar tidak boleh kosong", "body");
  if (body.length > MAX_COMMENT_LEN) {
    throw ApiError.validation(`komentar maksimal ${MAX_COMMENT_LEN} karakter`, "body");
  }
  return body;
}

export function registerCollabRoutes(router: Router, deps: Deps): void {
  /* ------------------------------------------------------------------ */
  /* Komentar                                                            */
  /* ------------------------------------------------------------------ */

  router.add("GET", "/v1/tasks/:id/comments", (async (ctx) => {
    const auth = requireAuth(ctx);
    const { actor } = await actorForTask(deps, auth, ctx.params["id"]!);
    if (!can(actor, ACTIONS.TASK_VIEW)) {
      throw new ApiError(403, "auth.forbidden", "Tidak berwenang melihat komentar");
    }
    const client = await deps.db();
    const comments = await listComments(client, {
      workspaceId: auth.workspaceId,
      taskId: ctx.params["id"]!,
      limit: Number(ctx.url.searchParams.get("limit") ?? 100) || 100,
    });
    return { status: 200, body: { comments } };
  }) as Handler);

  router.add("POST", "/v1/tasks/:id/comments", (async (ctx) => {
    const auth = requireAuth(ctx);
    const { actor } = await actorForTask(deps, auth, ctx.params["id"]!);
    /**
     * INILAH yang membedakan `commenter` dari `viewer` (rbac.md). Tanpa
     * pemeriksaan ini, peran commenter secara harfiah tidak bisa berkomentar.
     */
    if (!can(actor, ACTIONS.COMMENT_CREATE)) {
      throw new ApiError(403, "auth.forbidden", "Tidak berwenang berkomentar");
    }
    const body = parseCommentBody((ctx.body as { body?: unknown } | undefined)?.body);
    const client = await deps.db();
    const comment = await createComment(client, {
      workspaceId: auth.workspaceId,
      taskId: ctx.params["id"]!,
      authorId: auth.userId,
      body,
    });
    return { status: 201, body: { comment } };
  }) as Handler);

  /**
   * Mengubah komentar. DUA jalur izin, diperiksa berurutan:
   *  - pemilik dalam 15 menit  (`comment.update.own`)
   *  - admin kapan saja        (`comment.update.any`, moderasi)
   *
   * `canEditComment` yang memutuskan, bukan handler: aturan ini dipakai juga
   * oleh UI untuk menampilkan tombol "edit", dan dua implementasi akan
   * menyimpang cepat atau lambat.
   */
  router.add("PATCH", "/v1/comments/:id", (async (ctx) => {
    const auth = requireAuth(ctx);
    const client = await deps.db();
    const existing = await loadComment(client, auth.workspaceId, ctx.params["id"]!);
    if (!existing) throw ApiError.notFound("Komentar");

    const { actor } = await actorForTask(deps, auth, existing.task_id);
    const canModerate = can(actor, ACTIONS.COMMENT_UPDATE_ANY);
    const verdict = canEditComment(
      { ...actor, canModerate },
      { authorId: existing.author_id, createdAt: existing.created_at, deletedAt: existing.deleted_at },
    );
    if (!verdict.allowed) {
      /**
       * Pesan berbeda per alasan adalah fitur, bukan kebocoran: pemanggil sudah
       * terbukti bisa MELIHAT komentar itu. Ia berhak tahu apakah ia terlambat
       * ("lewat 15 menit") atau memang bukan miliknya.
       */
      if (verdict.reason === "deleted") throw ApiError.notFound("Komentar");
      if (verdict.reason === "window_closed") {
        throw new ApiError(403, "auth.forbidden", "Batas 15 menit untuk mengedit sudah lewat");
      }
      throw new ApiError(403, "auth.forbidden", "Bukan penulis komentar ini");
    }

    const body = parseCommentBody((ctx.body as { body?: unknown } | undefined)?.body);
    const comment = await updateComment(client, {
      workspaceId: auth.workspaceId, commentId: existing.id, editorId: auth.userId, body,
    });
    return { status: 200, body: { comment } };
  }) as Handler);

  router.add("DELETE", "/v1/comments/:id", (async (ctx) => {
    const auth = requireAuth(ctx);
    const client = await deps.db();
    const existing = await loadComment(client, auth.workspaceId, ctx.params["id"]!);
    if (!existing) throw ApiError.notFound("Komentar");

    const { actor } = await actorForTask(deps, auth, existing.task_id);
    const canModerate = can(actor, ACTIONS.COMMENT_UPDATE_ANY);

    /**
     * IDEMPOTENSI MENANG ATAS "sudah dihapus", tetapi hanya untuk orang yang
     * memang berhak menghapusnya. `deletedAt` sengaja diteruskan sebagai null
     * saat memeriksa izin: pertanyaannya bukan "boleh menghapus yang sudah
     * terhapus?" melainkan "boleh menghapus komentar INI?".
     *
     * Tanpa ini, klien yang retry setelah timeout menerima 404 untuk operasi
     * yang SUDAH berhasil — dan akan menampilkan "komentar tidak ditemukan"
     * kepada pengguna yang baru saja menghapusnya.
     */
    const verdict = canDeleteComment(
      { ...actor, canModerate },
      { authorId: existing.author_id, createdAt: existing.created_at, deletedAt: null },
    );
    if (!verdict.allowed) {
      throw new ApiError(403, "auth.forbidden", "Tidak berwenang menghapus komentar ini");
    }

    const result = await deleteComment(client, {
      workspaceId: auth.workspaceId, commentId: existing.id,
    });
    // 200, bukan 204: klien perlu tahu ini idempoten (placeholdernya sudah ada).
    return { status: 200, body: { deleted: true, already_deleted: result.alreadyDeleted } };
  }) as Handler);

  /* ------------------------------------------------------------------ */
  /* Checklist                                                           */
  /* ------------------------------------------------------------------ */

  router.add("GET", "/v1/tasks/:id/checklist", (async (ctx) => {
    const auth = requireAuth(ctx);
    const { actor } = await actorForTask(deps, auth, ctx.params["id"]!);
    if (!can(actor, ACTIONS.TASK_VIEW)) {
      throw new ApiError(403, "auth.forbidden", "Tidak berwenang melihat checklist");
    }
    const client = await deps.db();
    const items = await listChecklist(client, {
      workspaceId: auth.workspaceId, taskId: ctx.params["id"]!,
    });
    const done = items.filter((i) => i.is_done).length;
    return { status: 200, body: { items, progress: { done, total: items.length } } };
  }) as Handler);

  router.add("POST", "/v1/tasks/:id/checklist", (async (ctx) => {
    const auth = requireAuth(ctx);
    const { actor } = await actorForTask(deps, auth, ctx.params["id"]!);
    if (!can(actor, ACTIONS.CHECKLIST_MANAGE)) {
      throw new ApiError(403, "auth.forbidden", "Tidak berwenang mengubah checklist");
    }
    const input = (ctx.body ?? {}) as { content?: unknown };
    if (typeof input.content !== "string") {
      throw ApiError.validation("content wajib diisi", "content");
    }
    const content = input.content.trim();
    if (content.length === 0 || content.length > 500) {
      throw ApiError.validation("isi checklist harus 1–500 karakter", "content");
    }
    const client = await deps.db();
    const item = await addChecklistItem(client, {
      workspaceId: auth.workspaceId, taskId: ctx.params["id"]!, content,
    });
    return { status: 201, body: { item } };
  }) as Handler);

  router.add("PATCH", "/v1/checklist/:id", (async (ctx) => {
    const auth = requireAuth(ctx);
    const input = (ctx.body ?? {}) as {
      content?: unknown; is_done?: unknown;
      assignee_id?: unknown; due_date?: unknown;
    };
    const client = await deps.db();

    /**
     * Peran dicek lewat INDUK. `updateChecklistItem` sendiri memastikan item
     * terlihat (INV-13); di sini kita butuh `teamId` untuk memeriksa peran,
     * jadi induknya dibaca lebih dulu lewat item.
     */
    const { rows } = await client.query<{ task_id: string }>(
      "SELECT task_id FROM checklist_items WHERE id = $1", [ctx.params["id"]!],
    );
    const taskId = rows[0]?.task_id;
    if (!taskId) throw ApiError.notFound("Item checklist");
    const { actor } = await actorForTask(deps, auth, taskId);
    if (!can(actor, ACTIONS.CHECKLIST_MANAGE)) {
      throw new ApiError(403, "auth.forbidden", "Tidak berwenang mengubah checklist");
    }

    const patch: Record<string, unknown> = {};
    if (input.content !== undefined) {
      if (typeof input.content !== "string") throw ApiError.validation("content harus teks", "content");
      patch["content"] = input.content;
    }
    if (input.is_done !== undefined) {
      if (typeof input.is_done !== "boolean") throw ApiError.validation("is_done harus boolean", "is_done");
      patch["is_done"] = input.is_done;
    }
    if (input.assignee_id !== undefined) patch["assigneeId"] = input.assignee_id ?? null;
    if (input.due_date !== undefined) patch["dueDate"] = input.due_date ?? null;

    const item = await updateChecklistItem(client, {
      workspaceId: auth.workspaceId, itemId: ctx.params["id"]!, patch: patch as never,
    });
    return { status: 200, body: { item } };
  }) as Handler);

  router.add("DELETE", "/v1/checklist/:id", (async (ctx) => {
    const auth = requireAuth(ctx);
    const client = await deps.db();
    const { rows } = await client.query<{ task_id: string }>(
      "SELECT task_id FROM checklist_items WHERE id = $1", [ctx.params["id"]!],
    );
    const taskId = rows[0]?.task_id;
    if (!taskId) throw ApiError.notFound("Item checklist");
    const { actor } = await actorForTask(deps, auth, taskId);
    if (!can(actor, ACTIONS.CHECKLIST_MANAGE)) {
      throw new ApiError(403, "auth.forbidden", "Tidak berwenang mengubah checklist");
    }
    await deleteChecklistItem(client, { workspaceId: auth.workspaceId, itemId: ctx.params["id"]! });
    return { status: 204, body: undefined };
  }) as Handler);
}

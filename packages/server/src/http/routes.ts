/**
 * Rute. Handler di sini TIPIS: parse -> panggil use-case -> bentuk respons.
 * Tidak ada logika bisnis, tidak ada SQL. Itu yang membuat ADR-015
 * ("tidak boleh ada handler yang menyimpang") bisa ditegakkan.
 */
import type { Client } from "pg";
import {
  applyTaskPatch,
  createTask,
  loadBoard,
  listTasks,
  loadTaskDetail,
  parseOrderParams,
  parseLimit,
} from "@kelindan/db";
import {
  ApiError,
  can,
  ACTIONS,
  parseTaskPatch,
  TEAM_ROLE,
  type Action,
  type Actor,
  type TeamRole,
} from "@kelindan/shared";
import type { Handler, RequestContext, Router } from "./router.js";
import type { ResolvedAuth } from "../authz/session.js";

export interface Deps {
  db: () => Promise<Client>;
  /** Peran user di tim pemilik task; null bila bukan anggota. */
  teamRoleOf: (userId: string, workspaceId: string, teamId: string) => Promise<TeamRole | null>;
  teamIdOfTask: (workspaceId: string, taskId: string) => Promise<string | null>;
}

const IDEMPOTENCY_HEADER = "idempotency-key";

function requireIdempotencyKey(ctx: { req: { headers: Record<string, unknown> } }): string {
  const raw = ctx.req.headers[IDEMPOTENCY_HEADER];
  const key = Array.isArray(raw) ? raw[0] : raw;
  // Wajib untuk semua non-GET (api-contract.md §6, A6).
  if (typeof key !== "string" || key.length < 8) {
    throw ApiError.validation("header Idempotency-Key wajib diisi", "Idempotency-Key");
  }
  return key;
}

export function registerRoutes(router: Router, deps: Deps): void {
  router.add("GET", "/health", async () => ({ status: 200, body: { ok: true } }), {
    requiresAuth: false,
  });

  router.add("PATCH", "/v1/tasks/:id", (async (ctx) => {
    const auth = ctx.auth;
    if (!auth) throw new ApiError(401, "auth.unauthenticated", "Sesi tidak sah");

    const operationId = requireIdempotencyKey(ctx);
    const parsed = parseTaskPatch(ctx.body);
    if (!parsed.ok) {
      const first = parsed.issues[0]!;
      throw new ApiError(400, first.code, first.message, { field: first.field });
    }

    const taskId = ctx.params["id"]!;
    const teamId = await deps.teamIdOfTask(auth.workspaceId, taskId);
    // Task yang tidak ada ATAU milik tenant lain -> 404, bukan 403.
    if (!teamId) throw ApiError.notFound("Task");

    const role = await deps.teamRoleOf(auth.userId, auth.workspaceId, teamId);
    if (role === null) throw ApiError.notFound("Task"); // bukan anggota tim = tidak ada

    const actor: Actor = { userId: auth.userId, workspaceId: auth.workspaceId, teamRole: role };
    // Pemeriksaan awal agar 403 dilempar SEBELUM transaksi dibuka. write.ts
    // tetap memeriksa ulang per-field — pertahanan berlapis, bukan duplikasi.
    if (!can(actor, ACTIONS.TASK_UPDATE)) {
      throw new ApiError(403, "auth.forbidden", "Tidak berwenang mengubah task");
    }

    const client = await deps.db();
    const result = await applyTaskPatch(client, {
      actor,
      taskId,
      patch: parsed.patch!,
      ...(parsed.expectedVersion !== undefined ? { expectedVersion: parsed.expectedVersion } : {}),
      operationId,
      endpoint: "PATCH /v1/tasks/:id",
      traceId: ctx.traceId,
    });

    return {
      status: 200,
      body: {
        task: {
          id: result.task.id,
          number: result.task.number,
          title: result.task.title,
          status_id: result.task.status_id,
          assignee_id: result.task.assignee_id,
          priority: result.task.priority,
          effort: result.task.effort,
          due_date: result.task.due_date,
          version: result.task.version,
        },
        changed: result.changedFields,
        seq: result.change?.seq ?? null,
        replayed: result.replayed,
      },
    };
  }) as Handler);

  router.add("POST", "/v1/teams/:id/tasks", (async (ctx) => {
    const auth = ctx.auth;
    if (!auth) throw new ApiError(401, "auth.unauthenticated", "Sesi tidak sah");

    // Wajib untuk semua non-GET (api-contract.md §6, A6).
    requireIdempotencyKey(ctx);

    const teamId = ctx.params["id"]!;
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    if (typeof body["title"] !== "string" || body["title"].length < 1 || body["title"].length > 300) {
      throw new ApiError(400, "validation.failed", "title harus 1-300 karakter", { field: "title" });
    }
    if (body["description"] !== undefined && body["description"] !== null &&
        typeof body["description"] !== "string") {
      throw new ApiError(400, "validation.failed", "description harus string", { field: "description" });
    }
    if (typeof body["description"] === "string" && Buffer.byteLength(body["description"], "utf8") > 102_400) {
      throw new ApiError(400, "validation.failed", "description melebihi 100 KB", { field: "description" });
    }

    const role = await deps.teamRoleOf(auth.userId, auth.workspaceId, teamId);
    if (role === null) throw ApiError.notFound("Tim");

    const actor: Actor = { userId: auth.userId, workspaceId: auth.workspaceId, teamRole: role };
    if (!can(actor, ACTIONS.TASK_CREATE)) {
      throw new ApiError(403, "auth.forbidden", "Tidak berwenang membuat task");
    }

    const client = await deps.db();
    const task = await createTask(client, {
      actor,
      teamId,
      title: body["title"],
      ...(typeof body["description"] === "string" || body["description"] === null
        ? { description: body["description"] as string | null }
        : {}),
      ...(typeof body["priority"] === "number" ? { priority: body["priority"] } : {}),
    });

    return {
      status: 201,
      body: {
        task: {
          id: task.id, number: task.number, title: task.title,
          status_id: task.status_id, version: task.version,
        },
      },
    };
  }) as Handler);

  // ---- P2: BACA -----------------------------------------------------------
  // Semua rute baca memeriksa keanggotaan tim LEBIH DULU. Tim yang tidak
  // terlihat -> 404, BUKAN 403 dan BUKAN [] (api-contract.md §5.5 butir 3):
  // daftar kosong membocorkan bahwa tim itu ada.
  router.add("GET", "/v1/teams/:id/board", (async (ctx) => {
    const { auth, role, teamId } = await requireTeamMember(ctx, deps);
    const limitRaw = ctx.url.searchParams.get("limit");
    if (limitRaw !== null) parseLimit(new URLSearchParams(`limit=${limitRaw}`));

    const board = await loadBoard(
      await deps.db(),
      { workspaceId: auth.workspaceId, teamId },
      limitRaw !== null ? Number(limitRaw) : undefined,
    );
    void role;
    return { status: 200, body: board };
  }) as Handler);

  router.add("GET", "/v1/teams/:id/tasks", (async (ctx) => {
    const { auth, role, teamId } = await requireTeamMember(ctx, deps);
    const params = ctx.url.searchParams;
    const { order, filter } = parseOrderParams(params);
    const limit = parseLimit(params);

    // `include_deleted` hanya untuk ADM/owner (api-contract.md §8.2). Viewer
    // yang memintanya tidak mendapat galat — ia hanya tidak mendapat datanya.
    if (filter.includeDeleted && !can({ ...auth, teamRole: role }, ACTIONS.TASK_VIEW_DELETED)) {
      delete filter.includeDeleted;
    }
    // `assignee_id=me`
    if (filter.assigneeId === "me") filter.assigneeId = auth.userId;

    const cursor = params.get("cursor");
    const result = await listTasks(await deps.db(), {
      workspaceId: auth.workspaceId,
      teamId,
      order,
      filter,
      limit,
      ...(cursor !== null ? { cursor } : {}),
    });
    return {
      status: 200,
      body: {
        items: result.rows,
        page: { next_cursor: result.next_cursor, has_more: result.has_more },
      },
    };
  }) as Handler);

  router.add("GET", "/v1/tasks/:id", (async (ctx) => {
    const auth = ctx.auth!;
    const client = await deps.db();
    const detail = await loadTaskDetail(client, { workspaceId: auth.workspaceId }, ctx.params["id"]!);
    if (!detail) throw ApiError.notFound("Task");

    // Terlihat belum tentu boleh: cek keanggotaan tim pemilik task.
    const teamId = await deps.teamIdOfTask(auth.workspaceId, detail.id);
    const role = teamId ? await deps.teamRoleOf(auth.userId, auth.workspaceId, teamId) : null;
    if (!role) throw ApiError.notFound("Task");
    if (!can({ userId: auth.userId, workspaceId: auth.workspaceId, teamRole: role }, ACTIONS.TASK_VIEW)) {
      throw new ApiError(403, "auth.forbidden", "Tidak berwenang melihat task ini");
    }
    return { status: 200, body: detail };
  }) as Handler);
}

export type { Action };
export { TEAM_ROLE };

/**
 * Anggota tim atau 404. Mengembalikan role agar handler tidak query dua kali.
 * Dipakai SEMUA rute baca bersarang sehingga aturan "tidak terlihat = 404"
 * tidak bisa lupa diterapkan pada satu rute baru.
 */
async function requireTeamMember(
  ctx: RequestContext,
  deps: Deps,
): Promise<{ auth: ResolvedAuth; role: TeamRole; teamId: string }> {
  const auth = ctx.auth;
  if (!auth) throw new ApiError(401, "auth.unauthenticated", "Sesi tidak sah");
  const teamId = ctx.params["id"]!;
  const role = await deps.teamRoleOf(auth.userId, auth.workspaceId, teamId);
  if (role === null) throw ApiError.notFound("Tim");
  return { auth, role, teamId };
}

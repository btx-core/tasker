/**
 * Dependensi uji memakai PGlite + repositori in-memory.
 * TIDAK untuk produksi. Dipakai uji HTTP & (kelak) pengembangan lokal.
 */
import type { Client } from "pg";
import type { ClientLike } from "@kelindan/testing";
import type { SessionContext, TeamRole } from "@kelindan/shared";
import type { SessionRepo } from "./authz/session.js";
import type { AppDeps } from "./app.js";
import type { AuthRouteDeps } from "./http/auth-routes.js";

export interface TestDepsOptions {
  client: ClientLike;
  sessions?: Array<SessionContext & { token: string; epochNow: number }>;
  teamRoles?: Array<{ userId: string; workspaceId: string; teamId: string; role: TeamRole }>;
  /**
   * Repositori sesi alternatif. Dipakai uji auth: di sana sesi harus benar-benar
   * tersimpan di tabel `sessions`, karena yang diuji justru penulisan itu.
   */
  sessionRepo?: SessionRepo;
  /** Bila diisi, rute auth (login/logout/me) didaftarkan. */
  auth?: AuthRouteDeps;
  rateLimiter?: AppDeps["rateLimiter"];
}

export function testDeps(opts: TestDepsOptions): AppDeps {
  const sessions = opts.sessions ?? [];
  const roles = opts.teamRoles ?? [];

  const sessionRepo: SessionRepo = {
    async findByTokenHash(tokenHash: string) {
      const { createHash } = await import("node:crypto");
      const found = sessions.find(
        (s) => createHash("sha256").update(s.token, "utf8").digest("hex") === tokenHash,
      );
      if (!found) return null;
      return {
        sessionId: found.sessionId,
        userId: found.userId,
        workspaceId: found.workspaceId,
        epoch: found.epoch,
        expiresAt: found.expiresAt,
        revokedAt: found.revokedAt,
        epochNow: found.epochNow,
      };
    },
  };

  return {
    sessions: opts.sessionRepo ?? sessionRepo,
    ...(opts.auth ? { auth: opts.auth } : {}),
    ...(opts.rateLimiter ? { rateLimiter: opts.rateLimiter } : {}),
    db: async () => opts.client as unknown as Client,
    async teamRoleOf(userId, workspaceId, teamId) {
      const r = roles.find(
        (x) => x.userId === userId && x.workspaceId === workspaceId && x.teamId === teamId,
      );
      return r ? r.role : null;
    },
    async teamIdOfTask(workspaceId, taskId) {
      const res = await opts.client.query<{ team_id: string }>(
        "SELECT team_id FROM tasks WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
        [taskId, workspaceId],
      );
      return res.rows[0]?.team_id ?? null;
    },
  };
}

/**
 * Repositori sesi yang membaca tabel `sessions` SUNGGUHAN (lewat klien apa pun
 * yang kompatibel pg). Dipakai uji auth supaya penerbitan sesi tidak disimulasikan
 * — bila SQL-nya salah, uji gagal di sini, bukan di produksi.
 */
export function dbSessionRepo(client: ClientLike): SessionRepo {
  return {
    async findByTokenHash(tokenHash: string) {
      const { rows } = await client.query<{
        id: string; user_id: string; workspace_id: string | null; epoch: number;
        expires_at: Date; revoked_at: Date | null; epoch_now: number;
      }>(
        `SELECT s.id, s.user_id, s.workspace_id, s.epoch, s.expires_at, s.revoked_at,
                u.session_epoch AS epoch_now
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1`,
        [tokenHash],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        sessionId: r.id,
        userId: r.user_id,
        workspaceId: r.workspace_id ?? "",
        epoch: r.epoch,
        expiresAt: new Date(r.expires_at),
        revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
        epochNow: r.epoch_now,
      };
    },
  };
}

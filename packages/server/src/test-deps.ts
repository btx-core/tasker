/**
 * Dependensi uji memakai PGlite + repositori in-memory.
 * TIDAK untuk produksi. Dipakai uji HTTP & (kelak) pengembangan lokal.
 */
import type { Client } from "pg";
import type { ClientLike } from "@kelindan/testing";
import type { SessionContext, TeamRole } from "@kelindan/shared";
import type { SessionRepo } from "./authz/session.js";
import type { AppDeps } from "./app.js";

export interface TestDepsOptions {
  client: ClientLike;
  sessions?: Array<SessionContext & { token: string; epochNow: number }>;
  teamRoles?: Array<{ userId: string; workspaceId: string; teamId: string; role: TeamRole }>;
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
    sessions: sessionRepo,
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

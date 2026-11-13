/**
 * Resolusi sesi dari cookie. Satu jalur otorisasi (ADR-003).
 *
 * Token tidak pernah disimpan di DB — hanya SHA-256-nya (ENT-18). Karena itu
 * lookup dilakukan lewat hash, bukan token.
 */
import { createHash } from "node:crypto";
import { isSessionValid, type SessionContext } from "@kelindan/shared";

export interface SessionRepo {
  findByTokenHash(tokenHash: string): Promise<(SessionContext & { epochNow: number }) | null>;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "kelindan_session") return rest.join("=") || null;
  }
  return null;
}

export interface ResolvedAuth {
  userId: string;
  workspaceId: string;
  sessionId: string;
}

/**
 * Mengembalikan null bila tidak sah. Pemanggil WAJIB memperlakukan null sebagai
 * 401 — tidak ada jalur di mana "tidak ada sesi" berarti "boleh".
 */
export async function resolveAuth(
  cookieHeader: string | undefined,
  repo: SessionRepo,
  now: Date = new Date(),
): Promise<ResolvedAuth | null> {
  const token = readSessionCookie(cookieHeader);
  if (!token) return null;
  const row = await repo.findByTokenHash(hashToken(token));
  if (!row) return null;
  if (!isSessionValid(row, row.epochNow, now)) return null;
  return { userId: row.userId, workspaceId: row.workspaceId, sessionId: row.sessionId };
}

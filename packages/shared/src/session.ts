/**
 * Bentuk sesi yang dipakai server. Sengaja kecil & tanpa ketergantungan.
 * Penyimpanan sesi (sessions table) diakses lewat repository di server.
 */
export interface SessionContext {
  sessionId: string;
  userId: string;
  workspaceId: string;
  /** Salinan users.session_epoch saat sesi dibuat (FR-112). */
  epoch: number;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Sesi sah bila belum dicabut, belum kedaluwarsa, dan epoch masih sama. */
export function isSessionValid(
  s: SessionContext,
  currentEpoch: number,
  now: Date = new Date(),
): boolean {
  if (s.revokedAt !== null) return false;
  if (s.expiresAt.getTime() <= now.getTime()) return false;
  if (s.epoch !== currentEpoch) return false;
  return true;
}

/**
 * Repositori sesi (ENT-18). Ini adalah SATU-SATUNYA tempat token sesi
 * disentuh, dan aturannya tidak boleh dilanggar di sini:
 *
 *   Token asli (256 bit acak) HANYA dikembalikan sekali ke pemanggil, untuk
 *   dikirim ke klien sebagai cookie. Yang masuk database adalah SHA-256-nya.
 *
 * Konsekuensinya nyata dan disengaja: dump database tidak bisa dipakai untuk
 * membajak sesi. Operator yang bisa membaca `sessions` tetap tidak bisa
 * menjadi pengguna lain tanpa memecahkan SHA-256 preimage.
 *
 * `findSession` mengembalikan `epochNow` — epoch user SAAT INI, bukan epoch
 * yang tersimpan di sesi. Perbandingan keduanya terjadi di `isSessionValid()`
 * (shared), sehingga aturan "epoch lebih lama => ditolak" punya satu
 * implementasi saja, dan HTTP serta WebSocket memakai aturan yang sama persis.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Client } from "pg";
import type { SessionContext } from "@kelindan/shared";

export interface SessionRow extends SessionContext {
  epochNow: number;
}

export interface IssuedSession {
  /** Dikirim ke klien. TIDAK boleh dicatat ke log atau disimpan. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

/** Umur sesi. FR-112: "sesi berumur terbatas". 30 hari, diperpanjang saat dipakai. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Jeda minimum antar-update `last_seen_at` (menghindari write amplification). */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Token 256-bit dari CSPRNG. `base64url` dipakai karena aman di cookie tanpa
 * escaping, dan 32 byte => 43 karakter.
 */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Menerbitkan sesi. `workspaceId` boleh null: user yang login tetapi belum
 * memilih workspace punya sesi yang sah namun belum bisa menyentuh data
 * workspace mana pun.
 */
export async function createSession(
  db: Client,
  opts: {
    userId: string;
    workspaceId: string | null;
    ip?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
): Promise<IssuedSession> {
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const token = newToken();
  const tokenHash = hashSessionToken(token);

  // Epoch dibaca dari users pada saat penerbitan: bila admin menaikkan
  // session_epoch kelak, semua sesi lama otomatis tidak sah (FR-112 < 60 s).
  const { rows } = await db.query<{ session_epoch: number }>(
    "SELECT session_epoch FROM users WHERE id = $1 AND deleted_at IS NULL",
    [opts.userId],
  );
  const user = rows[0];
  if (!user) {
    // Tidak mungkin terjadi lewat jalur login (user baru saja dibaca), tetapi
    // bila terjadi, kegagalan harus jelas — bukan sesi dengan epoch 0.
    throw new Error("createSession: user tidak ditemukan atau sudah dihapus");
  }

  const { rows: created } = await db.query<{ id: string }>(
    `INSERT INTO sessions (id, workspace_id, user_id, token_hash, created_at, last_seen_at, expires_at, epoch, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      // UUIDv7 tidak tersedia di Node 22 secara publik; kolomnya hanya butuh
      // uuid. Dibuat dari randomBytes agar tidak butuh dependensi.
      randomUuid(),
      opts.workspaceId,
      opts.userId,
      tokenHash,
      now.toISOString(),
      expiresAt.toISOString(),
      user.session_epoch,
      opts.ip ?? null,
      opts.userAgent ?? null,
    ],
  );

  return { token, sessionId: created[0]!.id, expiresAt };
}

/**
 * Mencari sesi lewat HASH token. Tidak ada jalur lain: token asli tidak
 * tersimpan, jadi tidak mungkin mencari dengan token.
 */
export async function findSession(db: Client, token: string): Promise<SessionRow | null> {
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    workspace_id: string | null;
    epoch: number;
    expires_at: Date;
    revoked_at: Date | null;
    epoch_now: number;
  }>(
    `SELECT s.id, s.user_id, s.workspace_id, s.epoch, s.expires_at, s.revoked_at,
            u.session_epoch AS epoch_now
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [hashSessionToken(token)],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    sessionId: r.id,
    userId: r.user_id,
    // Sesi tanpa workspace tetap dikembalikan; pemanggil yang memutuskan.
    workspaceId: r.workspace_id ?? "",
    epoch: r.epoch,
    expiresAt: new Date(r.expires_at),
    revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
    epochNow: r.epoch_now,
  };
}

/** Mencabut SATU sesi (logout). Idempoten: sesi yang sudah tercabut tetap dianggap berhasil. */
export async function revokeSession(db: Client, token: string, now: Date = new Date()): Promise<boolean> {
  const { rowCount } = await db.query(
    "UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL",
    [hashSessionToken(token), now.toISOString()],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Mencabut SEMUA sesi user dengan menaikkan `session_epoch`, lalu menandai
 * baris sesi yang ada sebagai tercabut supaya aktivitas yang sedang berjalan
 * langsung berhenti — tidak menunggu pemeriksaan epoch berikutnya.
 *
 * KENAPA DUA LANGKAH: epoch menutup sesi yang BELUM ada (mis. token yang
 * dicuri lalu dipakai setelah reset password), sedangkan `revoked_at` menutup
 * sesi yang SUDAH ada. Satu langkah saja meninggalkan celah.
 */
export async function revokeAllSessions(
  db: Client,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  await db.query("BEGIN");
  try {
    await db.query("UPDATE users SET session_epoch = session_epoch + 1 WHERE id = $1", [userId]);
    const { rowCount } = await db.query(
      "UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL",
      [userId, now.toISOString()],
    );
    await db.query("COMMIT");
    return rowCount ?? 0;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

/**
 * Memperbarui `last_seen_at` paling sering sekali per 5 menit. Dipanggil pada
 * setiap request yang sah; tanpa jeda ini, setiap GET menjadi satu UPDATE dan
 * tabel sesi menjadi titik panas tulis.
 */
export async function touchSession(
  db: Client,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.query(
    `UPDATE sessions SET last_seen_at = $2
      WHERE id = $1 AND last_seen_at < $3`,
    [sessionId, now.toISOString(), new Date(now.getTime() - TOUCH_INTERVAL_MS).toISOString()],
  );
}

/** Pembersihan sesi kedaluwarsa. Dipanggil terjadwal, bukan pada jalur request. */
export async function purgeExpiredSessions(db: Client, now: Date = new Date()): Promise<number> {
  const { rowCount } = await db.query(
    // Sesi tercabut disimpan 7 hari sebagai jejak audit (FR-305), lalu dibuang.
    `DELETE FROM sessions
      WHERE expires_at < $1
         OR (revoked_at IS NOT NULL AND revoked_at < $2)`,
    [now.toISOString(), new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()],
  );
  return rowCount ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Util                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * UUID apa adanya dari 16 byte acak. Tidak butuh dependensi, dan kolom
 * `sessions.id` hanya menuntut bentuk uuid — bukan urutan waktu.
 */
function randomUuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40; // versi 4
  b[8] = (b[8]! & 0x3f) | 0x80; // varian RFC 4122
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

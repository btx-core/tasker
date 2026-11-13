/**
 * Rute autentikasi (FR-112). Tipis seperti rute lain: parse -> use-case ->
 * bentuk respons. Keputusan keamanan ada di `auth/login.ts`.
 *
 * KENAPA `POST /v1/auth/login` PUBLIK: sudah jelas — orang yang belum punya
 * sesi harus bisa mendapatkannya. Rute logout & `/me` WAJIB sesi.
 */
import { ApiError, ERROR_CODES } from "@kelindan/shared";
import { findSession, revokeAllSessions, revokeSession, touchSession } from "@kelindan/db";
import type { Client } from "pg";
import type { Router } from "./router.js";
import { clearSessionCookie, login, sessionCookie } from "../auth/login.js";
import { hashToken } from "../authz/session.js";
import { readSessionCookie } from "../authz/session.js";

export interface AuthRouteDeps {
  db: () => Promise<Client>;
  /** false pada deployment tanpa TLS (dev lokal). Default true. */
  cookieSecure?: boolean;
}

export function registerAuthRoutes(router: Router, deps: AuthRouteDeps): void {
  const secure = deps.cookieSecure ?? true;

  /**
   * NFR-014: 10 percobaan/menit/IP. `rateLimit` di-deklarasikan pada rute
   * (bukan di dalam handler) supaya pemeriksaan itu terjadi SEBELUM body
   * dibaca dan sebelum password di-hash — percobaan yang diblokir tidak boleh
   * membebani CPU.
   */
  router.add(
    "POST",
    "/v1/auth/login",
    async (ctx) => {
      const body = (ctx.body ?? {}) as { email?: unknown; password?: unknown };
      const result = await login(
        { db: deps.db },
        {
          email: body.email,
          password: body.password,
          ip: ctx.clientIp,
          userAgent: ctx.req.headers["user-agent"] ?? null,
        },
      );
      return {
        status: 200,
        body: {
          user: result.user,
          session: { expires_at: result.expiresAt.toISOString() },
        },
        headers: { "set-cookie": sessionCookie(result.token, result.expiresAt, secure) },
      };
    },
    { requiresAuth: false, rateLimit: { max: 10, windowMs: 60_000 } },
  );

  /**
   * Logout. Idempoten: tanpa sesi sah pun mengembalikan 204, karena klien
   * yang ingin keluar tidak boleh diberi tahu "gagal keluar".
   */
  router.add("POST", "/v1/auth/logout", async (ctx) => {
    const token = readSessionCookie(ctx.req.headers.cookie);
    const db = await deps.db();
    if (token) await revokeSession(db, token);
    return {
      status: 204,
      body: undefined,
      headers: { "set-cookie": clearSessionCookie(secure) },
    };
  });

  /**
   * Keluar dari SEMUA perangkat. Menaikkan `session_epoch`, sehingga token yang
   * sudah dicuri tetapi belum dipakai pun ikut mati.
   */
  router.add("POST", "/v1/auth/logout-all", async (ctx) => {
    const auth = ctx.auth;
    if (!auth) throw new ApiError(401, ERROR_CODES.UNAUTHENTICATED, "Sesi tidak sah");
    const db = await deps.db();
    const count = await revokeAllSessions(db, auth.userId);
    return {
      status: 200,
      body: { revoked: count },
      headers: { "set-cookie": clearSessionCookie(secure) },
    };
  });

  /**
   * Identitas pemanggil. Ini yang dipakai UI untuk memutuskan tampil halaman
   * login atau board — bukan menebak dari keberadaan cookie.
   */
  router.add("GET", "/v1/me", async (ctx) => {
    const auth = ctx.auth;
    if (!auth) throw new ApiError(401, ERROR_CODES.UNAUTHENTICATED, "Sesi tidak sah");
    const db = await deps.db();
    const { rows } = await db.query<{ display_name: string; email: string }>(
      "SELECT display_name, email FROM users WHERE id = $1",
      [auth.userId],
    );
    const user = rows[0];
    if (!user) throw ApiError.notFound("Pengguna");
    return {
      status: 200,
      body: {
        user: { id: auth.userId, display_name: user.display_name, email: user.email },
        workspace_id: auth.workspaceId,
        session_id: auth.sessionId,
      },
    };
  });

  /**
   * Menandai sesi baru saja dipakai. Dipanggil UI sesekali, bukan setiap
   * request; `touchSession` sendiri menjeda 5 menit supaya ini tidak menjadi
   * titik panas tulis.
   */
  router.add("POST", "/v1/auth/touch", async (ctx) => {
    const auth = ctx.auth;
    if (!auth) throw new ApiError(401, ERROR_CODES.UNAUTHENTICATED, "Sesi tidak sah");
    const db = await deps.db();
    await touchSession(db, auth.sessionId);
    const row = await findSession(db, readSessionCookie(ctx.req.headers.cookie) ?? "");
    return {
      status: 200,
      body: { expires_at: row?.expiresAt.toISOString() ?? null },
    };
  });

  // Dipakai uji: memastikan token yang tersimpan memang hash, bukan token asli.
  void hashToken;
}

/**
 * Perakitan aplikasi HTTP. `createApp()` menerima dependensi agar bisa diuji
 * tanpa jaringan dan tanpa Postgres nyata (uji memakai PGlite).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { traceIdFrom } from "@kelindan/shared";
import { Router, readJsonBody, sendJson, toErrorBody, type RequestContext } from "./http/router.js";
import { registerRoutes, type Deps } from "./http/routes.js";
import { registerAuthRoutes, type AuthRouteDeps } from "./http/auth-routes.js";
import { resolveAuth, type SessionRepo } from "./authz/session.js";
import { clientIp, createRateLimiter, loginRateLimitKey, type RateLimiter } from "./auth/rate-limit.js";

export interface AppDeps extends Deps {
  sessions: SessionRepo;
  /** Untuk rute auth (login/logout/me). Bila tidak diisi, rute auth tidak didaftarkan. */
  auth?: AuthRouteDeps;
  /** Disuntik pada uji supaya batas laju bisa dikendalikan; default 10/menit. */
  rateLimiter?: RateLimiter;
  /**
   * Penangan untuk path yang bukan rute API (mis. berkas statis UI).
   * Mengembalikan true bila sudah ditangani. Dipakai `dev-server` supaya UI
   * dan API berbagi SATU origin — browser pengguna tidak boleh memanggil
   * localhost, dan satu origin menghilangkan kebutuhan CORS.
   */
  staticHandler?: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;
}

export interface App {
  server: Server;
  listen(port: number, host?: string): Promise<{ port: number }>;
  close(): Promise<void>;
}

export function createApp(deps: AppDeps): App {
  const router = new Router();
  registerRoutes(router, deps);
  if (deps.auth) registerAuthRoutes(router, deps.auth);

  const limiter = deps.rateLimiter ?? createRateLimiter({ max: 10, windowMs: 60_000 });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const traceId = traceIdFrom(req.headers["x-trace-id"] as string | undefined);
    res.setHeader("x-trace-id", traceId);

    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const found = router.match(req.method ?? "GET", url.pathname);
      if (!found) {
        if (deps.staticHandler && !url.pathname.startsWith("/v1/")) {
          if (await deps.staticHandler(req, res, url)) return;
        }
        sendJson(res, 404, {
          code: "resource.not_found",
          message: "Endpoint tidak ditemukan",
          trace_id: traceId,
        });
        return;
      }

      const ip = clientIp(req.headers as Record<string, unknown>);

      /**
       * Pembatas laju diperiksa SEBELUM body dibaca: percobaan yang diblokir
       * tidak boleh menghabiskan CPU untuk JSON.parse maupun scrypt.
       *
       * Kunci login = IP + email. IP saja akan membuat satu kantor ber-NAT
       * saling memblokir; lihat komentar di `loginRateLimitKey`.
       */
      if (found.route.rateLimit) {
        const bodyForKey = found.route.pattern === "/v1/auth/login"
          ? await peekEmailCached(req)
          : null;
        const key = bodyForKey === null
          ? `ip|${ip}|${found.route.pattern}`
          : loginRateLimitKey(ip, bodyForKey);
        const verdict = limiter.hit(key);
        if (!verdict.allowed) {
          sendJson(res, 429, {
            code: "rate.limited",
            message: `Terlalu banyak percobaan. Coba lagi dalam ${verdict.retryAfterSeconds} detik`,
            trace_id: traceId,
          }, { "retry-after": String(verdict.retryAfterSeconds) });
          return;
        }
      }

      /**
       * Bila pembatas laju sudah membaca body, pakai itu. Membaca ulang akan
       * mendapat stream kosong.
       */
      const cached = (req as IncomingMessage & { __kelindanBody?: unknown }).__kelindanBody;
      const body = req.method === "GET"
        ? undefined
        : cached !== undefined ? cached : await readJsonBody(req);

      let auth: RequestContext["auth"];
      if (found.route.requiresAuth) {
        const resolved = await resolveAuth(req.headers.cookie, deps.sessions);
        if (!resolved) {
          sendJson(res, 401, {
            code: "auth.unauthenticated",
            message: "Sesi tidak sah atau kedaluwarsa",
            trace_id: traceId,
          });
          return;
        }
        auth = resolved;
      }

      const result = await found.route.handler({
        req, url, traceId, params: found.params, body, clientIp: ip, ...(auth ? { auth } : {}),
      });
      sendJson(res, result.status, result.body, result.headers ?? {});
    } catch (err) {
      const { status, body } = toErrorBody(err, traceId);
      if (status >= 500) {
        // Log tanpa PII (architecture.md §4): hanya trace & jenis error.
        console.error(JSON.stringify({
          level: "error", trace_id: traceId, path: req.url,
          error: err instanceof Error ? err.message : "unknown",
        }));
      }
      sendJson(res, status, body);
    }
  });

  return {
    server,
    listen(port, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const addr = server.address();
          resolve({ port: typeof addr === "object" && addr ? addr.port : port });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Membaca body SEKALI lalu menyimpannya untuk handler, mengembalikan email
 * bila ada.
 *
 * KENAPA PERLU `peek`: pembatas laju harus berjalan sebelum handler, tetapi
 * kuncinya butuh email dari body. Tanpa penyimpanan ini `readJsonBody` akan
 * membaca stream yang sudah habis — dan login yang sah akan gagal dengan body
 * kosong, tepat setelah lolos pembatas.
 *
 * Body yang bukan JSON TIDAK dianggap gagal di sini: validasi tetap milik
 * `readJsonBody`/handler, supaya bentuk error untuk body rusak tidak berubah
 * hanya karena rutenya punya batas laju.
 */
async function peekEmailCached(req: IncomingMessage): Promise<string | null> {
  const holder = req as IncomingMessage & { __kelindanBody?: unknown };
  const body = await readJsonBody(req);
  holder.__kelindanBody = body;
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email : null;
}

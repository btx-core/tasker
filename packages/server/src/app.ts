/**
 * Perakitan aplikasi HTTP. `createApp()` menerima dependensi agar bisa diuji
 * tanpa jaringan dan tanpa Postgres nyata (uji memakai PGlite).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { traceIdFrom } from "@kelindan/shared";
import { Router, readJsonBody, sendJson, toErrorBody, type RequestContext } from "./http/router.js";
import { registerRoutes, type Deps } from "./http/routes.js";
import { resolveAuth, type SessionRepo } from "./authz/session.js";

export interface AppDeps extends Deps {
  sessions: SessionRepo;
}

export interface App {
  server: Server;
  listen(port: number, host?: string): Promise<{ port: number }>;
  close(): Promise<void>;
}

export function createApp(deps: AppDeps): App {
  const router = new Router();
  registerRoutes(router, deps);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const traceId = traceIdFrom(req.headers["x-trace-id"] as string | undefined);
    res.setHeader("x-trace-id", traceId);

    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const found = router.match(req.method ?? "GET", url.pathname);
      if (!found) {
        sendJson(res, 404, {
          code: "resource.not_found",
          message: "Endpoint tidak ditemukan",
          trace_id: traceId,
        });
        return;
      }

      const body = req.method === "GET" ? undefined : await readJsonBody(req);

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
        req, url, traceId, params: found.params, body, ...(auth ? { auth } : {}),
      });
      sendJson(res, result.status, result.body);
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

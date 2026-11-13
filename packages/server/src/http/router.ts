/**
 * Router HTTP minimal, tanpa dependensi.
 *
 * KENAPA TANPA FASTIFY (menyimpang dari repo-layout.md §2 yang menyebut Fastify):
 * fase ini harus MEMBUKTIKAN kebenaran jalur tulis, bukan memilih framework.
 * Setiap dependensi menambah permukaan yang harus dipercaya dan diuji sebelum
 * ada satu pengguna pun. Router ini ~100 baris, deterministik, dan seluruh
 * kontraknya ada di tangan kita.
 *
 * Konsekuensi yang DITERIMA: tanpa validasi skema bawaan, tanpa plugin, tanpa
 * HTTP/2, tanpa optimasi routing. Semua itu tidak dibutuhkan untuk membuktikan
 * ADR-015/017.
 *
 * KAPAN DIGANTI: sebelum P4 (UI board), ketika kebutuhan middleware nyata
 * (CORS, rate limit, multipart untuk media) muncul — dan saat itu terjadi,
 * rute & handler tidak perlu berubah karena logika ada di `routes.ts`.
 *
 * Didaftarkan sebagai temuan T-11 di docs/todo.md.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, ERROR_CODES, type ApiErrorBody } from "@kelindan/shared";

export interface RequestContext {
  req: IncomingMessage;
  url: URL;
  traceId: string;
  params: Record<string, string>;
  body: unknown;
  /** Diisi oleh middleware autentikasi. */
  auth?: { userId: string; workspaceId: string; sessionId: string };
}

export type Handler = (ctx: RequestContext) => Promise<{ status: number; body: unknown }>;

interface Route {
  method: string;
  pattern: string;
  segments: string[];
  handler: Handler;
  /** false untuk rute publik (mis. /health). Default: wajib sesi. */
  requiresAuth: boolean;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, opts: { requiresAuth?: boolean } = {}): this {
    this.routes.push({
      method,
      pattern,
      segments: pattern.split("/").filter(Boolean),
      handler,
      requiresAuth: opts.requiresAuth ?? true,
    });
    return this;
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i]!;
        const part = parts[i]!;
        if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(part);
        else if (seg !== part) { ok = false; break; }
      }
      if (ok) return { route, params };
    }
    return null;
  }
}

export const MAX_BODY_BYTES = 256 * 1024;

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new ApiError(413, ERROR_CODES.UNSUPPORTED_PAYLOAD, `body melebihi ${MAX_BODY_BYTES} byte`);
    }
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw ApiError.validation("body bukan JSON yang sah");
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * Bentuk error TUNGGAL (api-contract.md §5). Tidak ada handler yang boleh
 * mengirim bentuk error sendiri — itu yang membuat `code` tetap bisa dipakai
 * klien sebagai kontrak.
 */
export function toErrorBody(err: unknown, traceId: string): { status: number; body: ApiErrorBody } {
  if (err instanceof ApiError) {
    const b: ApiErrorBody = {
      code: err.code,
      message: err.message,
      trace_id: traceId,
      ...(err.field !== undefined ? { field: err.field } : {}),
      ...(err.current !== undefined ? { current: err.current } : {}),
    };
    return { status: err.status, body: b };
  }
  // Error tak terduga: JANGAN bocorkan pesan internal ke klien.
  return {
    status: 500,
    body: { code: ERROR_CODES.INTERNAL, message: "Terjadi kesalahan internal", trace_id: traceId },
  };
}

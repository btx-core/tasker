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
  /**
   * IP klien untuk pembatas laju. Diisi lapisan HTTP karena hanya di sana
   * header proxy tersedia; use-case tidak boleh membaca header mentah.
   */
  clientIp: string;
}

/**
 * Hasil handler. `headers` opsional ditambahkan ke respons.
 *
 * KENAPA DIPERLUKAN: login harus mengirim `Set-Cookie`, dan rate limit harus
 * mengirim `Retry-After` (NFR-014). Tanpa jalur ini, satu-satunya alternatif
 * adalah menulis langsung ke `ServerResponse` dari dalam handler — yang
 * memindahkan pengetahuan HTTP ke lapisan use-case dan membuat kontrak
 * `{status, body}` (satu-satunya alasan `routes.ts` bisa diuji tanpa jaringan)
 * bocor.
 */
export interface HandlerResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type Handler = (ctx: RequestContext) => Promise<HandlerResult>;

interface Route {
  method: string;
  pattern: string;
  segments: string[];
  handler: Handler;
  /** false untuk rute publik (mis. /health). Default: wajib sesi. */
  requiresAuth: boolean;
  /**
   * Batas percobaan per IP (NFR-014), mis. `{ max: 10, windowMs: 60_000 }`.
   * Tidak diset = tanpa batas. Dipakai login, yang menjadi sasaran tebak
   * password.
   */
  rateLimit?: { max: number; windowMs: number };
}

export class Router {
  private routes: Route[] = [];

  add(
    method: string,
    pattern: string,
    handler: Handler,
    opts: { requiresAuth?: boolean; rateLimit?: { max: number; windowMs: number } } = {},
  ): this {
    this.routes.push({
      method,
      pattern,
      segments: pattern.split("/").filter(Boolean),
      handler,
      requiresAuth: opts.requiresAuth ?? true,
      ...(opts.rateLimit ? { rateLimit: opts.rateLimit } : {}),
    });
    return this;
  }

  /** Dipakai tes & diagnosa: pola terdaftar, tanpa membocorkan handler. */
  list(): Array<{ method: string; pattern: string; requiresAuth: boolean }> {
    return this.routes.map((r) => ({
      method: r.method, pattern: r.pattern, requiresAuth: r.requiresAuth,
    }));
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

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  /**
   * 204 TIDAK PUNYA BODY, dan `JSON.stringify(undefined)` mengembalikan
   * `undefined` — yang membuat `Buffer.byteLength(undefined)` melempar
   * TypeError. Bug ini muncul sebagai **500 pada logout** (yang memang 204),
   * bukan sebagai galat di tempat yang terlihat berhubungan.
   */
  if (body === undefined || status === 204) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    ...headers,
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
  /**
   * Pool koneksi penuh (T-49). Ini BUKAN galat internal: tidak ada bug, dan
   * mencoba lagi dalam sedetik biasanya berhasil. Sebelum ini, kehabisan
   * koneksi tampil sebagai `internal.error` 500 — klien menyerah dan pengguna
   * mengetik ulang datanya, padahal tidak ada yang rusak.
   *
   * Dideteksi dari pesan karena `pg` tidak memberi kode galat terstruktur untuk
   * kasus ini. Pencocokan sengaja sempit (dua frasa yang stabil di `pg`) supaya
   * tidak menelan galat lain yang kebetulan menyebut "connection".
   */
  const msg = err instanceof Error ? err.message : "";
  if (/timeout exceeded when trying to connect|remaining connection slots are reserved|too many clients already/i.test(msg)) {
    return {
      status: 503,
      body: {
        code: ERROR_CODES.SERVER_BUSY,
        message: "Server sedang sibuk, coba lagi sebentar lagi",
        trace_id: traceId,
      },
    };
  }
  // Error tak terduga: JANGAN bocorkan pesan internal ke klien.
  return {
    status: 500,
    body: { code: ERROR_CODES.INTERNAL, message: "Terjadi kesalahan internal", trace_id: traceId },
  };
}

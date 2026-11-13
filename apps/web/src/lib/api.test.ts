/**
 * P4-01: retry TIDAK boleh melahirkan duplikat.
 * Ini bukan teori: setiap jaringan buruk memutus respons SETELAH server
 * memproses, dan klien akan mencoba lagi.
 */
import { describe, expect, it } from "vitest";
import { HttpClient } from "./api.js";

interface Call { key: string | undefined; body: string | undefined }

function scriptedFetch(responses: Array<() => Promise<Response> | Response>): {
  impl: typeof fetch; calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ key: headers["idempotency-key"], body: init?.body as string | undefined });
    const next = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const noSleep = () => Promise.resolve();

describe("HttpClient — Idempotency-Key", () => {
  it("GET tidak mengirim Idempotency-Key", async () => {
    const { impl, calls } = scriptedFetch([() => json(200, { ok: true })]);
    const c = new HttpClient({ fetchImpl: impl, sleep: noSleep });
    await c.board("t1");
    expect(calls[0]!.key).toBeUndefined();
  });

  it("PATCH mengirim kunci otomatis berbentuk UUID", async () => {
    const { impl, calls } = scriptedFetch([() => json(200, { task: { version: 2 }, seq: 1, replayed: false })]);
    const c = new HttpClient({ fetchImpl: impl, sleep: noSleep });
    await c.patchTask("t1", { title: "x" });
    expect(calls[0]!.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("retry memakai KUNCI YANG SAMA (inti idempotensi)", async () => {
    const { impl, calls } = scriptedFetch([
      () => json(503, { code: "server.busy", message: "sibuk", trace_id: "t" }),
      () => json(200, { task: { version: 2 }, seq: 1, replayed: true }),
    ]);
    const c = new HttpClient({ fetchImpl: impl, sleep: noSleep });
    const r = await c.patchTask("t1", { title: "x" });
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[0]!.key).toBe(calls[1]!.key);
    expect(calls[0]!.body).toBe(calls[1]!.body);
  });

  it("galat jaringan diulang dengan kunci yang sama, lalu menyerah dengan rapi", async () => {
    const { impl, calls } = scriptedFetch([
      () => Promise.reject(new Error("ECONNRESET")),
      () => Promise.reject(new Error("ECONNRESET")),
      () => Promise.reject(new Error("ECONNRESET")),
    ]);
    const c = new HttpClient({ fetchImpl: impl, sleep: noSleep, maxAttempts: 3 });
    const r = await c.patchTask("t1", { title: "x" });
    expect(r.ok).toBe(false);
    expect(r.error?.retryable).toBe(true);
    expect(new Set(calls.map((x) => x.key)).size).toBe(1);
  });

  it("409 konflik TIDAK diulang (mengulang tidak akan mengubah apa pun)", async () => {
    const { impl, calls } = scriptedFetch([
      () => json(409, { code: "conflict.version", message: "basi", trace_id: "tr", current: { version: 9 } }),
    ]);
    const c = new HttpClient({ fetchImpl: impl, sleep: noSleep });
    const r = await c.patchTask("t1", { title: "x" });
    expect(calls.length).toBe(1);
    expect(r.error?.code).toBe("conflict.version");
    expect(r.error?.current).toEqual({ version: 9 });
    expect(r.error?.trace_id).toBe("tr");
  });
});

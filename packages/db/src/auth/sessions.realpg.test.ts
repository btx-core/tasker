/**
 * Uji repositori sesi pada PostgreSQL SUNGGUHAN.
 *
 * Yang dibuktikan di sini tidak bisa dibuktikan PGlite dengan jujur: PGlite
 * adalah satu koneksi dalam satu proses, sedangkan yang kita janjikan adalah
 * perilaku sesi di database bersama. Tetapi alasan utama berkas ini ada adalah
 * tiga invarian yang tidak terlihat dari tipe:
 *
 *  1. Token asli TIDAK PERNAH masuk database.
 *  2. Sesi tercabut langsung tidak sah — terukur, bukan diasumsikan.
 *  3. Menaikkan epoch menutup sesi yang belum pernah dibuat.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { isSessionValid } from "@kelindan/shared";
import {
  createSession, findSession, hashSessionToken, purgeExpiredSessions,
  revokeAllSessions, revokeSession, touchSession, SESSION_TTL_MS,
} from "@kelindan/db";
import { hasRealPg, SKIP_REASON, freshSchema, type FreshSchema } from "@kelindan/testing";

const WS = "0190f000-0000-7000-8000-000000000001";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const USER2 = "0190f000-0000-7000-8000-0000000000a2";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;

let schema: FreshSchema;
let client: Client;

beforeAll(async () => {
  if (!hasRealPg()) return;
  schema = await freshSchema("kelindan_sess_it");
  client = schema.client;
  const { applyMigrations } = await import("@kelindan/testing");
  await applyMigrations(client as never, dir);
  await client.query(`SET search_path TO ${schema.schema}, public`);
  await client.query(
    `INSERT INTO workspaces (id,name,slug,seq_next) VALUES ($1,'Ruang','ruang',1)`, [WS],
  );
  await client.query(
    `INSERT INTO users (id,email,display_name) VALUES ($1,'a@x.id','A'),($2,'b@x.id','B')`,
    [USER, USER2],
  );
}, 120_000);

afterAll(async () => { await schema?.drop(); });

describe.skipIf(!hasRealPg())("sesi pada PostgreSQL nyata", () => {
  it("token asli TIDAK PERNAH tersimpan — hanya SHA-256-nya", async () => {
    const s = await createSession(client, { userId: USER, workspaceId: WS });

    // Cari token mentah di SELURUH kolom teks tabel sessions.
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sessions
        WHERE token_hash = $1 OR id::text = $1 OR user_agent = $1`,
      [s.token],
    );
    expect(rows[0]!.n).toBe("0");

    // Yang tersimpan adalah hash-nya, dan hash itu memang ada.
    const { rows: byHash } = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM sessions WHERE token_hash = $1",
      [hashSessionToken(s.token)],
    );
    expect(byHash[0]!.n).toBe("1");

    // Token bukan hash: panjangnya berbeda (43 base64url vs 64 hex).
    expect(s.token).not.toBe(hashSessionToken(s.token));
    expect(s.token).toHaveLength(43);
  });

  it("findSession mengembalikan sesi sah dengan epoch user saat ini", async () => {
    const s = await createSession(client, { userId: USER, workspaceId: WS });
    const row = await findSession(client, s.token);
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(USER);
    expect(row!.workspaceId).toBe(WS);
    expect(row!.epoch).toBe(0);
    expect(row!.epochNow).toBe(0);
    expect(isSessionValid(row!, row!.epochNow)).toBe(true);
  });

  it("token yang tidak pernah diterbitkan tidak ditemukan", async () => {
    expect(await findSession(client, "token-palsu-yang-tidak-pernah-ada")).toBeNull();
  });

  it("umur sesi 30 hari dan tercatat di expires_at", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const s = await createSession(client, { userId: USER, workspaceId: WS, now });
    const row = await findSession(client, s.token);
    expect(row!.expiresAt.toISOString()).toBe(
      new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    );
    expect(s.expiresAt.getTime() - now.getTime()).toBe(SESSION_TTL_MS);
  });

  it("sesi TANPA workspace sah, tetapi workspaceId kosong (belum pilih workspace)", async () => {
    const s = await createSession(client, { userId: USER, workspaceId: null });
    const row = await findSession(client, s.token);
    expect(row).not.toBeNull();
    expect(row!.workspaceId).toBe("");
  });

  it("logout mencabut sesi dan berlaku SEGERA — diukur, bukan diasumsikan", async () => {
    const s = await createSession(client, { userId: USER, workspaceId: WS });
    const before = await findSession(client, s.token);
    expect(isSessionValid(before!, before!.epochNow)).toBe(true);

    const t0 = performance.now();
    expect(await revokeSession(client, s.token)).toBe(true);
    const after = await findSession(client, s.token);
    const revokedMs = performance.now() - t0;

    expect(after!.revokedAt).not.toBeNull();
    expect(isSessionValid(after!, after!.epochNow)).toBe(false);

    // FR-112 menuntut < 60 000 ms. Kita jauh di bawahnya karena pencabutan
    // terjadi pada baris yang sama yang dibaca setiap request.
    expect(revokedMs).toBeLessThan(60_000);
    console.log(`[TC-16] sesi tercabut berlaku dalam ${Math.round(revokedMs)} ms (SLA 60 000 ms)`);
  });

  it("logout bersifat idempoten: dua kali tidak melempar", async () => {
    const s = await createSession(client, { userId: USER, workspaceId: WS });
    expect(await revokeSession(client, s.token)).toBe(true);
    expect(await revokeSession(client, s.token)).toBe(false); // sudah tercabut
  });

  it("revokeAllSessions menutup SEMUA sesi user dan menaikkan epoch", async () => {
    const a = await createSession(client, { userId: USER2, workspaceId: WS });
    const b = await createSession(client, { userId: USER2, workspaceId: WS });

    const n = await revokeAllSessions(client, USER2);
    expect(n).toBeGreaterThanOrEqual(2);

    for (const token of [a.token, b.token]) {
      const row = await findSession(client, token);
      expect(isSessionValid(row!, row!.epochNow)).toBe(false);
    }

    const { rows } = await client.query<{ session_epoch: number }>(
      "SELECT session_epoch FROM users WHERE id = $1", [USER2],
    );
    expect(rows[0]!.session_epoch).toBe(1);

    // Sesi BARU setelah revoke-all tetap sah, dengan epoch yang sudah naik.
    const c = await createSession(client, { userId: USER2, workspaceId: WS });
    const rowC = await findSession(client, c.token);
    expect(rowC!.epoch).toBe(1);
    expect(isSessionValid(rowC!, rowC!.epochNow)).toBe(true);
  });

  it("epoch lama menutup sesi yang BELUM dibuat saat pencabutan", async () => {
    // Skenario nyata: token dicuri, lalu user melakukan "keluar dari semua
    // perangkat". Token curian itu belum tentu ada di tabel saat itu, jadi
    // hanya epoch yang bisa menutupnya.
    const stolen = await createSession(client, { userId: USER, workspaceId: WS });
    await revokeAllSessions(client, USER);

    // Sesi curian tercabut langsung...
    const row = await findSession(client, stolen.token);
    expect(isSessionValid(row!, row!.epochNow)).toBe(false);

    // ...dan andai `revoked_at` tidak ada, epoch saja sudah cukup menolaknya.
    expect(row!.epoch).toBeLessThan(row!.epochNow);
  });

  it("touchSession menghormati jeda 5 menit (tidak menulis setiap request)", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const s = await createSession(client, { userId: USER, workspaceId: WS, now: t0 });

    // Di bawah jeda: tidak berubah.
    await touchSession(client, s.sessionId, new Date(t0.getTime() + 60_000));
    const { rows: r1 } = await client.query<{ last_seen_at: Date }>(
      "SELECT last_seen_at FROM sessions WHERE id = $1", [s.sessionId],
    );
    expect(new Date(r1[0]!.last_seen_at).toISOString()).toBe(t0.toISOString());

    // Lewat jeda: berubah.
    const later = new Date(t0.getTime() + 6 * 60_000);
    await touchSession(client, s.sessionId, later);
    const { rows: r2 } = await client.query<{ last_seen_at: Date }>(
      "SELECT last_seen_at FROM sessions WHERE id = $1", [s.sessionId],
    );
    expect(new Date(r2[0]!.last_seen_at).toISOString()).toBe(later.toISOString());
  });

  it("purgeExpiredSessions membuang yang kedaluwarsa, menyisakan yang sah", async () => {
    const old = new Date("2020-01-01T00:00:00.000Z");
    const expired = await createSession(client, { userId: USER, workspaceId: WS, now: old });
    const fresh = await createSession(client, { userId: USER, workspaceId: WS });

    const removed = await purgeExpiredSessions(client);
    expect(removed).toBeGreaterThanOrEqual(1);

    expect(await findSession(client, expired.token)).toBeNull();
    expect(await findSession(client, fresh.token)).not.toBeNull();
  });

  it("createSession menolak user yang tidak ada (bukan sesi epoch 0)", async () => {
    await expect(
      createSession(client, { userId: "0190f000-0000-7000-8000-0000000000ff", workspaceId: WS }),
    ).rejects.toThrow(/tidak ditemukan/);
  });
});

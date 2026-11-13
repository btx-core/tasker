/**
 * T-49: `createDbPool` benar-benar memakai pool, bukan satu koneksi.
 *
 * KENAPA diuji: keseluruhan gunanya adalah agar request TIDAK saling
 * memblokir. Satu koneksi yang dipakai bergiliran juga akan "lulus" uji
 * fungsional apa pun — semua query tetap berhasil, hanya lambat. Karena itu
 * uji ini menegaskan hal yang membedakannya: beberapa klien bisa dipakai
 * BERSAMAAN, dan jumlah koneksi yang dibuat bertambah sampai batas `max`.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * Tiruan `pg.Pool` yang menghitung koneksi & `release`.
 *
 * `vi.mock` dipakai karena `db-pool.ts` mengimpor `pg` secara langsung; tanpa
 * itu uji ini butuh PostgreSQL jaringan, yang membuatnya dilewati di CI dan
 * tidak membuktikan apa pun di sana.
 */
const created: Array<{ id: number; released: number }> = [];
let nextId = 1;
let maxSeen = 0;

vi.mock("pg", () => {
  class FakePool {
    private idle: Array<{ id: number; released: number }> = [];
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
    max: number;
    constructor(opts: { max?: number }) { this.max = opts.max ?? 10; }
    async connect() {
      let c = this.idle.pop();
      if (!c) {
        if (this.totalCount >= this.max) {
          // Meniru `connectionTimeoutMillis`: pg menolak dengan pesan ini.
          throw new Error("timeout exceeded when trying to connect");
        }
        c = { id: nextId++, released: 0 };
        created.push(c);
        this.totalCount++;
        maxSeen = Math.max(maxSeen, this.totalCount);
      }
      const self = this;
      const conn = {
        id: c.id,
        async query() { return { rows: [], rowCount: 0 }; },
        release() {
          c!.released++;
          self.totalCount--;
          self.idleCount++;
          self.idle.push(c!);
        },
      };
      return conn;
    }
    on() { /* handler error tidak diuji di sini */ }
    async end() { this.idle = []; }
    stats() { return { total: this.totalCount, idle: this.idleCount, waiting: 0 }; }
  }
  return { default: { Pool: FakePool }, Pool: FakePool };
});

const { createDbPool } = await import("./db-pool.js");

describe("T-49 createDbPool", () => {
  it("melayani 5 permintaan BERSAMAAN dengan 5 koneksi berbeda", async () => {
    created.length = 0;
    const p = createDbPool({ connectionString: "postgres://x/y", max: 10 });
    const clients = await Promise.all(
      Array.from({ length: 5 }, async () => p.deps.db()),
    );
    // Inti pembuktian: 5 koneksi HIDUP bersamaan, bukan satu dipakai bergiliran.
    const ids = new Set((clients as unknown as Array<{ id: number }>).map((c) => c.id));
    expect(ids.size).toBe(5);
    for (const c of clients as unknown as Array<{ id: number; release: () => void }>) c.release();
    await p.end();
  });

  it("menghormati batas `max`: permintaan ke-11 ditolak dengan galat pool penuh", async () => {
    const p = createDbPool({ connectionString: "postgres://x/y", max: 10 });
    const held = await Promise.all(
      Array.from({ length: 10 }, async () => p.deps.db()),
    );
    await expect(p.deps.db()).rejects.toThrow(/timeout exceeded/);
    for (const c of held as unknown as Array<{ release: () => void }>) c.release();
    await p.end();
  });

  it("koneksi yang dilepas dipakai ulang, tidak membuat koneksi baru terus", async () => {
    const p = createDbPool({ connectionString: "postgres://x/y", max: 2 });
    const before = created.length;
    for (let i = 0; i < 6; i++) {
      const c = await p.deps.db() as unknown as { id: number; release: () => void };
      c.release();
    }
    // 6 siklus acquire/release dengan max 2 tidak boleh membuat 6 koneksi.
    expect(created.length - before).toBeLessThanOrEqual(2);
    await p.end();
  });
});

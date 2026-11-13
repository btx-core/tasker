/**
 * T-49: `Deps.db` bisa memakai POOL, dan koneksi SELALU dikembalikan.
 *
 * KENAPA uji ini ada: sebelum ini `Deps.db` mengembalikan `Client`, jadi
 * satu-satunya cara memasangnya adalah SATU koneksi untuk seluruh proses —
 * setiap request mengantre di belakang request lain. Uji ini membuktikan dua
 * hal yang tidak bisa dibuktikan dengan membaca kode:
 *   1. Klien bergaya pool (`release`) diterima tanpa perubahan tipe.
 *   2. `release` dipanggil pada jalur SUKSES **dan** jalur GALAT.
 *
 * Butir 2 yang paling penting. Lupa `release` tidak menghasilkan galat apa pun
 * — hasilnya pool yang habis berjam-jam kemudian, di produksi, tanpa jejak ke
 * baris yang lupa. Karena itu jalur galat diuji sama seriusnya dengan jalur
 * sukses.
 */
import { describe, expect, it } from "vitest";
import { withClient, type Deps } from "./routes.js";

/** Klien tiruan yang mencatat pemanggilan `release`. */
function poolStub() {
  let released = 0;
  let queried = 0;
  const client = {
    async query<R>(_sql: string, _params?: readonly unknown[]) {
      queried++;
      return { rows: [{ ok: 1 }] as unknown as R[], rowCount: 1 };
    },
    release() { released++; },
  };
  return {
    client,
    stats: () => ({ released, queried }),
    deps: { db: async () => client } as unknown as Pick<Deps, "db">,
  };
}

describe("T-49 withClient", () => {
  it("mengembalikan koneksi ke pool setelah pemakaian normal", async () => {
    const p = poolStub();
    const out = await withClient(p.deps, async (c) => {
      const r = await c.query("SELECT 1");
      return r.rows.length;
    });
    expect(out).toBe(1);
    expect(p.stats()).toEqual({ released: 1, queried: 1 });
  });

  it("mengembalikan koneksi JUGA saat handler melempar galat", async () => {
    const p = poolStub();
    // 409 konflik versi adalah jalur galat yang paling sering terjadi di board.
    await expect(
      withClient(p.deps, async () => { throw new Error("conflict.version"); }),
    ).rejects.toThrow("conflict.version");
    // Tanpa `finally`, satu koneksi bocor per konflik — dan konflik itu normal.
    expect(p.stats().released).toBe(1);
  });

  it("hanya memanggil release SEKALI walau fn melempar setelah query", async () => {
    const p = poolStub();
    await expect(withClient(p.deps, async (c) => {
      await c.query("UPDATE tasks SET ...");
      throw new Error("gagal setelah tulis");
    })).rejects.toThrow();
    expect(p.stats()).toEqual({ released: 1, queried: 1 });
  });

  it("tetap bekerja bila klien tidak punya release (Client tunggal/PGlite)", async () => {
    const deps = {
      db: async () => ({
        async query<R>() { return { rows: [] as R[], rowCount: 0 }; },
      }),
    } as unknown as Pick<Deps, "db">;
    await expect(withClient(deps, async (c) => (await c.query("SELECT 1")).rows.length))
      .resolves.toBe(0);
  });

  it("meneruskan galat pool penuh tanpa menelannya", async () => {
    // `toErrorBody` yang menerjemahkannya jadi 503; `withClient` tidak boleh
    // menyamarkan galat, karena hanya lapisan HTTP yang tahu cara membalasnya.
    const deps = {
      db: async () => { throw new Error("timeout exceeded when trying to connect"); },
    } as unknown as Pick<Deps, "db">;
    await expect(withClient(deps, async () => "tidak tercapai"))
      .rejects.toThrow(/timeout exceeded/);
  });
});

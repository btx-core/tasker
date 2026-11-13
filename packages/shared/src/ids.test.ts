import { describe, expect, it } from "vitest";
import { operationId, uuidv7, uuidv7Timestamp } from "./ids.js";

describe("uuidv7 (ADR-018: dibuat di aplikasi)", () => {
  it("berbentuk UUID dan versinya 7", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("varian RFC 4122 (8/9/a/b)", () => {
    for (let i = 0; i < 200; i++) {
      expect("89ab").toContain(uuidv7()[19]);
    }
  });

  it("timestamp bisa diekstrak kembali", () => {
    const now = 1_700_000_123_456;
    expect(uuidv7Timestamp(uuidv7(now))).toBe(now);
  });

  it("monoton dalam milidetik yang sama (insert locality)", () => {
    // Bukan jaminan urutan total: hanya memastikan prefix waktu sama.
    const t = 1_700_000_000_000;
    const ids = Array.from({ length: 100 }, () => uuidv7(t));
    const prefixes = new Set(ids.map((id) => id.slice(0, 13)));
    expect(prefixes.size).toBe(1);
  });

  it("1000 ID tanpa duplikat", () => {
    const set = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(set.size).toBe(1000);
  });

  it("menolak mengekstrak timestamp dari UUIDv4", () => {
    expect(() => uuidv7Timestamp("0190f000-0000-4000-8000-000000000001")).toThrow(/bukan UUIDv7/);
  });

  it("operationId juga v7 (bisa diurutkan untuk debug)", () => {
    expect(operationId()).toMatch(/-7[0-9a-f]{3}-/);
  });
});

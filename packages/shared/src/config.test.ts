import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  SESSION_SECRET: "x".repeat(40),
  APP_URL: "http://localhost:3000",
  NODE_ENV: "test",
};

describe("loadConfig (fail fast, tanpa default untuk rahasia)", () => {
  it("menerima konfigurasi lengkap", () => {
    const c = loadConfig(base);
    expect(c.port).toBe(3001);
    expect(c.emailMode).toBe("none");
    expect(c.storageDriver).toBe("filesystem");
  });

  it("menolak tanpa DATABASE_URL, menyebut nama variabelnya", () => {
    const { DATABASE_URL: _, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL wajib diisi/);
  });

  it("TIDAK punya default untuk SESSION_SECRET", () => {
    const { SESSION_SECRET: _, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/SESSION_SECRET wajib diisi/);
  });

  it("menolak SESSION_SECRET pendek", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "pendek" })).toThrow(/minimal 32 byte/);
  });

  it("menolak SESSION_SECRET yang masih nilai contoh", () => {
    expect(() =>
      loadConfig({ ...base, SESSION_SECRET: "ganti-dengan-32-byte-acak-jangan-pakai-ini" }),
    ).toThrow(/masih nilai contoh/);
  });

  it("melaporkan SEMUA masalah sekaligus, bukan satu per satu", () => {
    try {
      loadConfig({});
      expect.unreachable("harus melempar");
    } catch (e) {
      const err = e as ConfigError;
      expect(err.problems.length).toBeGreaterThanOrEqual(4);
      expect(err.problems.join(" ")).toContain("APP_URL");
      expect(err.problems.join(" ")).toContain("SESSION_SECRET");
    }
  });

  it("menolak PORT di luar rentang", () => {
    expect(() => loadConfig({ ...base, PORT: "99999" })).toThrow(/PORT/);
  });

  it("menolak NODE_ENV tak dikenal", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});

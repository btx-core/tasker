import { describe, expect, it } from "vitest";
import { checksum, loadMigrations, MigrationError, parseHeader } from "./migrator.js";

const HEADER = `-- migration: 0001_demo
-- intent: contoh
-- reversible: yes
-- locks: none
-- transaction: yes
-- est_duration: ms
-- backfill: none
-- docs: data-model.md ENT-01
`;

describe("parseHeader (migrations.md §3: header hilang = migrasi ditolak)", () => {
  it("membaca header lengkap", () => {
    const h = parseHeader(HEADER, "0001_demo.sql");
    expect(h.intent).toBe("contoh");
    expect(h.transaction).toBe("yes");
    expect(h.docs).toBe("data-model.md ENT-01");
  });

  it("menolak header yang kurang, menyebut field yang hilang", () => {
    const partial = HEADER.replace("-- backfill: none\n", "").replace("-- docs: data-model.md ENT-01\n", "");
    expect(() => parseHeader(partial, "0001_demo.sql")).toThrow(/backfill, docs/);
  });

  it("menolak reversible yang bukan yes|no", () => {
    expect(() => parseHeader(HEADER.replace("reversible: yes", "reversible: mungkin"), "x.sql")).toThrow(
      /reversible harus yes\|no/,
    );
  });

  it("menolak transaction: no bersama locks: long", () => {
    const bad = HEADER.replace("transaction: yes", "transaction: no").replace("locks: none", "locks: long");
    expect(() => parseHeader(bad, "x.sql")).toThrow(/tidak boleh dengan locks: long/);
  });
});

describe("checksum (M5: migrasi terpasang tidak boleh berubah)", () => {
  it("stabil terhadap CRLF", () => {
    expect(checksum("SELECT 1;\n")).toBe(checksum("SELECT 1;\r\n"));
  });

  it("berubah bila isi berubah", () => {
    expect(checksum("SELECT 1;")).not.toBe(checksum("SELECT 2;"));
  });

  it("berbentuk sha256 hex (constraint schema_migrations)", () => {
    expect(checksum("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("loadMigrations pada migrasi repo yang sebenarnya", () => {
  it("20 berkas, semuanya punya header sah, berurutan tanpa celah", async () => {
    const dir = new URL("../migrations/", import.meta.url).pathname;
    const files = await loadMigrations(dir);
    expect(files.length).toBe(20);
    expect(files[0]!.version).toBe(1);
    expect(files.at(-1)!.version).toBe(20);
    for (const f of files) {
      expect(f.header.intent.length).toBeGreaterThan(10);
      expect(f.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("menolak nama berkas yang tidak sesuai konvensi", async () => {
    const dir = new URL("../migrations/", import.meta.url).pathname;
    // Berkas sah yang diberi nama salah harus ditolak oleh aturan nama.
    const bad = "/tmp/kelindan-bad-migrations";
    const { mkdir, writeFile, rm } = await import("node:fs/promises");
    await rm(bad, { recursive: true, force: true });
    await mkdir(bad, { recursive: true });
    await writeFile(`${bad}/1-init.sql`, "SELECT 1;");
    await expect(loadMigrations(bad)).rejects.toThrow(MigrationError);
    await expect(loadMigrations(bad)).rejects.toThrow(/NNNN_kata_kerja_objek/);
    await rm(bad, { recursive: true, force: true });
    expect(dir).toBeTruthy();
  });
});

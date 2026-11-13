import { describe, expect, it } from "vitest";
import { burnPasswordTime, hashPassword, verifyPassword } from "./password.js";

describe("hashPassword", () => {
  it("menghasilkan hash bersalt: password sama -> hash berbeda", async () => {
    const a = await hashPassword("kata-sandi-rahasia");
    const b = await hashPassword("kata-sandi-rahasia");
    expect(a).not.toBe(b);
    // Salt acak ada di dalam string, bukan konstanta.
    const [, , , , saltA] = a.split("$");
    const [, , , , saltB] = b.split("$");
    expect(saltA).not.toBe(saltB);
  });

  it("menyimpan parameter biaya di dalam hash (bisa dimigrasi nanti)", async () => {
    const h = await hashPassword("apa-saja");
    const [prefix, n, r, p] = h.split("$");
    expect(prefix).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(r).toBe("8");
    expect(p).toBe("1");
  });

  it("password asli TIDAK muncul di string hash", async () => {
    const h = await hashPassword("jangan-sampai-bocor-123");
    expect(h).not.toContain("jangan-sampai-bocor");
  });
});

describe("verifyPassword", () => {
  it("menerima password yang benar", async () => {
    const h = await hashPassword("benar-sekali");
    await expect(verifyPassword("benar-sekali", h)).resolves.toBe(true);
  });

  it("menolak password yang salah", async () => {
    const h = await hashPassword("benar-sekali");
    await expect(verifyPassword("benar-sekali!", h)).resolves.toBe(false);
    await expect(verifyPassword("", h)).resolves.toBe(false);
  });

  it("menolak hash rusak tanpa melempar (hash rusak != error)", async () => {
    for (const bad of ["", "bukan-hash", "scrypt$32768$8$1$zz", "$".repeat(5)]) {
      await expect(verifyPassword("apa-saja", bad)).resolves.toBe(false);
    }
  });

  it("menolak hash dengan algoritma tak dikenal", async () => {
    const h = await hashPassword("apa-saja");
    const swapped = h.replace(/^scrypt/, "bcrypt");
    await expect(verifyPassword("apa-saja", swapped)).resolves.toBe(false);
  });

  it("menolak parameter biaya yang dilemahkan di dalam hash", async () => {
    // Penyerang yang bisa menulis DB bisa menurunkan N. Batas bawah mencegah
    // hash "murah" diterima sebagai sah.
    const h = await hashPassword("apa-saja");
    const parts = h.split("$");
    parts[1] = "8";
    await expect(verifyPassword("apa-saja", parts.join("$"))).resolves.toBe(false);
  });
});

describe("burnPasswordTime", () => {
  it("membuang waktu sebanyak verifikasi sungguhan (anti-enumerasi)", async () => {
    const h = await hashPassword("apa-saja");

    const t1 = performance.now();
    await verifyPassword("salah", h);
    const verifyMs = performance.now() - t1;

    const t2 = performance.now();
    await burnPasswordTime("salah");
    const burnMs = performance.now() - t2;

    // Keduanya harus dalam orde besaran yang sama. Ambang lebar (2.5x) supaya
    // tidak flaky di mesin yang sedang sibuk; yang dicegah adalah selisih
    // "0 ms vs 100 ms" yang bisa diukur penyerang.
    const ratio = Math.max(verifyMs, burnMs) / Math.max(1, Math.min(verifyMs, burnMs));
    expect(ratio).toBeLessThan(2.5);
  });
});

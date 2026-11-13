/**
 * T-I18N3: format tanggal/angka lewat satu modul, dan hasilnya benar untuk
 * beberapa zona waktu & lokal. Format manual akan gagal di sini.
 */
import { describe, expect, it } from "vitest";
import { formatDate, formatNumber, formatRelative, setFormatContext } from "./format.js";

const ISO = "2026-11-12T23:30:00Z";

describe("formatDate", () => {
  it("tanggal yang sama bisa jatuh di hari berbeda per zona waktu", () => {
    setFormatContext("id-ID", "Asia/Jakarta");
    const jakarta = formatDate(ISO); // 13 Nov 06:30 WIB
    setFormatContext("id-ID", "UTC");
    const utc = formatDate(ISO); // 12 Nov 23:30 UTC
    expect(jakarta).not.toBe(utc);
    expect(jakarta).toContain("13");
    expect(utc).toContain("12");
  });

  it("lokal berbeda menghasilkan teks berbeda", () => {
    setFormatContext("en-US", "UTC");
    const en = formatDate(ISO);
    setFormatContext("id-ID", "UTC");
    const id = formatDate(ISO);
    expect(en).not.toBe(id);
  });

  it("null -> tanda pisah, bukan 'Invalid Date'", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("bukan tanggal")).toBe("—");
  });

  it("tidak ada format manual: tidak ada '/' di keluaran", () => {
    setFormatContext("id-ID", "Asia/Jakarta");
    const out = formatDate("2026-01-02T00:00:00Z");
    expect(out).not.toContain("/");
  });
});

describe("formatNumber & formatRelative", () => {
  it("pemisah ribuan mengikuti lokal", () => {
    setFormatContext("id-ID", "Asia/Jakarta");
    const id = formatNumber(12345);
    setFormatContext("en-US", "UTC");
    const en = formatNumber(12345);
    expect(id).not.toBe(en);
    expect(id.replace(/\D/g, "")).toBe("12345");
  });

  it("relatif memakai Intl, bukan aritmetika string", () => {
    setFormatContext("id-ID", "Asia/Jakarta");
    const now = new Date("2026-11-12T00:00:00Z");
    expect(formatRelative("2026-11-15T00:00:00Z", now)).toContain("3");
    expect(formatRelative("2026-11-12T02:00:00Z", now)).toContain("2");
  });
});

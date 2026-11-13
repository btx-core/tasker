import { describe, expect, it } from "vitest";
import { isSessionValid, type SessionContext } from "./session.js";
import { traceIdFrom } from "./trace.js";

const base: SessionContext = {
  sessionId: "s1", userId: "u1", workspaceId: "w1", epoch: 3,
  expiresAt: new Date("2026-12-01T00:00:00Z"), revokedAt: null,
};
const now = new Date("2026-11-12T00:00:00Z");

describe("isSessionValid (FR-112: pencabutan < 60 detik)", () => {
  it("sesi normal sah", () => {
    expect(isSessionValid(base, 3, now)).toBe(true);
  });

  it("dicabut -> tidak sah", () => {
    expect(isSessionValid({ ...base, revokedAt: now }, 3, now)).toBe(false);
  });

  it("kedaluwarsa -> tidak sah", () => {
    expect(isSessionValid({ ...base, expiresAt: new Date("2026-11-11T00:00:00Z") }, 3, now)).toBe(false);
  });

  it("epoch berbeda -> tidak sah (cabut semua sesi)", () => {
    expect(isSessionValid(base, 4, now)).toBe(false);
  });

  it("kedaluwarsa TEPAT pada waktu sekarang -> tidak sah", () => {
    expect(isSessionValid({ ...base, expiresAt: now }, 3, now)).toBe(false);
  });
});

describe("traceIdFrom", () => {
  it("memakai trace_id klien bila bentuknya sah", () => {
    const id = "0190f000-0000-7000-8000-000000000001";
    expect(traceIdFrom(id)).toBe(id);
  });

  it("mengabaikan header sembarang (jangan percaya input untuk korelasi log)", () => {
    const t = traceIdFrom("bukan-uuid");
    expect(t).toMatch(/-7[0-9a-f]{3}-/);
    expect(t).not.toBe("bukan-uuid");
  });
});

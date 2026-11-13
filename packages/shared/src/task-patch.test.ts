import { describe, expect, it } from "vitest";
import { parseTaskPatch } from "./task-patch.js";

const UUID = "0190f000-0000-7000-8000-0000000000d1";

describe("parseTaskPatch", () => {
  it("menerima patch sah dan expected_version", () => {
    const r = parseTaskPatch({ title: "Judul baru", priority: 2, expected_version: 7 });
    expect(r.ok).toBe(true);
    expect(r.patch).toEqual({ title: "Judul baru", priority: 2 });
    expect(r.expectedVersion).toBe(7);
  });

  it("MENOLAK field yang tidak dikenal, bukan mengabaikannya", () => {
    const r = parseTaskPatch({ titel: "salah ketik" });
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.field).toBe("titel");
    expect(r.issues[0]!.message).toContain("tidak dapat diubah");
  });

  it("menolak body kosong (tidak ada perubahan)", () => {
    const r = parseTaskPatch({});
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.field).toBe("body");
  });

  it("menolak title di luar 1-300", () => {
    expect(parseTaskPatch({ title: "" }).ok).toBe(false);
    expect(parseTaskPatch({ title: "x".repeat(301) }).ok).toBe(false);
  });

  it("menolak description > 100 KB (batas prd §7.4)", () => {
    const r = parseTaskPatch({ description: "x".repeat(102_401) });
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.field).toBe("description");
  });

  it("menerima description tepat 100 KB", () => {
    expect(parseTaskPatch({ description: "x".repeat(102_400) }).ok).toBe(true);
  });

  it("priority hanya 0..4", () => {
    expect(parseTaskPatch({ priority: 5 }).ok).toBe(false);
    expect(parseTaskPatch({ priority: -1 }).ok).toBe(false);
    expect(parseTaskPatch({ priority: 1.5 }).ok).toBe(false);
    expect(parseTaskPatch({ priority: 4 }).ok).toBe(true);
  });

  it("menerima null untuk field yang boleh dikosongkan", () => {
    const r = parseTaskPatch({ assignee_id: null, due_date: null, effort: null, description: null });
    expect(r.ok).toBe(true);
    expect(r.patch).toEqual({ assignee_id: null, due_date: null, effort: null, description: null });
  });

  it("due_date harus YYYY-MM-DD", () => {
    expect(parseTaskPatch({ due_date: "20-11-2026" }).ok).toBe(false);
    expect(parseTaskPatch({ due_date: "2026-11-20" }).ok).toBe(true);
  });

  it("effort harus > 0", () => {
    expect(parseTaskPatch({ effort: 0 }).ok).toBe(false);
    expect(parseTaskPatch({ effort: 3 }).ok).toBe(true);
  });

  it("expected_version harus >= 1", () => {
    expect(parseTaskPatch({ title: "a", expected_version: 0 }).ok).toBe(false);
  });

  it("melaporkan SEMUA field yang salah sekaligus", () => {
    const r = parseTaskPatch({ title: "", priority: 9, due_date: "x" });
    expect(r.issues.length).toBe(3);
    expect(r.issues.map((i) => i.field).sort()).toEqual(["due_date", "priority", "title"]);
  });

  it("status_id harus UUID", () => {
    expect(parseTaskPatch({ status_id: "abc" }).ok).toBe(false);
    expect(parseTaskPatch({ status_id: UUID }).ok).toBe(true);
  });
});

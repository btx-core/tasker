/**
 * Uji aturan komentar (rbac.md AC-36/37/38). Berkas ini sengaja memuat kasus
 * BATAS, karena aturan izin gagal di tepi, bukan di tengah.
 */
import { describe, expect, it } from "vitest";
import { ACTIONS, TEAM_ROLE, can } from "./actions.js";
import { COMMENT_EDIT_WINDOW_MS, canDeleteComment, canEditComment } from "./comment-authz.js";

const WS = "0190f000-0000-7000-8000-000000000001";
const T0 = new Date("2026-03-01T10:00:00.000Z");

const actor = (userId: string, teamRole: number) =>
  ({ userId, workspaceId: WS, teamRole: teamRole as never });

const AUTHOR = "0190f000-0000-7000-8000-0000000000a1";
const OTHER = "0190f000-0000-7000-8000-0000000000a2";

const at = (msAfterT0: number) => new Date(T0.getTime() + msAfterT0);

const target = (over: Partial<{ authorId: string; createdAt: Date; deletedAt: Date | null }> = {}) => ({
  authorId: AUTHOR, createdAt: T0, deletedAt: null, ...over,
});

describe("matriks peran untuk komentar (rbac.md)", () => {
  it("commenter BOLEH berkomentar — itulah seluruh alasan perannya ada", () => {
    const a = actor(OTHER, TEAM_ROLE.COMMENTER);
    expect(can(a, ACTIONS.COMMENT_CREATE)).toBe(true);
    expect(can(a, ACTIONS.COMMENT_UPDATE_OWN)).toBe(true);
    expect(can(a, ACTIONS.COMMENT_DELETE)).toBe(true);
  });

  it("commenter TIDAK boleh mengubah task apa pun (rbac.md baris 188)", () => {
    const a = actor(OTHER, TEAM_ROLE.COMMENTER);
    for (const act of [
      ACTIONS.TASK_UPDATE, ACTIONS.TASK_UPDATE_STATUS, ACTIONS.TASK_UPDATE_TITLE,
      ACTIONS.TASK_CREATE, ACTIONS.CHECKLIST_MANAGE,
    ]) {
      expect(can(a, act)).toBe(false);
    }
  });

  it("viewer TIDAK boleh berkomentar (rbac.md: viewer tidak bisa berkomentar)", () => {
    const a = actor(OTHER, TEAM_ROLE.VIEWER);
    expect(can(a, ACTIONS.COMMENT_CREATE)).toBe(false);
    expect(can(a, ACTIONS.CHECKLIST_MANAGE)).toBe(false);
  });

  it("hanya admin tim yang boleh moderasi komentar orang lain", () => {
    expect(can(actor(OTHER, TEAM_ROLE.ADMIN), ACTIONS.COMMENT_UPDATE_ANY)).toBe(true);
    expect(can(actor(OTHER, TEAM_ROLE.MEMBER), ACTIONS.COMMENT_UPDATE_ANY)).toBe(false);
    expect(can(actor(OTHER, TEAM_ROLE.COMMENTER), ACTIONS.COMMENT_UPDATE_ANY)).toBe(false);
    expect(can(actor(OTHER, TEAM_ROLE.VIEWER), ACTIONS.COMMENT_UPDATE_ANY)).toBe(false);
  });

  it("member & admin boleh mengelola checklist; commenter & viewer tidak", () => {
    expect(can(actor(OTHER, TEAM_ROLE.ADMIN), ACTIONS.CHECKLIST_MANAGE)).toBe(true);
    expect(can(actor(OTHER, TEAM_ROLE.MEMBER), ACTIONS.CHECKLIST_MANAGE)).toBe(true);
    expect(can(actor(OTHER, TEAM_ROLE.COMMENTER), ACTIONS.CHECKLIST_MANAGE)).toBe(false);
    expect(can(actor(OTHER, TEAM_ROLE.VIEWER), ACTIONS.CHECKLIST_MANAGE)).toBe(false);
  });
});

describe("canEditComment", () => {
  const author = actor(AUTHOR, TEAM_ROLE.MEMBER);

  it("penulis boleh mengedit dalam 15 menit", () => {
    const v = canEditComment({ ...author, canModerate: false }, target(), at(60_000));
    expect(v).toEqual({ allowed: true, viaOwn: true });
  });

  it("penulis DITOLAK setelah 15 menit (komentar bukan sejarah yang bisa ditulis ulang)", () => {
    const v = canEditComment(
      { ...author, canModerate: false }, target(), at(COMMENT_EDIT_WINDOW_MS + 1),
    );
    expect(v).toEqual({ allowed: false, reason: "window_closed" });
  });

  it("batas waktunya TEPAT: 15 menit masih boleh, 15 menit + 1 ms tidak", () => {
    expect(canEditComment({ ...author, canModerate: false }, target(), at(COMMENT_EDIT_WINDOW_MS)))
      .toEqual({ allowed: true, viaOwn: true });
    expect(canEditComment({ ...author, canModerate: false }, target(), at(COMMENT_EDIT_WINDOW_MS + 1)))
      .toEqual({ allowed: false, reason: "window_closed" });
  });

  it("orang lain ditolak, meski masih dalam jendela waktu", () => {
    const v = canEditComment(
      { ...actor(OTHER, TEAM_ROLE.MEMBER), canModerate: false }, target(), at(60_000),
    );
    expect(v).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("admin boleh memoderasi komentar LAMA (batas waktu tidak berlaku untuk moderasi)", () => {
    const v = canEditComment(
      { ...actor(OTHER, TEAM_ROLE.ADMIN), canModerate: true },
      target(), at(COMMENT_EDIT_WINDOW_MS * 100),
    );
    expect(v).toEqual({ allowed: true, viaOwn: false });
  });

  it("komentar yang sudah dihapus tidak bisa diedit SIAPA PUN, termasuk admin", () => {
    const deleted = target({ deletedAt: at(1000) });
    for (const a of [
      { ...actor(AUTHOR, TEAM_ROLE.MEMBER), canModerate: false },
      { ...actor(OTHER, TEAM_ROLE.ADMIN), canModerate: true },
    ]) {
      expect(canEditComment(a, deleted, at(2000))).toEqual({ allowed: false, reason: "deleted" });
    }
  });
});

describe("canDeleteComment", () => {
  it("penulis boleh menghapus KAPAN SAJA — berbeda dari mengedit", () => {
    const v = canDeleteComment(
      { ...actor(AUTHOR, TEAM_ROLE.COMMENTER), canModerate: false },
      target(), at(COMMENT_EDIT_WINDOW_MS * 1000),
    );
    expect(v).toEqual({ allowed: true, viaOwn: true });
  });

  it("orang lain tanpa moderasi ditolak", () => {
    expect(canDeleteComment({ ...actor(OTHER, TEAM_ROLE.MEMBER), canModerate: false }, target()))
      .toEqual({ allowed: false, reason: "forbidden" });
  });

  it("admin boleh menghapus komentar siapa pun", () => {
    expect(canDeleteComment({ ...actor(OTHER, TEAM_ROLE.ADMIN), canModerate: true }, target()))
      .toEqual({ allowed: true, viaOwn: false });
  });

  it("menghapus dua kali: yang kedua ditolak 'deleted', bukan dianggap sukses", () => {
    expect(canDeleteComment(
      { ...actor(AUTHOR, TEAM_ROLE.MEMBER), canModerate: false },
      target({ deletedAt: at(1000) }),
    )).toEqual({ allowed: false, reason: "deleted" });
  });
});

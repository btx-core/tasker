import { describe, expect, it } from "vitest";
import { ACTIONS, can, FIELD_ACTION, TEAM_ROLE, type Actor } from "./actions.js";

const actor = (role: number): Actor => ({
  userId: "u1", workspaceId: "w1", teamRole: role as Actor["teamRole"],
});

describe("can() — deny by default", () => {
  it("admin tim bisa mengubah task", () => {
    expect(can(actor(TEAM_ROLE.ADMIN), ACTIONS.TASK_UPDATE)).toBe(true);
  });

  it("member bisa mengubah task tapi TIDAK bisa menghapus", () => {
    expect(can(actor(TEAM_ROLE.MEMBER), ACTIONS.TASK_UPDATE)).toBe(true);
    expect(can(actor(TEAM_ROLE.MEMBER), ACTIONS.TASK_DELETE)).toBe(false);
  });

  it("commenter & viewer hanya boleh membaca", () => {
    for (const role of [TEAM_ROLE.COMMENTER, TEAM_ROLE.VIEWER]) {
      expect(can(actor(role), ACTIONS.BOARD_READ)).toBe(true);
      expect(can(actor(role), ACTIONS.TASK_UPDATE)).toBe(false);
      expect(can(actor(role), ACTIONS.TASK_CREATE)).toBe(false);
    }
  });

  it("peran tak dikenal -> DITOLAK, tidak melempar", () => {
    expect(can(actor(99), ACTIONS.BOARD_READ)).toBe(false);
  });

  it("setiap action yang dapat menulis punya padanan di FIELD_ACTION", () => {
    for (const [field, action] of Object.entries(FIELD_ACTION)) {
      expect(action, field).toMatch(/^task\.update\./);
    }
  });

  it("tabel izin: setiap peran punya minimal BOARD_READ", () => {
    for (const role of Object.values(TEAM_ROLE)) {
      expect(can(actor(role), ACTIONS.BOARD_READ), `role ${role}`).toBe(true);
    }
  });
});

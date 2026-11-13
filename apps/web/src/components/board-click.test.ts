/**
 * Regresi T-39: klik kartu MEMBUKA PANEL, bukan memfokuskan dropdown status.
 *
 * KENAPA INI PENTING: perilaku lama ("klik kartu -> fokus ke <select>") adalah
 * jebakan. Klik untuk melihat detail langsung menaruh fokus pada kontrol yang
 * MENGUBAH data, dan satu tekan panah + Enter memindahkan task tanpa niat.
 *
 * Uji ini memakai DOM tiruan minimal: `renderBoard` hanya membutuhkan
 * addEventListener + closest, jadi memasang jsdom untuk tiga uji tidak
 * sebanding dengan nilai yang didapat.
 */
import { describe, expect, it, vi } from "vitest";
import { renderBoard } from "./board.js";
import type { BoardStore } from "../lib/store.js";

interface Handler { (ev: unknown): void }

function fakeRoot() {
  const handlers = new Map<string, Handler[]>();
  return {
    addEventListener(type: string, fn: Handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
    fire(type: string, ev: unknown) {
      for (const fn of handlers.get(type) ?? []) fn(ev);
    },
    handlers,
  };
}

/** Elemen tiruan: `closest` cukup mengembalikan kartu bila selector cocok. */
function fakeTarget(opts: { card?: boolean; control?: boolean; taskId?: string }) {
  const card = {
    dataset: { taskId: opts.taskId ?? "t1" } as Record<string, string>,
    focus: vi.fn(),
    querySelector: () => null,
  };
  return {
    closest(sel: string) {
      if (sel === "select, button, a, input") return opts.control ? {} : null;
      if (sel === "[data-task-id]") return opts.card ? card : null;
      return null;
    },
    card,
  } as unknown as HTMLElement & { card: typeof card };
}

/**
 * Store tiruan lengkap: `renderBoard` memasang handler untuk konflik juga, dan
 * store yang kekurangan method membuat uji gagal karena ALASAN YANG SALAH
 * (handler konflik melempar), bukan karena perilaku yang diuji.
 */
const store = { moveTask: vi.fn(), dismissConflict: vi.fn() } as unknown as BoardStore;

describe("renderBoard — klik & keyboard", () => {
  it("klik kartu memanggil onOpenTask dengan id task", () => {
    const root = fakeRoot();
    const onOpenTask = vi.fn();
    renderBoard({ store, root: root as unknown as HTMLElement, onOpenTask });

    const target = fakeTarget({ card: true, taskId: "t9" });
    root.fire("click", { target });

    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(onOpenTask.mock.calls[0]![0]).toBe("t9");
    // Elemen pembuka diteruskan agar fokus bisa dikembalikan saat panel ditutup.
    expect(onOpenTask.mock.calls[0]![1]).toBe(target.card);
  });

  it("klik pada kontrol DI DALAM kartu TIDAK membuka panel", () => {
    const root = fakeRoot();
    const onOpenTask = vi.fn();
    renderBoard({ store, root: root as unknown as HTMLElement, onOpenTask });

    // Pengguna sedang berinteraksi dengan <select>: panel tidak boleh muncul.
    root.fire("click", { target: fakeTarget({ card: true, control: true }) });
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("klik di luar kartu tidak melakukan apa pun", () => {
    const root = fakeRoot();
    const onOpenTask = vi.fn();
    renderBoard({ store, root: root as unknown as HTMLElement, onOpenTask });
    root.fire("click", { target: fakeTarget({}) });
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("Enter pada kartu membuka panel (bisa dipakai tanpa mouse)", () => {
    const root = fakeRoot();
    const onOpenTask = vi.fn();
    renderBoard({ store, root: root as unknown as HTMLElement, onOpenTask });

    let prevented = false;
    root.fire("keydown", {
      key: "Enter",
      target: fakeTarget({ card: true, taskId: "t5" }),
      preventDefault: () => { prevented = true; },
    });

    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(onOpenTask.mock.calls[0]![0]).toBe("t5");
    // Default Enter di dalam kartu bisa mengirim formulir induk.
    expect(prevented).toBe(true);
  });

  it("Enter pada kontrol di dalam kartu TIDAK membuka panel", () => {
    const root = fakeRoot();
    const onOpenTask = vi.fn();
    renderBoard({ store, root: root as unknown as HTMLElement, onOpenTask });
    root.fire("keydown", {
      key: "Enter",
      target: fakeTarget({ card: true, control: true }),
      preventDefault: () => undefined,
    });
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("tanpa onOpenTask (dipakai uji lama) renderBoard tidak melempar", () => {
    const root = fakeRoot();
    renderBoard({ store, root: root as unknown as HTMLElement });
    expect(() => root.fire("click", { target: fakeTarget({ card: true }) })).not.toThrow();
  });
});

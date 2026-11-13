/**
 * Render board 7 kolom (P4-02). Tanpa framework: fase ini membuktikan
 * kontrak & perilaku, bukan memilih pustaka UI (sama seperti T-11 di server).
 *
 * Aturan yang ditegakkan berkas ini:
 *  - TIDAK ADA string UI di sini (P4-07). Semua lewat `S`.
 *  - TIDAK ADA format tanggal manual (P4-06). Semua lewat `formatDate`.
 *  - Konflik 409 TIDAK menimpa apa pun; ia menampilkan dua nilai (P4-05).
 */
import { S } from "../i18n/strings.js";
import { formatDate, formatNumber } from "../i18n/format.js";
import type { BoardStore, BoardState } from "../lib/store.js";
import type { BoardTask } from "../lib/api.js";

export interface RenderDeps {
  store: BoardStore;
  root: HTMLElement;
}

const PRIORITY_LABEL: Record<number, string> = {
  0: "", 1: "!", 2: "!!", 3: "!!!", 4: "!!!!",
};

export function renderBoard({ store, root }: RenderDeps): void {
  root.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const card = target.closest<HTMLElement>("[data-task-id]");
    if (!card) return;
    // Pemilih kolom tujuan: satu kontrol, bukan drag-and-drop di fase ini.
    const select = card.querySelector<HTMLSelectElement>("select");
    select?.focus();
  });

  root.addEventListener("change", (ev) => {
    const el = ev.target as HTMLElement;
    if (!(el instanceof HTMLSelectElement)) return;
    const taskId = el.dataset["taskId"];
    if (!taskId) return;
    void store.moveTask(taskId, el.value);
  });

  root.addEventListener("click", (ev) => {
    const el = ev.target as HTMLElement;
    if (el.dataset["dismissConflict"] !== undefined) store.dismissConflict();
  });
}

export function boardHtml(state: BoardState): string {
  if (state.loading) {
    return `<p class="muted" role="status">${esc(S.loading)}</p>`;
  }
  if (state.error) {
    return `
      <div class="error" role="alert">
        <strong>${esc(S.errorGeneric)}</strong>
        <p>${esc(state.error.message)}</p>
        <p class="trace">${esc(S.traceLabel)}: <code>${esc(state.error.traceId)}</code></p>
      </div>`;
  }
  const payload = state.payload;
  if (!payload) return "";

  const notice = state.notice ? noticeHtml(state) : "";
  const cols = payload.columns.map((c) => columnHtml(c, state)).join("");
  return `${notice}<div class="board">${cols}</div>`;
}

function noticeHtml(state: BoardState): string {
  if (state.notice === "conflict" && state.conflict) {
    const c = state.conflict;
    // P4-05: tampilkan DUA nilai, jangan menimpa.
    return `
      <div class="conflict" role="alertdialog">
        <strong>${esc(S.errorConflict)}</strong>
        <p>${esc(S.errorConflictHint)}</p>
        <dl>
          <dt>${esc(S.conflictKeepMine)}</dt><dd>${formatNumber(c.mine)}</dd>
          <dt>${esc(S.conflictKeepTheirs)}</dt><dd>${formatNumber(c.theirs)}</dd>
        </dl>
        <button type="button" data-dismiss-conflict>${esc(S.retry)}</button>
      </div>`;
  }
  return `<div class="notice" role="status">${esc(S.movedBack)}</div>`;
}

function columnHtml(
  col: { status_id: string; name: string; tasks: BoardTask[]; truncated: boolean },
  state: BoardState,
): string {
  const cards = col.tasks.map((t) => cardHtml(t, col, state)).join("");
  const truncated = col.truncated ? `<button class="more">${esc(S.truncated)}</button>` : "";
  return `
    <section class="column" data-status-id="${esc(col.status_id)}">
      <h2>${esc(col.name)} <span class="count">${formatNumber(col.tasks.length)}</span></h2>
      <ol class="cards">${cards}</ol>
      ${truncated}
    </section>`;
}

function cardHtml(t: BoardTask, col: { status_id: string }, state: BoardState): string {
  const saving = state.saving.has(t.id) ? ` data-saving="true"` : "";
  const priority = PRIORITY_LABEL[t.priority] ?? "";
  const due = t.due_date ? `<time>${esc(formatDate(t.due_date))}</time>` : "";
  const checklist =
    t.checklist_progress.total > 0
      ? `<span class="check">${formatNumber(t.checklist_progress.done)}/${formatNumber(t.checklist_progress.total)}</span>`
      : "";
  return `
    <li class="card" draggable="true" data-task-id="${esc(t.id)}"${saving}>
      <span class="number">#${formatNumber(t.number)}</span>
      <span class="title">${esc(t.title)}</span>
      ${priority ? `<span class="flag" aria-label="prioritas">${priority}</span>` : ""}
      ${due}${checklist}
      <select data-task-id="${esc(t.id)}" aria-label="${esc(t.title)}">
        ${"" /* opsi diisi oleh hydrateSelects agar tidak menduplikasi data status */}
      </select>
    </li>`;
}

/** Isi `<select>` dengan daftar status yang diberikan server (bukan hardcode). */
export function hydrateSelects(root: HTMLElement, state: BoardState): void {
  const cols = state.payload?.columns ?? [];
  for (const sel of root.querySelectorAll<HTMLSelectElement>("select[data-task-id]")) {
    const taskId = sel.dataset["taskId"]!;
    const current = findStatusOf(state, taskId) ?? "";
    sel.innerHTML = cols
      .map((c) =>
        `<option value="${esc(c.status_id)}"${c.status_id === current ? " selected" : ""}>${esc(c.name)}</option>`)
      .join("");
  }
}

function findStatusOf(state: BoardState, taskId: string): string | null {
  for (const c of state.payload?.columns ?? []) {
    if (c.tasks.some((t) => t.id === taskId)) return c.status_id;
  }
  return null;
}

/** Escaping wajib: judul task adalah input pengguna. */
export function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Panel detail task: deskripsi, komentar, checklist, riwayat (T-39).
 *
 * KENAPA `<dialog>` DAN BUKAN `<div>`: elemen dialog memberi tiga hal yang
 * kalau dibuat sendiri selalu ada yang lupa — jebakan fokus (Tab tidak keluar
 * dari panel), Escape menutup, dan `aria-modal` yang benar. WCAG 2.2 AA
 * menuntut ketiganya untuk alur inti (`NFR-015`).
 *
 * Aturan yang sama seperti board:
 *  - TIDAK ADA string UI di sini (P4-07). Semua lewat `S`.
 *  - TIDAK ADA format tanggal manual (P4-06). Semua lewat `formatDate`.
 */
import { S } from "../i18n/strings.js";
import { formatDate } from "../i18n/format.js";
import type {
  ChecklistItemPayload, CommentPayload, HttpClient, TaskDetail,
} from "../lib/api.js";

/** Karakter yang harus di-escape saat masuk HTML. Sama seperti di board. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PanelData {
  task: TaskDetail;
  comments: CommentPayload[];
  checklist: { items: ChecklistItemPayload[]; progress: { done: number; total: number } };
}

/**
 * Apakah pengguna boleh mengedit komentar ini?
 *
 * Server tetap memutuskan (403/404); ini hanya untuk MENYEMBUNYIKAN tombol yang
 * pasti gagal. Tanpa ini, pengguna menekan "Ubah" lalu melihat galat — dan
 * menyangka aplikasinya rusak, bukan aturannya yang menolak.
 *
 * Jendela 15 menit dihitung dengan jam KLIEN. Jam klien bisa berbeda dari
 * server, jadi keputusan akhir tetap di server; fungsi ini sengaja longgar satu
 * menit agar tombol tidak berkedip hilang tepat di batas.
 */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function canEditLocally(
  comment: CommentPayload,
  userId: string,
  nowMs: number = Date.now(),
): boolean {
  if (comment.deleted_at !== null) return false;
  if (comment.author_id !== userId) return false;
  const age = nowMs - new Date(comment.created_at).getTime();
  return age <= EDIT_WINDOW_MS + 60_000;
}

function commentHtml(c: CommentPayload, userId: string, nowMs: number): string {
  if (c.deleted_at !== null) {
    return `
      <li class="comment comment--deleted" data-comment-id="${esc(c.id)}">
        <p class="comment-deleted">${esc(S.commentDeleted)}</p>
        <p class="meta">${esc(c.author_name)} · ${esc(formatDate(c.created_at))}</p>
      </li>`;
  }
  const editable = canEditLocally(c, userId, nowMs);
  return `
    <li class="comment" data-comment-id="${esc(c.id)}">
      <p class="comment-body">${esc(c.body ?? "")}</p>
      <p class="meta">
        ${esc(c.author_name)} · ${esc(formatDate(c.created_at))}
        ${c.edited_at !== null ? `<span class="edited">${esc(S.commentEdited)}</span>` : ""}
      </p>
      ${editable ? `
        <button type="button" data-comment-edit="${esc(c.id)}">${esc(S.commentEdit)}</button>` : ""}
      <button type="button" data-comment-delete="${esc(c.id)}">${esc(S.commentDelete)}</button>
    </li>`;
}

function checklistHtml(data: PanelData): string {
  const { items, progress } = data.checklist;
  if (items.length === 0) {
    /**
     * Progres TETAP ditampilkan bila ada, meski daftar itemnya kosong. Itu
     * terjadi ketika permintaan daftar gagal sementara ringkasan task berhasil:
     * menyembunyikan "3/7" akan membuat pengguna mengira checklist-nya hilang.
     */
    const hint = progress.total > 0
      ? `<p class="meta">${esc(S.checklistProgress)}: ${progress.done}/${progress.total}</p>`
      : "";
    return `${hint}<p class="muted">${esc(S.checklistEmpty)}</p>`;
  }
  return `
    <p class="meta">${esc(S.checklistProgress)}: ${progress.done}/${progress.total}</p>
    <ul class="checklist">
      ${items.map((i) => `
        <li data-item-id="${esc(i.id)}">
          <label>
            <input type="checkbox" data-item-toggle="${esc(i.id)}"${i.is_done ? " checked" : ""} />
            <span${i.is_done ? ' class="done"' : ""}>${esc(i.content)}</span>
          </label>
          <button type="button" data-item-delete="${esc(i.id)}">${esc(S.checklistDelete)}</button>
        </li>`).join("")}
    </ul>`;
}

export function panelHtml(data: PanelData, userId: string, nowMs: number = Date.now()): string {
  const t = data.task;
  return `
    <div class="panel-head">
      <h2 id="panel-title">${esc(S.panelTitle)}</h2>
      <button type="button" data-panel-close aria-label="${esc(S.panelClose)}">×</button>
    </div>
    <h3 class="panel-task-title">#${t.number} ${esc(t.title)}</h3>

    <section aria-labelledby="panel-desc">
      <h3 id="panel-desc">${esc(S.panelDescription)}</h3>
      <p class="description">${t.description ? esc(t.description) : `<span class="muted">${esc(S.panelDescriptionEmpty)}</span>`}</p>
    </section>

    <section aria-labelledby="panel-comments">
      <h3 id="panel-comments">${esc(S.commentsTitle)}</h3>
      ${data.comments.length === 0
        ? `<p class="muted">${esc(S.commentsEmpty)}</p>`
        : `<ul class="comments">${data.comments.map((c) => commentHtml(c, userId, nowMs)).join("")}</ul>`}
      <form data-comment-form>
        <label for="new-comment" class="visually-hidden">${esc(S.commentPlaceholder)}</label>
        <textarea id="new-comment" name="body" rows="2"
                  placeholder="${esc(S.commentPlaceholder)}" required></textarea>
        <button type="submit" data-comment-submit>${esc(S.commentSubmit)}</button>
      </form>
    </section>

    <section aria-labelledby="panel-checklist">
      <h3 id="panel-checklist">${esc(S.checklistTitle)}</h3>
      ${checklistHtml(data)}
      <form data-checklist-form>
        <label for="new-item" class="visually-hidden">${esc(S.checklistPlaceholder)}</label>
        <input id="new-item" name="content" type="text"
               placeholder="${esc(S.checklistPlaceholder)}" required />
        <button type="submit">${esc(S.checklistAdd)}</button>
      </form>
    </section>
  `;
}

export interface PanelDeps {
  api: HttpClient;
  userId: string;
  /** Dipanggil setiap ada perubahan agar board bisa disegarkan. */
  onChange?: () => void;
}

/**
 * Panel yang bisa dibuka/tutup. Satu instance dipakai ulang: membuat elemen
 * baru per klik akan menumpuk listener dan membuat fokus tidak bisa
 * dikembalikan ke kartu asal.
 */
export class TaskPanel {
  private dialog: HTMLDialogElement;
  private body: HTMLElement;
  private taskId: string | null = null;
  private opener: HTMLElement | null = null;

  constructor(private deps: PanelDeps) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "task-panel";
    this.dialog.setAttribute("aria-labelledby", "panel-title");
    this.body = document.createElement("div");
    this.body.className = "panel-body";
    this.dialog.append(this.body);
    document.body.append(this.dialog);

    // Escape sudah ditangani <dialog>; ini menangkap klik backdrop.
    this.dialog.addEventListener("click", (ev) => {
      if (ev.target === this.dialog) this.close();
    });
    this.dialog.addEventListener("close", () => this.restoreFocus());
    this.body.addEventListener("click", (ev) => void this.onClick(ev));
    this.body.addEventListener("submit", (ev) => void this.onSubmit(ev));
    this.body.addEventListener("change", (ev) => void this.onChange(ev));
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  get currentTaskId(): string | null {
    return this.taskId;
  }

  async open(taskId: string, opener?: HTMLElement): Promise<void> {
    this.taskId = taskId;
    this.opener = opener ?? null;
    this.dialog.showModal();
    this.body.innerHTML = `<p class="muted" role="status">${esc(S.panelLoading)}</p>`;
    await this.reload();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
    this.taskId = null;
  }

  /** Mengembalikan fokus ke kartu yang membuka panel — tanpa ini, pengguna
   *  keyboard kembali ke awal halaman dan kehilangan posisinya. */
  private restoreFocus(): void {
    this.opener?.focus?.();
    this.opener = null;
  }

  private async reload(): Promise<void> {
    if (!this.taskId) return;
    const [task, comments, checklist] = await Promise.all([
      this.deps.api.taskDetail(this.taskId),
      this.deps.api.listComments(this.taskId),
      this.deps.api.listChecklist(this.taskId),
    ]);

    if (!task.ok || !task.data) {
      this.body.innerHTML = `
        <div class="error" role="alert">
          <strong>${esc(task.status === 403 ? S.panelForbidden : S.panelError)}</strong>
          <p class="trace">${esc(S.traceLabel)}: <code>${esc(task.error?.trace_id ?? "")}</code></p>
        </div>`;
      return;
    }

    /**
     * Komentar & checklist gagal dimuat TIDAK boleh menghapus detail task:
     * pengguna tetap bisa melihat judul dan deskripsi, dan sebagian fitur
     * hilang dengan pesan — bukan seluruh panel menjadi galat.
     */
    const data: PanelData = {
      task: task.data,
      comments: comments.ok ? comments.data!.comments : [],
      checklist: checklist.ok
        ? checklist.data!
        : { items: [], progress: { done: 0, total: 0 } },
    };
    this.body.innerHTML = panelHtml(data, this.deps.userId);
  }

  private async onClick(ev: Event): Promise<void> {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-panel-close],[data-comment-delete],[data-comment-edit],[data-item-delete]");
    if (!el) return;

    if (el.dataset["panelClose"] !== undefined) {
      this.close();
      return;
    }

    const deleteCommentId = el.dataset["commentDelete"];
    if (deleteCommentId) {
      const ok = await this.deps.api.deleteComment(deleteCommentId);
      if (ok.ok) {
        await this.reload();
        this.deps.onChange?.();
      }
      return;
    }

    const editId = el.dataset["commentEdit"];
    if (editId) {
      this.startEditing(editId);
      return;
    }

    const deleteItemId = el.dataset["itemDelete"];
    if (deleteItemId) {
      const ok = await this.deps.api.deleteChecklistItem(deleteItemId);
      if (ok.ok) {
        await this.reload();
        this.deps.onChange?.();
      }
    }
  }

  /**
   * Mengubah komentar DI TEMPAT, bukan membuka panel baru: pengguna harus
   * melihat teks lama saat memperbaikinya. Tanpa itu, mengedit menjadi
   * menulis ulang dari ingatan.
   */
  private startEditing(commentId: string): void {
    const li = this.body.querySelector<HTMLElement>(`li[data-comment-id="${commentId}"]`);
    if (!li) return;
    const bodyEl = li.querySelector<HTMLElement>(".comment-body");
    const original = bodyEl?.textContent ?? "";
    li.innerHTML = `
      <form data-comment-edit-form data-comment-id="${esc(commentId)}">
        <label class="visually-hidden" for="edit-${esc(commentId)}">${esc(S.commentEdit)}</label>
        <textarea id="edit-${esc(commentId)}" name="body" rows="2" required>${esc(original)}</textarea>
        <button type="submit">${esc(S.commentSave)}</button>
        <button type="button" data-cancel-edit>${esc(S.commentCancel)}</button>
      </form>`;
    const ta = li.querySelector<HTMLTextAreaElement>("textarea");
    ta?.focus();
    li.querySelector("[data-cancel-edit]")?.addEventListener("click", () => void this.reload());
  }

  private async onSubmit(ev: Event): Promise<void> {
    const form = ev.target as HTMLFormElement;
    ev.preventDefault();

    if (form.matches("[data-comment-form]")) {
      const fd = new FormData(form);
      const body = String(fd.get("body") ?? "").trim();
      if (body.length === 0 || !this.taskId) return;
      const btn = form.querySelector<HTMLButtonElement>("[data-comment-submit]");
      if (btn) { btn.disabled = true; btn.textContent = S.commentSubmitting; }
      const res = await this.deps.api.createComment(this.taskId, body);
      // Isian HANYA dikosongkan bila berhasil: pengguna yang kena galat jaringan
      // tidak boleh kehilangan teks yang sudah ditulisnya.
      if (res.ok) {
        form.reset();
        await this.reload();
        this.deps.onChange?.();
      } else if (btn) {
        btn.disabled = false;
        btn.textContent = S.commentSubmit;
        this.showFormError(form, res.error?.message ?? S.errorGeneric);
      }
      return;
    }

    if (form.matches("[data-comment-edit-form]")) {
      const id = form.dataset["commentId"]!;
      const body = String(new FormData(form).get("body") ?? "").trim();
      if (body.length === 0) return;
      const res = await this.deps.api.updateComment(id, body);
      if (res.ok) {
        await this.reload();
        this.deps.onChange?.();
      } else {
        this.showFormError(
          form,
          res.status === 403 ? S.commentWindowClosed : (res.error?.message ?? S.errorGeneric),
        );
      }
      return;
    }

    if (form.matches("[data-checklist-form]")) {
      const content = String(new FormData(form).get("content") ?? "").trim();
      if (content.length === 0 || !this.taskId) return;
      const res = await this.deps.api.addChecklistItem(this.taskId, content);
      if (res.ok) {
        form.reset();
        await this.reload();
        this.deps.onChange?.();
      } else {
        this.showFormError(form, res.error?.message ?? S.errorGeneric);
      }
    }
  }

  private async onChange(ev: Event): Promise<void> {
    const el = ev.target as HTMLElement;
    if (!(el instanceof HTMLInputElement) || el.type !== "checkbox") return;
    const itemId = el.dataset["itemToggle"];
    if (!itemId) return;
    const res = await this.deps.api.updateChecklistItem(itemId, { is_done: el.checked });
    if (!res.ok) {
      // Kembalikan centang: membiarkannya tercentang berarti UI berbohong
      // tentang keadaan server.
      el.checked = !el.checked;
      return;
    }
    await this.reload();
    this.deps.onChange?.();
  }

  private showFormError(form: HTMLFormElement, message: string): void {
    const existing = form.querySelector(".form-error");
    const p = existing ?? document.createElement("p");
    p.className = "form-error";
    p.setAttribute("role", "alert");
    p.textContent = message;
    if (!existing) form.append(p);
  }
}

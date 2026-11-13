/**
 * Titik masuk UI. Mengambil data dari API lalu merender.
 *
 * PENTING: fetch memakai path RELATIF. Browser pengguna bukan sandbox, jadi
 * UI tidak boleh menghubungi localhost/127.0.0.1 — server dev yang mem-proxy.
 */
import { HttpClient } from "./lib/api.js";
import { BoardStore, initialState } from "./lib/store.js";
import { boardHtml, hydrateSelects, renderBoard } from "./components/board.js";
import { mountLogin, type LoginUser } from "./components/login.js";
import { TaskPanel } from "./components/task-panel.js";
import { S } from "./i18n/strings.js";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("elemen #app tidak ada");

const api = new HttpClient({ baseUrl: "" });
const teamId = root.dataset["teamId"] ?? "";
const title = document.querySelector<HTMLElement>("h1");

/**
 * Urutan: tanya server SIAPA pemanggil, baru putuskan tampilan.
 *
 * KENAPA TIDAK LANGSUNG MERENDER PAPAN: versi sebelumnya memasang papan lalu
 * memuat data. Pengguna yang belum punya sesi melihat kerangka papan, lalu
 * galat — dan tidak pernah diarahkan untuk login. Satu permintaan ke `/v1/me`
 * menghilangkan tebakan itu, dan server tetap satu-satunya penentu kebenaran.
 */
/** Identitas pemanggil dipakai panel untuk memutuskan tombol mana yang tampil. */
let currentUserId = "";

async function boot(): Promise<void> {
  const me = await api.me();
  if (me.ok && me.data) {
    currentUserId = me.data.user.id;
    showBoard();
    return;
  }
  if (me.status === 401) {
    await showLogin();
    return;
  }
  // Server tidak terjangkau atau galat lain: tampilkan login dengan pesan
  // jaringan; formulir itu tetap bisa dicoba ulang.
  await showLogin();
}

async function showLogin(): Promise<void> {
  if (title) title.textContent = S.loginTitle;
  await mountLogin(root!, {
    api,
    onSuccess: (user: LoginUser) => {
      void user;
      showBoard();
    },
  });
}

function showBoard(): void {
  if (title) title.textContent = S.boardTitle;

  const store = new BoardStore({
    api,
    teamId,
    onChange: (state) => {
      root!.innerHTML = boardHtml(state);
      hydrateSelects(root!, state);
    },
  });

  const panel = new TaskPanel({
    api,
    userId: currentUserId,
    /**
     * Panel mengubah data (komentar, checklist) yang juga tampil di kartu
     * (progres checklist). Menyegarkan board setelah perubahan membuat dua
     * tampilan tidak pernah berbeda.
     */
    onChange: () => void store.load(),
  });

  renderBoard({
    store,
    root: root!,
    onOpenTask: (taskId, opener) => void panel.open(taskId, opener),
  });
  root!.innerHTML = boardHtml(initialState());
  void store.load();
}

void boot();

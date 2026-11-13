/**
 * Titik masuk UI. Mengambil data dari API lalu merender.
 *
 * PENTING: fetch memakai path RELATIF. Browser pengguna bukan sandbox, jadi
 * UI tidak boleh menghubungi localhost/127.0.0.1 — server dev yang mem-proxy.
 */
import { HttpClient } from "./lib/api.js";
import { BoardStore, initialState } from "./lib/store.js";
import { boardHtml, hydrateSelects, renderBoard } from "./components/board.js";
import { S } from "./i18n/strings.js";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("elemen #app tidak ada");

const teamId = root.dataset["teamId"] ?? "";
const title = document.querySelector<HTMLElement>("h1");
if (title) title.textContent = S.boardTitle;

const store = new BoardStore({
  api: new HttpClient({ baseUrl: "" }),
  teamId,
  onChange: (state) => {
    root.innerHTML = boardHtml(state);
    hydrateSelects(root, state);
  },
});

renderBoard({ store, root });
root.innerHTML = boardHtml(initialState());
void store.load();

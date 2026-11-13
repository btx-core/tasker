/**
 * Halaman login (FR-112). Tanpa framework, tanpa dependensi — sama seperti
 * board: yang harus dibuktikan adalah alurnya, bukan pilihan pustaka.
 *
 * Prinsip yang dipegang:
 *  - Formulir HTML biasa (`<form>`), bukan div+onclick. Artinya `Enter`
 *    mengirim, dan pengelola password browser bisa mengisinya. Itu bukan
 *    detail: formulir yang tidak dikenali browser sebagai form login membuat
 *    pengguna mengetik password setiap hari.
 *  - Galat ditampilkan di SATU tempat (`role="alert"`), dengan teks dari i18n.
 *  - Pesan galat TIDAK membedakan "email tidak terdaftar" dan "password salah".
 */
import type { HttpClient } from "../lib/api.js";
import { S } from "../i18n/strings.js";

export interface LoginUser {
  id: string;
  displayName: string;
  workspaceId: string | null;
}

export function loginHtml(): string {
  return `
    <section class="login" aria-labelledby="login-title">
      <h2 id="login-title">${S.loginTitle}</h2>
      <form id="login-form" novalidate>
        <label for="login-email">${S.loginEmail}</label>
        <input id="login-email" name="email" type="email" autocomplete="username"
               required autofocus />

        <label for="login-password">${S.loginPassword}</label>
        <input id="login-password" name="password" type="password"
               autocomplete="current-password" required />

        <button type="submit" id="login-submit">${S.loginSubmit}</button>
      </form>
      <p class="login-error" id="login-error" role="alert" hidden></p>
    </section>
  `;
}

/** Memetakan hasil API ke teks yang aman ditampilkan (tanpa membocorkan detail). */
export function loginErrorMessage(status: number, code: string | undefined): string {
  if (status === 0) return S.loginNetwork;
  if (status === 429) return S.loginRateLimited;
  if (code === "auth.email_unverified") return S.loginUnverified;
  if (status === 401 || code === "auth.invalid_credentials") return S.loginFailed;
  // Validasi bentuk (400) tetap "email atau password salah" dari sudut pandang
  // pengguna: mereka hanya perlu memperbaiki isian.
  if (status === 400) return S.loginFailed;
  return S.loginFailed;
}

/**
 * Memasang penangan submit. Mengembalikan user yang berhasil login, atau null.
 */
export async function mountLogin(
  root: HTMLElement,
  opts: { api: HttpClient; onSuccess: (user: LoginUser) => void },
): Promise<void> {
  root.innerHTML = loginHtml();
  const form = root.querySelector<HTMLFormElement>("#login-form");
  const error = root.querySelector<HTMLElement>("#login-error");
  const submit = root.querySelector<HTMLButtonElement>("#login-submit");
  if (!form || !error || !submit) return;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void (async () => {
      const data = new FormData(form);
      const email = String(data.get("email") ?? "");
      const password = String(data.get("password") ?? "");

      /**
       * Tombol dinonaktifkan selama permintaan berjalan. Tanpa ini, pengguna
       * yang menekan Enter dua kali mengirim dua percobaan login — dan
       * percobaan itu ikut menghabiskan jatah 10/menit.
       */
      submit.disabled = true;
      submit.textContent = S.loginSubmitting;
      error.hidden = true;

      try {
        const res = await opts.api.login(email, password);
        if (!res.ok || !res.data) {
          error.textContent = loginErrorMessage(res.status, res.error?.code);
          error.hidden = false;
          // Fokus ke galat supaya pembaca layar mengumumkannya (WCAG 2.2 AA).
          error.focus?.();
          return;
        }
        opts.onSuccess(res.data.user);
      } catch {
        error.textContent = S.loginNetwork;
        error.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = S.loginSubmit;
      }
    })();
  });
}

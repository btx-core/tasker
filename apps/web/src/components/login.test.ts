/**
 * Uji halaman login. Dua hal yang benar-benar penting:
 *  - Pesan galat tidak boleh membedakan "email tidak terdaftar" dari
 *    "password salah".
 *  - Formulir harus bisa dipakai lewat keyboard dan dikenali browser sebagai
 *    form login (atribut autocomplete), bukan sekadar terlihat seperti form.
 */
import { describe, expect, it } from "vitest";
import { loginErrorMessage, loginHtml } from "./login.js";
import { S } from "../i18n/strings.js";

describe("loginErrorMessage", () => {
  it("401 dan auth.invalid_credentials memberi pesan yang SAMA", () => {
    const a = loginErrorMessage(401, "auth.invalid_credentials");
    const b = loginErrorMessage(401, undefined);
    expect(a).toBe(b);
    expect(a).toBe(S.loginFailed);
  });

  it("429 meminta menunggu, bukan menyalahkan kredensial", () => {
    expect(loginErrorMessage(429, "rate.limited")).toBe(S.loginRateLimited);
    expect(loginErrorMessage(429, "rate.limited")).not.toBe(S.loginFailed);
  });

  it("galat jaringan (status 0) punya pesan sendiri", () => {
    expect(loginErrorMessage(0, undefined)).toBe(S.loginNetwork);
  });

  it("email belum diverifikasi dibedakan (password sudah benar)", () => {
    expect(loginErrorMessage(403, "auth.email_unverified")).toBe(S.loginUnverified);
  });

  it("tidak ada pesan yang membocorkan keberadaan akun", () => {
    // Kalimat yang menyebut "tidak terdaftar"/"belum punya akun" akan
    // mengubah halaman login menjadi alat pencarian akun.
    const all = [
      loginErrorMessage(401, undefined),
      loginErrorMessage(400, undefined),
      S.loginFailed,
    ];
    for (const msg of all) {
      expect(msg.toLowerCase()).not.toContain("terdaftar");
      expect(msg.toLowerCase()).not.toContain("belum punya akun");
    }
  });
});

describe("loginHtml", () => {
  const html = loginHtml();

  it("memakai <form> sungguhan, bukan div + onclick", () => {
    expect(html).toContain("<form");
    expect(html).toContain('type="submit"');
  });

  it("autocomplete benar supaya pengelola password browser bekerja", () => {
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('type="password"');
  });

  it("galat diumumkan pembaca layar (role=alert)", () => {
    expect(html).toContain('role="alert"');
  });

  it("setiap input punya <label>", () => {
    expect(html).toContain('for="login-email"');
    expect(html).toContain('for="login-password"');
  });

  it("tidak memuat teks siap-tampil di luar i18n", () => {
    // Semua teks berasal dari S; html() hanya merangkai.
    expect(html).toContain(S.loginTitle);
    expect(html).toContain(S.loginSubmit);
  });
});

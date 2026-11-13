/**
 * Use-case login (FR-112). Tanpa HTTP, tanpa cookie: masuk `{email, password}`,
 * keluar token atau `ApiError`. Semua keputusan keamanan ada di sini supaya
 * bisa diuji tanpa server, dan supaya handler tinggal menerjemahkan.
 *
 * TIGA HAL YANG TIDAK BOLEH BOCOR, dan masing-masing punya penangkalnya:
 *
 *  1. Email terdaftar atau tidak  -> pesan & WAKTU respons dibuat sama
 *     (`burnPasswordTime`). Tanpa itu, penyerang tidak perlu menebak password;
 *     cukup mengukur durasi.
 *  2. Password salah vs email salah -> satu kode error yang sama persis.
 *  3. Password di log -> modul ini tidak pernah mencatat apa pun. Log ada di
 *     lapisan HTTP dan hanya memuat trace_id + jenis kejadian.
 */
import type { Client } from "pg";
import { ApiError, ERROR_CODES } from "@kelindan/shared";
import { createSession, type IssuedSession } from "@kelindan/db";
import { burnPasswordTime, verifyPassword } from "./password.js";

export interface LoginDeps {
  db: () => Promise<Client>;
  /**
   * Pemeriksaan tambahan setelah password terbukti benar. Disuntikkan supaya
   * use-case tidak bergantung pada skema workspace, dan supaya kebijakan
   * "boleh login?" punya satu tempat.
   */
  onSuccess?: (user: { id: string; workspaceId: string | null }) => Promise<void>;
}

export interface LoginResult extends IssuedSession {
  user: { id: string; displayName: string; workspaceId: string | null };
}

/**
 * Email dinormalkan SEBELUM lookup. Tanpa ini, "A@x.id" dan "a@x.id" adalah
 * dua akun berbeda dari sudut pandang query, dan pembatas laju bisa dilewati
 * hanya dengan mengubah huruf besar-kecil.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (t.length === 0 || t.length > 320) return null;
  // Pemeriksaan bentuk minimal: satu '@', ada bagian sebelum & sesudah, ada titik
  // di domain. Bukan validasi RFC lengkap — tujuannya menolak sampah, bukan
  // memutuskan alamat mana yang "nyata".
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  return t;
}

/** Pesan untuk input yang tidak berbentuk, BUKAN "kredensial salah". */
const MSG_BAD_INPUT = "email dan password wajib diisi";

export async function login(
  deps: LoginDeps,
  input: { email: unknown; password: unknown; ip?: string | null; userAgent?: string | null },
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";

  if (email === null || password.length === 0) {
    // Validasi bentuk boleh memberi tahu field mana yang salah: itu bukan
    // rahasia, dan pengguna berhak tahu. Yang tidak boleh dibocorkan adalah
    // keberadaan AKUN.
    throw ApiError.validation(MSG_BAD_INPUT);
  }

  const db = await deps.db();
  const { rows } = await db.query<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string | null;
    email_verified_at: Date | null;
    deleted_at: Date | null;
    is_placeholder: boolean;
  }>(
    `SELECT id, email, display_name, password_hash, email_verified_at, deleted_at, is_placeholder
       FROM users WHERE email = $1`,
    [email],
  );
  const user = rows[0];

  /**
   * Jalur "tidak ada": waktu dibakar supaya sama dengan jalur "ada".
   * `is_placeholder` diperlakukan seperti tidak ada — akun placeholder dibuat
   * sistem untuk impor, bukan untuk login, dan tidak punya password_hash.
   */
  const usable = user && !user.deleted_at && !user.is_placeholder && user.password_hash;
  if (!usable) {
    await burnPasswordTime(password);
    throw ApiError.invalidCredentials();
  }

  const ok = await verifyPassword(password, user.password_hash!);
  if (!ok) throw ApiError.invalidCredentials();

  /**
   * Email belum diverifikasi: DITOLAK, tetapi dengan kode yang berbeda.
   * Pengguna yang baru mendaftar harus tahu apa yang harus dilakukan; ini juga
   * tidak membocorkan apa pun, karena password sudah terbukti benar.
   */
  if (user.email_verified_at === null) {
    throw new ApiError(403, ERROR_CODES.EMAIL_UNVERIFIED, "Email belum diverifikasi");
  }

  // Workspace aktif: untuk sekarang workspace PERTAMA yang diikuti user.
  // Multi-workspace penuh (FR-113) belum ada UI pemilihnya.
  const { rows: memberships } = await db.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM workspace_members
      WHERE user_id = $1 ORDER BY created_at, id LIMIT 1`,
    [user.id],
  );
  const workspaceId = memberships[0]?.workspace_id ?? null;

  await deps.onSuccess?.({ id: user.id, workspaceId });

  const session = await createSession(db, {
    userId: user.id,
    workspaceId,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  return {
    ...session,
    user: { id: user.id, displayName: user.display_name, workspaceId },
  };
}

/**
 * Cookie sesi. Atribut bukan hiasan:
 *  - `HttpOnly` : JavaScript tidak bisa membaca token, jadi XSS tidak bisa
 *                 mencuri sesi.
 *  - `Secure`   : tidak dikirim lewat HTTP biasa.
 *  - `SameSite=Lax` : tidak ikut pada POST lintas situs (CSRF), tetapi tetap
 *                 ikut saat pengguna datang dari tautan — alasan Lax dan bukan
 *                 Strict adalah pengalaman: Strict memaksa login ulang setiap
 *                 kali pengguna mengeklik tautan task dari Slack.
 *  - `Path=/`   : berlaku untuk seluruh API dan UI.
 */
export function sessionCookie(token: string, expiresAt: Date, secure = true): string {
  const parts = [
    `kelindan_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Menghapus cookie: nilai kosong + Expires di masa lalu. */
export function clearSessionCookie(secure = true): string {
  const parts = ["kelindan_session=", "Path=/", "HttpOnly", "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

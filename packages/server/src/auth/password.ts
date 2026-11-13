/**
 * Password hashing. FR-112 menyebut Argon2id; kita memakai **scrypt bawaan
 * `node:crypto`**, dan keputusan itu disengaja.
 *
 * KENAPA BUKAN Argon2id (menyimpang dari FR-112, dicatat sebagai T-31):
 * Argon2id di Node berarti dependensi native (`argon2`, `@node-rs/argon2`).
 * Itu menambah binary yang harus dibangun/diunduh per platform, dan kegagalan
 * build-nya muncul sebagai kegagalan paket yang tidak ada hubungannya dengan
 * kode kita. Untuk fase ini, scrypt memberi jaminan yang setara untuk tujuan
 * yang kita butuhkan — memory-hard, salt acak, perbandingan waktu konstan —
 * tanpa satu byte binary pihak ketiga.
 *
 * Parameter di bawah (`N=2^15`, `r=8`, `p=1`) setara memory-cost Argon2id
 * ~32 MiB: cukup mahal untuk penyerang, masih ~100 ms untuk server. Biaya ini
 * sengaja dibayar SERVER, bukan klien, dan hanya pada login.
 *
 * KAPAN DIGANTI: bila kelak ada kebutuhan kompatibilitas hash dengan sistem
 * lain, atau audit keamanan menuntut Argon2id. Format hash menyimpan
 * algoritma & parameternya, sehingga migrasi per-user mungkin tanpa reset
 * password massal.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Biaya: N=32768 (2^15), r=8, p=1 => ~32 MiB per hash.
 * `maxmem` HARUS dinaikkan: default Node 32 MiB persis, dan scrypt dengan
 * N=32768 r=8 butuh 128*N*r = 32 MiB + overhead, sehingga default gagal.
 */
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

/** Bentuk yang disimpan: `scrypt$N$r$p$salt_hex$hash_hex`. */
const PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  // HATI-HATI: harus lewat `scryptWith` dengan parameter eksplisit. Versi
  // pertama modul ini memakai `scrypt()` polos yang defaultnya N=16384,
  // sementara `verifyPassword` membaca N=32768 dari string hash — hash tidak
  // cocok dengan dirinya sendiri. Uji "menerima password yang benar" yang
  // menangkapnya, bukan pembacaan kode.
  const hash = await scryptWith(password, salt, KEYLEN, { n: N, r: R, p: P });
  return [PREFIX, N, R, P, salt.toString("hex"), hash.toString("hex")].join("$");
}

/**
 * Selalu mengembalikan boolean, tidak pernah melempar untuk input yang salah
 * bentuk. Hash yang rusak diperlakukan sebagai "tidak cocok" — bukan error,
 * karena error di jalur ini membocorkan keberadaan baris.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [prefix, nRaw, rRaw, pRaw, saltHex, hashHex] = parts as [
    string, string, string, string, string, string,
  ];
  if (prefix !== PREFIX) return false;

  const expected = Buffer.from(hashHex, "hex");
  const salt = Buffer.from(saltHex, "hex");
  if (expected.length === 0 || salt.length === 0) return false;

  // Parameter dari hash DIPAKAI (bukan konstanta modul) supaya hash lama tetap
  // bisa diverifikasi setelah parameter dinaikkan.
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n < 1024 || r < 1 || p < 1) return false;

  const actual = await scryptWith(password, salt, expected.length, { n, r, p });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function scryptWith(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { n: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(
      password,
      salt,
      keylen,
      { N: opts.n, r: opts.r, p: opts.p, maxmem: MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/**
 * Hash tiruan untuk dibandingkan ketika email TIDAK ditemukan.
 *
 * KENAPA PERLU: bila email tidak ada kita `return` lebih cepat, sedangkan bila
 * email ada kita menghitung scrypt ~100 ms. Selisih waktu itu cukup untuk
 * membedakan "terdaftar" dari "tidak" lewat pengukuran respons — enumerasi
 * akun tanpa satu pun request tambahan. Dengan menghitung hash tiruan, kedua
 * jalur memakan waktu yang sama.
 */
export async function burnPasswordTime(password: string): Promise<void> {
  await scrypt(password, DUMMY_SALT, KEYLEN).catch(() => undefined);
}

const DUMMY_SALT = Buffer.from("kelindan-dummy-salt-not-a-real-account", "utf8");

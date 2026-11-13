/**
 * UUIDv7 dibuat DI APLIKASI (ADR-018), bukan di database.
 * Alasannya: ID harus tersedia sebelum commit (optimistic UI, `changes`, outbox),
 * dan pengujian unit tidak boleh butuh DB.
 *
 * Bentuk: 48 bit milidetik + 4 bit versi (7) + 12 bit acak + 2 bit varian + 62 bit acak.
 */
const HEX = "0123456789abcdef";

export function uuidv7(now: number = Date.now(), rnd: Uint8Array = randomBytes(10)): string {
  if (rnd.length < 10) throw new Error("uuidv7: butuh minimal 10 byte acak");

  const b = new Uint8Array(16);

  // 48 bit timestamp (big-endian, milidetik)
  const ts = now;
  b[0] = (ts / 2 ** 40) & 0xff;
  b[1] = (ts / 2 ** 32) & 0xff;
  b[2] = (ts / 2 ** 24) & 0xff;
  b[3] = (ts / 2 ** 16) & 0xff;
  b[4] = (ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;

  // versi 7 di 4 bit atas byte 6
  b[6] = 0x70 | (rnd[0]! & 0x0f);
  b[7] = rnd[1]!;

  // varian 10xx
  b[8] = 0x80 | (rnd[2]! & 0x3f);
  b[9] = rnd[3]!;
  for (let i = 4; i < 10; i++) b[9 + (i - 3)] = rnd[i]!;

  let out = "";
  for (let i = 0; i < 16; i++) {
    const v = b[i]!;
    out += HEX[v >> 4]! + HEX[v & 0x0f]!;
    if (i === 3 || i === 5 || i === 7 || i === 9) out += "-";
  }
  return out;
}

function randomBytes(n: number): Uint8Array {
  const u = new Uint8Array(n);
  globalThis.crypto.getRandomValues(u);
  return u;
}

/** Ekstrak milidetik dari UUIDv7. Melempar bila bukan v7. */
export function uuidv7Timestamp(id: string): number {
  const hex = id.replace(/-/g, "");
  if (hex.length !== 32) throw new Error("uuid tidak valid");
  if (hex[12] !== "7") throw new Error("bukan UUIDv7");
  return parseInt(hex.slice(0, 12), 16);
}

/** ULID-ish untuk `Idempotency-Key`: cukup unik & terurut, tidak perlu standar. */
export function operationId(now = Date.now()): string {
  return uuidv7(now);
}

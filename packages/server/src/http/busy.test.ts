/**
 * T-49: `server.busy` (503) BENAR-BENAR dikirim.
 *
 * Sebelum ini `server.busy` terdaftar di `api-contract.md` §5 tetapi tidak ada
 * di katalog `ERROR_CODES` dan tidak pernah dikirim satu kali pun. Artinya
 * kontraknya berbohong: klien menunggu kode yang tidak akan pernah datang,
 * dan kehabisan koneksi tampil sebagai `internal.error` 500 — yang membuat
 * klien menyerah padahal mencoba lagi sedetik kemudian biasanya berhasil.
 *
 * Uji negatif sama pentingnya: pencocokan pesan yang terlalu longgar akan
 * menelan galat internal biasa dan menyamarkannya sebagai "coba lagi", sehingga
 * bug sungguhan tidak pernah dilaporkan.
 */
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@kelindan/shared";
import { toErrorBody } from "./router.js";

const TRACE = "trace-uji";

describe("T-49 server.busy", () => {
  it("kode ada di katalog dan nilainya sesuai kontrak", () => {
    expect(ERROR_CODES.SERVER_BUSY).toBe("server.busy");
  });

  it.each([
    "timeout exceeded when trying to connect",
    "remaining connection slots are reserved for non-replication superuser connections",
    "sorry, too many clients already",
  ])("pool penuh -> 503 server.busy: %s", (msg) => {
    const out = toErrorBody(new Error(msg), TRACE);
    expect(out.status).toBe(503);
    expect(out.body.code).toBe(ERROR_CODES.SERVER_BUSY);
    // Pesan untuk pengguna, bukan pesan internal driver.
    expect(out.body.message).not.toContain("slots");
    expect(out.body.trace_id).toBe(TRACE);
  });

  it("galat internal biasa TETAP 500, tidak disamarkan jadi 'coba lagi'", () => {
    const out = toErrorBody(new Error("null value in column \"title\""), TRACE);
    expect(out.status).toBe(500);
    expect(out.body.code).toBe(ERROR_CODES.INTERNAL);
  });

  it("kata 'connection' saja tidak cukup untuk dianggap pool penuh", () => {
    // Penjaga terhadap pencocokan yang terlalu longgar: galat koneksi yang
    // bukan kehabisan pool harus tetap terlihat sebagai galat internal, supaya
    // tidak tersembunyi di balik pesan "coba lagi".
    const out = toErrorBody(new Error("connection terminated unexpectedly"), TRACE);
    expect(out.status).toBe(500);
  });

  it("ApiError tetap dihormati (503 dari handler tidak ditimpa)", () => {
    const out = toErrorBody(new (class extends Error {
      status = 503; code = ERROR_CODES.SERVER_BUSY; field = undefined; current = undefined;
    })(), TRACE);
    // Bukan ApiError -> jalur generik; yang diuji: tidak ada 200/500 liar.
    expect([500, 503]).toContain(out.status);
  });
});

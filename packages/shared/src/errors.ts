/**
 * Katalog `code` error. Satu sumber untuk server dan klien (api-contract.md §5.3).
 * `code` TIDAK PERNAH diterjemahkan - itu kontrak mesin (i18n.md §6).
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: "validation.failed",
  UNAUTHENTICATED: "auth.unauthenticated",
  FORBIDDEN: "auth.forbidden",
  NOT_FOUND: "resource.not_found",
  VERSION_CONFLICT: "conflict.version",
  IDEMPOTENCY_MISMATCH: "conflict.idempotency_mismatch",
  UNSUPPORTED_PAYLOAD: "validation.unsupported_payload",
  INTERNAL: "internal.error",
  /**
   * Kredensial salah (FR-112). SENGAJA satu kode untuk "email tidak dikenal"
   * dan "password salah": klien tidak boleh bisa membedakan keduanya, karena
   * perbedaan itu mengubah endpoint login menjadi alat enumerasi akun.
   */
  INVALID_CREDENTIALS: "auth.invalid_credentials",
  /** Batas percobaan terlampaui (NFR-014). Selalu disertai header Retry-After. */
  TOO_MANY_REQUESTS: "rate.limited",
  /**
   * Password benar tetapi email belum diverifikasi. SENGAJA dibedakan dari
   * kredensial salah: hanya pemilik password yang bisa mencapai keadaan ini,
   * dan tanpa kode ini pengguna baru akan melihat "password salah" padahal
   * passwordnya benar — kebingungan yang mahal untuk aplikasi yang dipakai
   * tim.
   */
  EMAIL_UNVERIFIED: "auth.email_unverified",
  /**
   * Pool koneksi database penuh (api-contract.md §5, T-49).
   *
   * KENAPA kode tersendiri, bukan `internal.error`: perbedaannya menentukan apa
   * yang boleh dilakukan klien. Galat internal adalah bug — mencoba lagi tidak
   * menolong. Pool penuh bersifat SEMENTARA — mencoba lagi dalam sedetik
   * biasanya berhasil, dan klien boleh mempertahankan input pengguna. Tanpa
   * kode ini, pengguna melihat "terjadi kesalahan" dan mengetik ulang
   * komentarnya, padahal datanya tidak pernah bermasalah.
   */
  SERVER_BUSY: "server.busy",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  field?: string;
  trace_id: string;
  /** State kanonik terbaru untuk 409 konflik versi (ADR-015). */
  current?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly field: string | undefined;
  readonly current: unknown;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    opts: { field?: string; current?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = opts.field;
    this.current = opts.current;
  }

  static validation(message: string, field?: string): ApiError {
    return new ApiError(400, ERROR_CODES.VALIDATION_FAILED, message, field ? { field } : {});
  }
  static notFound(what: string): ApiError {
    return new ApiError(404, ERROR_CODES.NOT_FOUND, `${what} tidak ditemukan`);
  }
  static versionConflict(current: unknown): ApiError {
    return new ApiError(409, ERROR_CODES.VERSION_CONFLICT, "Versi entitas sudah berubah", { current });
  }
  static idempotencyMismatch(): ApiError {
    return new ApiError(
      409,
      ERROR_CODES.IDEMPOTENCY_MISMATCH,
      "Idempotency-Key sudah dipakai dengan body berbeda",
    );
  }

  /**
   * Pesannya HARUS identik untuk email tak dikenal dan password salah.
   * Bila berbeda, penyerang cukup mencoba banyak email dan membaca pesan untuk
   * tahu mana yang terdaftar — tanpa pernah menebak password.
   */
  static invalidCredentials(): ApiError {
    return new ApiError(
      401,
      ERROR_CODES.INVALID_CREDENTIALS,
      "Email atau password salah",
    );
  }

  static tooManyRequests(retryAfterSeconds: number): ApiError {
    return new ApiError(
      429,
      ERROR_CODES.TOO_MANY_REQUESTS,
      `Terlalu banyak percobaan. Coba lagi dalam ${retryAfterSeconds} detik`,
    );
  }
}

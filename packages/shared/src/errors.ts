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
}

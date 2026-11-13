/**
 * `trace_id` untuk setiap permintaan & error (api-contract.md §5.1).
 * Wajib dapat disalin dari UI dan ditemukan di log server (T-SUP2).
 */
import { uuidv7 } from "./ids.js";

export function newTraceId(): string {
  return uuidv7();
}

const TRACE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Hormati trace_id dari klien hanya bila bentuknya sah; selain itu buat baru. */
export function traceIdFrom(header: string | undefined): string {
  return header && TRACE_RE.test(header) ? header : newTraceId();
}

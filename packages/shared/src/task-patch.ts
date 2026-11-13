/**
 * Validasi & bentuk patch task. Satu sumber untuk server (dan kelak klien).
 * Validator ditulis tangan, bukan dependensi: aturannya sedikit, dan pesan
 * error harus membawa `field` yang tepat (api-contract.md §5).
 */
import type { ErrorCode } from "./errors.js";
import { ERROR_CODES } from "./errors.js";

export interface ValidationIssue {
  code: ErrorCode;
  message: string;
  field: string;
}

export type TaskPatch = {
  title?: string;
  description?: string | null;
  status_id?: string;
  assignee_id?: string | null;
  priority?: number;
  effort?: number | null;
  due_date?: string | null;
};

const PATCHABLE = new Set([
  "title", "description", "status_id", "assignee_id", "priority", "effort", "due_date",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ParseResult {
  ok: boolean;
  patch?: TaskPatch;
  expectedVersion?: number;
  issues: ValidationIssue[];
}

function fail(field: string, message: string): ValidationIssue {
  return { code: ERROR_CODES.VALIDATION_FAILED, message, field };
}

export function parseTaskPatch(body: unknown): ParseResult {
  const issues: ValidationIssue[] = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, issues: [fail("body", "body harus objek JSON")] };
  }
  const raw = body as Record<string, unknown>;
  const patch: TaskPatch = {};

  // Field yang tidak dikenal DITOLAK, bukan diabaikan: salah ketik nama field
  // yang diabaikan akan terlihat seperti "perubahan saya tidak tersimpan".
  for (const key of Object.keys(raw)) {
    if (key === "expected_version") continue;
    if (!PATCHABLE.has(key)) {
      issues.push(fail(key, `field '${key}' tidak dapat diubah`));
    }
  }

  if ("title" in raw) {
    if (typeof raw.title !== "string") issues.push(fail("title", "title harus string"));
    else if (raw.title.length < 1 || raw.title.length > 300) {
      issues.push(fail("title", "title harus 1-300 karakter"));
    } else patch.title = raw.title;
  }

  if ("description" in raw) {
    if (raw.description === null) patch.description = null;
    else if (typeof raw.description !== "string") {
      issues.push(fail("description", "description harus string atau null"));
    } else if (Buffer.byteLength(raw.description, "utf8") > 102_400) {
      issues.push(fail("description", "description melebihi 100 KB"));
    } else patch.description = raw.description;
  }

  if ("status_id" in raw) {
    if (typeof raw.status_id !== "string" || !UUID_RE.test(raw.status_id)) {
      issues.push(fail("status_id", "status_id harus UUID"));
    } else patch.status_id = raw.status_id;
  }

  if ("assignee_id" in raw) {
    if (raw.assignee_id === null) patch.assignee_id = null;
    else if (typeof raw.assignee_id !== "string" || !UUID_RE.test(raw.assignee_id)) {
      issues.push(fail("assignee_id", "assignee_id harus UUID atau null"));
    } else patch.assignee_id = raw.assignee_id;
  }

  if ("priority" in raw) {
    const p = raw.priority;
    if (typeof p !== "number" || !Number.isInteger(p) || p < 0 || p > 4) {
      issues.push(fail("priority", "priority harus 0..4"));
    } else patch.priority = p;
  }

  if ("effort" in raw) {
    if (raw.effort === null) patch.effort = null;
    else if (typeof raw.effort !== "number" || !Number.isInteger(raw.effort) || raw.effort <= 0) {
      issues.push(fail("effort", "effort harus bilangan bulat > 0 atau null"));
    } else patch.effort = raw.effort;
  }

  if ("due_date" in raw) {
    if (raw.due_date === null) patch.due_date = null;
    else if (typeof raw.due_date !== "string" || !DATE_RE.test(raw.due_date)) {
      issues.push(fail("due_date", "due_date harus YYYY-MM-DD atau null"));
    } else patch.due_date = raw.due_date;
  }

  let expectedVersion: number | undefined;
  if ("expected_version" in raw) {
    const v = raw.expected_version;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      issues.push(fail("expected_version", "expected_version harus bilangan bulat >= 1"));
    } else expectedVersion = v;
  }

  if (issues.length > 0) return { ok: false, issues };
  if (Object.keys(patch).length === 0) {
    return { ok: false, issues: [fail("body", "tidak ada field yang diubah")] };
  }
  return { ok: true, patch, ...(expectedVersion !== undefined ? { expectedVersion } : {}), issues: [] };
}

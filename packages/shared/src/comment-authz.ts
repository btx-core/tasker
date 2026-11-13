/**
 * Aturan izin untuk komentar (rbac.md AC-36 / AC-37).
 *
 * KENAPA ATURAN INI TIDAK ADA DI `can()`: `can()` menerima `Actor` dan
 * `Action`, dan sengaja buta terhadap objeknya. "Boleh mengubah komentar ini?"
 * butuh tiga hal yang tidak diketahui `can()`: siapa penulisnya, kapan ditulis,
 * dan apakah komentar itu masih ada. Menaruhnya di sana akan membuat satu
 * fungsi izin tahu tentang komentar, checklist, lampiran, dan seterusnya —
 * persis yang ingin dihindari ADR-003.
 *
 * Jadi pembagiannya: `can()` menjawab "peran ini punya kemampuan itu?",
 * fungsi di sini menjawab "objek INI boleh disentuh oleh orang INI?".
 */
import { ACTIONS, type Actor } from "./actions.js";

/**
 * Jendela edit untuk penulis (rbac.md AC-36: "hanya penulis, dalam 15 menit,
 * atau kapan saja bila `edited_at` ditampilkan").
 *
 * KENAPA ADA BATAS WAKTU SAMA SEKALI: komentar adalah percakapan. Tanpa batas,
 * seseorang bisa menulis "setuju" pada pagi hari dan mengubahnya menjadi
 * "tolak" pada malam hari — dan pembaca berikutnya tidak punya cara tahu.
 * Batas 15 menit cukup untuk memperbaiki salah tulis, terlalu pendek untuk
 * menulis ulang sejarah.
 *
 * Klaim "kapan saja bila `edited_at` ditampilkan": kita TIDAK memakai
 * pengecualian itu. Alasannya, `edited_at` menandai BAHWA diedit, bukan APA
 * yang berubah — dan penghapusan riwayat tetap bisa menyesatkan. Kalau
 * pengecualian itu dibutuhkan kelak, ia harus datang bersama tampilan revisi
 * (ENT-13), bukan sendirian.
 */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

export interface CommentAuthTarget {
  authorId: string;
  createdAt: Date;
  /** Soft delete: komentar tetap ada sebagai placeholder (AC-38). */
  deletedAt: Date | null;
}

export type CommentVerdict =
  | { allowed: true; viaOwn: boolean }
  | { allowed: false; reason: "deleted" | "forbidden" | "window_closed" };

/**
 * Urutan pemeriksaan penting dan sengaja begitu:
 *  1. `deleted` lebih dulu — komentar terhapus tidak bisa diedit siapa pun,
 *     termasuk admin. Menghidupkannya kembali lewat edit akan menghapus makna
 *     soft delete.
 *  2. Moderasi (`comment.update.any`) menang atas batas waktu: admin memoderasi
 *     komentar lama justru karena komentar lama yang bermasalah.
 *  3. Baru kemudian penulis + jendela waktu.
 */
export function canEditComment(
  actor: Actor & { canModerate: boolean },
  target: CommentAuthTarget,
  now: Date = new Date(),
): CommentVerdict {
  if (target.deletedAt !== null) return { allowed: false, reason: "deleted" };

  if (actor.canModerate) return { allowed: true, viaOwn: false };

  if (target.authorId !== actor.userId) return { allowed: false, reason: "forbidden" };

  const age = now.getTime() - target.createdAt.getTime();
  if (age > COMMENT_EDIT_WINDOW_MS) return { allowed: false, reason: "window_closed" };

  return { allowed: true, viaOwn: true };
}

/**
 * Menghapus komentar. Penulis boleh menghapus miliknya KAPAN SAJA (tidak
 * dibatasi 15 menit): berbeda dari mengedit, menghapus tidak memalsukan apa
 * yang pernah dikatakan — jejaknya tetap ada sebagai placeholder.
 */
export function canDeleteComment(
  actor: Actor & { canModerate: boolean },
  target: CommentAuthTarget,
): CommentVerdict {
  if (target.deletedAt !== null) return { allowed: false, reason: "deleted" };
  if (actor.canModerate) return { allowed: true, viaOwn: false };
  if (target.authorId !== actor.userId) return { allowed: false, reason: "forbidden" };
  return { allowed: true, viaOwn: true };
}

/** Action yang dibutuhkan untuk mengedit komentar orang lain (moderasi). */
export const COMMENT_MODERATE_ACTION = ACTIONS.COMMENT_UPDATE_ANY;

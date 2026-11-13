/**
 * Penemuan berkas komponen untuk penjaga i18n (T-45).
 *
 * MASALAH YANG DIPERBAIKI: kedua penjaga i18n menyebut berkas satu per satu
 * (`board.ts`, `main.ts`, …). Artinya setiap komponen BARU otomatis lolos dari
 * aturan "tidak ada string UI di komponen" dan "tidak ada format manual" —
 * tepat ketika ia paling perlu diperiksa. Aturan yang dijaga daftar manual
 * bolong setiap kali ada berkas baru, dan tidak ada yang akan ingat.
 *
 * Sekarang berkas ditemukan dengan MEMINDAI direktori. Berkas uji (`*.test.ts`)
 * dilewati: uji boleh berisi kalimat, karena teks di sana adalah fixture yang
 * dibandingkan dengan `S`, bukan yang tampil ke pengguna.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Berkas yang WAJIB diperiksa: semua `.ts` di `components/` dan `main.ts`.
 * Dikembalikan sebagai path relatif dari akar repo agar pesan gagal mudah dibaca.
 */
export function componentFiles(root = "apps/web/src"): string[] {
  const out: string[] = [];
  const componentsDir = join(root, "components");

  for (const name of readdirSync(componentsDir).sort()) {
    if (!name.endsWith(".ts")) continue;
    if (name.endsWith(".test.ts")) continue;
    out.push(join(componentsDir, name));
  }

  // `main.ts` adalah titik masuk, bukan komponen — tetapi tetap dirender.
  out.push(join(root, "main.ts"));
  return out;
}

/**
 * Penjaga harus MEMBUKTIKAN ia memeriksa sesuatu. Daftar kosong atau terlalu
 * pendek akan membuat semua uji "lulus" tanpa memeriksa satu berkas pun —
 * hijau palsu yang paling mudah terjadi ketika penemuan berkas otomatis.
 */
export const MIN_EXPECTED_FILES = 3;

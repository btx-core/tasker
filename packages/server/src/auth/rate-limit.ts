/**
 * Pembatas laju sederhana di memori proses (NFR-014: login 10/menit/IP).
 *
 * KENAPA JENDELA GESER, BUKAN PENGHITUNG PER MENIT:
 * Penghitung yang di-reset tiap awal menit bisa dilewati dua kali lipat:
 * 10 percobaan pada detik ke-59 dan 10 lagi pada detik ke-01 berikutnya
 * menghasilkan 20 percobaan dalam ~2 detik. Jendela geser menghitung
 * percobaan yang benar-benar terjadi dalam 60 detik terakhir, sehingga batas
 * itu bermakna.
 *
 * BATAS YANG DIAKUI: penyimpanan per-proses. Dengan beberapa instans, batas
 * efektif menjadi N x 10. Untuk satu instans (fase R0) ini benar; sebelum
 * skala horizontal, penghitung harus pindah ke Redis/Postgres. Dicatat T-32.
 *
 * Memori dijaga: entri yang seluruh stempelnya sudah kedaluwarsa dibuang saat
 * kunci itu disentuh, dan ada pembersihan berkala agar IP yang mencoba sekali
 * lalu hilang tidak menumpuk selamanya.
 */
export interface RateLimiter {
  /** Mencatat percobaan. `allowed:false` berarti batas terlampaui. */
  hit(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number };
  /** Untuk uji: jumlah kunci yang tersimpan. */
  size(): number;
}

export function createRateLimiter(opts: {
  max: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { max, windowMs } = opts;
  const clock = opts.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();

  // Pembersihan malas tapi terbatas: satu sapuan per rentang jendela.
  let lastSweep = 0;
  const sweep = (now: number) => {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, stamps] of hits) {
      const alive = stamps.filter((t) => now - t < windowMs);
      if (alive.length === 0) hits.delete(key);
      else hits.set(key, alive);
    }
  };

  return {
    hit(key, now = clock()) {
      sweep(now);
      const cutoff = now - windowMs;
      const stamps = (hits.get(key) ?? []).filter((t) => t > cutoff);

      if (stamps.length >= max) {
        hits.set(key, stamps);
        // Tunggu sampai percobaan tertua keluar dari jendela.
        const oldest = stamps[0]!;
        const retryAfterMs = oldest + windowMs - now;
        // Minimal 1 detik: "Retry-After: 0" mengundang klien mencoba lagi
        // segera, yang justru memperpanjang blokir.
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
      }

      stamps.push(now);
      hits.set(key, stamps);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size() {
      return hits.size;
    },
  };
}

/**
 * Kunci pembatas. IP saja tidak cukup: satu kantor dengan NAT berbagi satu IP,
 * dan satu orang yang salah mengetik password bisa memblokir seluruh kantor.
 * Karena itu kuncinya gabungan IP + email — percobaan terhadap akun A tidak
 * menghabiskan jatah akun B dari IP yang sama.
 *
 * Email dinormalkan lebih dulu oleh pemanggil (lowercase + trim).
 */
export function loginRateLimitKey(ip: string, email: string): string {
  return `${ip}|${email.toLowerCase()}`;
}

/** IP klien dari header proxy, dengan asumsi proxy tepercaya di depan aplikasi. */
export function clientIp(headers: Record<string, unknown>, fallback = "unknown"): string {
  const fwd = headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof raw === "string" && raw.length > 0) {
    // Entri pertama = klien asli; sisanya hop proxy.
    return raw.split(",")[0]!.trim();
  }
  const real = headers["x-real-ip"];
  if (typeof real === "string" && real.length > 0) return real;
  return fallback;
}

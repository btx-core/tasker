/**
 * Pemantau pencabutan akses (TC-15, `P3-06`).
 *
 * MASALAHNYA: `hub.revokeTeam()` sudah benar, tetapi tidak ada yang memanggilnya
 * ketika anggota tim benar-benar dicabut. Tanpa pemantau, user yang dicabut
 * tetap menerima delta sampai ia menutup tab — dan itu persis kegagalan yang
 * dijanjikan `rbac.md` tidak akan terjadi.
 *
 * PENDEKATAN: memantau tabel `team_members` lewat `LISTEN/NOTIFY` plus jajak
 * berkala sebagai jaring pengaman. NOTIFY saja tidak cukup: ia hilang bila
 * tidak ada yang mendengarkan saat perubahan terjadi (mis. server restart),
 * dan `revoked_at` yang diisi lewat jalur lain (impor, SQL manual) tidak akan
 * mengirim NOTIFY sama sekali.
 *
 * KEPUTUSAN: jajak setiap `intervalMs` (default 1 dtk). Untuk 40 tim ×
 * ratusan anggota, satu query per detik jauh lebih murah daripada satu
 * langganan per pengguna. Angka itu dipilih agar **batas 5 detik** punya
 * margin 5×, bukan karena 1 detik itu istimewa.
 */
import type { SqlClient } from "../http/routes.js";
import type { Hub } from "./hub.js";

export interface RevocationWatcherDeps {
  db: () => Promise<SqlClient>;
  hub: Hub;
  /** Berapa sering memeriksa. Default 1000 ms. */
  intervalMs?: number;
  /** Dipanggil setelah pencabutan agar pemanggil bisa mencatat waktu. */
  onRevoked?: (teamId: string, userId: string, at: Date) => void;
  now?: () => Date;
}

interface Membership {
  teamId: string;
  userId: string;
}

export class RevocationWatcher {
  private timer: NodeJS.Timeout | null = null;
  /** Sidik jari keanggotaan yang PERNAH terlihat aktif. */
  private known = new Map<string, Membership>();
  private running = false;

  constructor(private deps: RevocationWatcherDeps) {}

  private key(teamId: string, userId: string): string {
    return `${teamId}:${userId}`;
  }

  /** Baca keanggotaan aktif; kembalikan yang BARU hilang sejak panggilan lalu. */
  async poll(): Promise<Array<Membership & { at: Date }>> {
    const client = await this.deps.db();
    /**
     * KONEKSI WAJIB DIKEMBALIKAN (T-49). `poll()` berjalan TIAP DETIK.
     *
     * Bug yang diperbaiki: dulu koneksi tidak pernah dilepas. Pada `Client`
     * tunggal itu tidak terlihat — selalu koneksi yang sama. Begitu `deps.db`
     * memakai `pg.Pool`, setiap jajak meminjam satu koneksi dan menahannya
     * selamanya: sepuluh detik cukup untuk menghabiskan pool `max: 10`, dan
     * SETELAH ITU SEMUA ENDPOINT mengembalikan 503 `server.busy`.
     *
     * Gejalanya menyesatkan — login gagal padahal login tidak ada hubungannya
     * dengan pencabutan — dan hanya muncul pada jalur `DATABASE_URL` yang
     * sebelumnya belum pernah dijalankan sama sekali.
     */
    const release = (client as { release?: () => void }).release;
    try {
    const res = await client.query<{ team_id: string; user_id: string }>(
      `SELECT team_id, user_id FROM team_members WHERE revoked_at IS NULL`,
    );
    const active = new Map<string, Membership>();
    for (const r of res.rows) {
      const m = { teamId: r.team_id, userId: r.user_id };
      active.set(this.key(m.teamId, m.userId), m);
    }

    const now = (this.deps.now ?? (() => new Date()))();
    const revoked: Array<Membership & { at: Date }> = [];
    // Hanya yang DULU aktif lalu hilang. Keanggotaan yang belum pernah terlihat
    // tidak dianggap pencabutan — kalau tidak, setiap restart server akan
    // "mencabut" semua orang.
    for (const [k, m] of this.known) {
      if (!active.has(k)) {
        revoked.push({ ...m, at: now });
        this.deps.onRevoked?.(m.teamId, m.userId, now);
      }
    }
    this.known = active;
    return revoked;
    } finally {
      if (typeof release === "function") release.call(client);
    }
  }

  /** Jalankan pemeriksaan berkala. Idempoten: panggilan kedua diabaikan. */
  start(): void {
    if (this.timer) return;
    // Isi `known` lebih dulu, supaya keanggotaan yang sudah ada tidak dianggap
    // pencabutan pada jajak pertama.
    void this.poll().then(() => {
      this.timer = setInterval(() => {
        if (this.running) return; // jangan menumpuk bila DB lambat
        this.running = true;
        void this.poll()
          .then((revoked) => {
            for (const r of revoked) this.deps.hub.revokeTeam(r.teamId);
          })
          .catch(() => { /* DB sementara tidak tersedia: coba lagi di jajak berikutnya */ })
          .finally(() => { this.running = false; });
      }, this.deps.intervalMs ?? 1000);
      this.timer.unref?.();
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * Server dev & demo: menyajikan UI + API dalam SATU origin.
 *
 * KENAPA satu origin, bukan dua: browser pengguna (dan preview) tidak boleh
 * menghubungi `localhost` untuk API — di preview, `localhost` adalah mesin
 * pengguna, bukan sandbox. Dengan satu origin, UI cukup memakai path relatif
 * (`/v1/...`) dan tidak ada CORS yang perlu dikonfigurasi.
 *
 * Database: PGlite IN-PROCESS, bukan Postgres jaringan. Ini membuat demo bisa
 * dijalankan tanpa infrastruktur, dan tetap memakai PostgreSQL sungguhan
 * (WASM) serta migrasi yang sama. Untuk produksi, `createApp()` diberi klien
 * `pg` biasa dan berkas ini tidak dipakai.
 */
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createTestClient, applyMigrations } from "@kelindan/testing";
import { createApp, dbSessionRepo, resolveAuth, type AppDeps } from "@kelindan/server";
import { Hub, RevocationWatcher } from "@kelindan/server";
import { uuidv7, TEAM_ROLE } from "@kelindan/shared";

const WEB_ROOT = new URL("../../web/", import.meta.url).pathname;
/** Hasil bundel esbuild. Tidak masuk git; `npm run build:web` membuatnya. */
const PUBLIC_ROOT = new URL("../../web/public/", import.meta.url).pathname;
const MIGRATIONS = new URL("../../../packages/db/migrations/", import.meta.url).pathname;
const PORT = Number(process.env["PORT"] ?? 3000);
const HOST = "0.0.0.0"; // wajib: preview mem-proxy dari luar sandbox

const WS_ID = "0190f000-0000-7000-8000-000000000001";
const TEAM = "0190f000-0000-7000-8000-0000000000c1";
const DEMO_USER = "0190f000-0000-7000-8000-0000000000a1";
/**
 * Kredensial demo. HANYA ada di `dev-server` (tidak pernah di paket server),
 * dan hanya dipakai seed lokal. Sebelumnya server menyuntikkan cookie
 * `kelindan_session=demo` ke setiap request, sehingga SELURUH jalur
 * autentikasi tidak pernah dijalankan — login, pencabutan sesi, dan epoch
 * tidak pernah terbukti bekerja. Sekarang demo harus login seperti pengguna.
 */
const DEMO_EMAIL = "demo@kelindan.id";
const DEMO_PASSWORD = "demo-kelindan-2026";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
};

async function seed(client: Awaited<ReturnType<typeof createTestClient>>) {
  const exists = await client.query<{ c: string }>(`SELECT count(*)::text AS c FROM workspaces`);
  if (Number(exists.rows[0]?.c ?? 0) > 0) return;

  await client.query(`INSERT INTO workspaces (id,name,slug,seq_next) VALUES ($1,'Ruang Kerja','ruang-kerja',1)`, [WS_ID]);
  const { hashPassword } = await import("@kelindan/server");
  await client.query(
    `INSERT INTO users (id,email,display_name,password_hash,email_verified_at)
     VALUES ($1,$2,'Demo',$3, now())`,
    [DEMO_USER, DEMO_EMAIL, await hashPassword(DEMO_PASSWORD)],
  );
  await client.query(
    `INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,1)`,
    [uuidv7(), WS_ID, DEMO_USER]);
  await client.query(`INSERT INTO teams (id,workspace_id,name,key) VALUES ($1,$2,'ENG','ENG')`, [TEAM, WS_ID]);

  const statuses: Array<[string, string, number]> = [
    ["d1", "Antrean", 1], ["d2", "Siap", 2], ["d3", "Dikerjakan", 3], ["d4", "Tinjau", 3],
    ["d5", "Selesai", 4], ["d6", "Dibatalkan", 5],
  ];
  for (let i = 0; i < statuses.length; i++) {
    const [suffix, name, cat] = statuses[i]!;
    await client.query(
      `INSERT INTO statuses (id,workspace_id,team_id,name,category,position,is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`0190f000-0000-7000-8000-0000000000${suffix}`, WS_ID, TEAM, name, cat, i, i === 0]);
  }

  const sample = [
    "Perbaiki login SSO yang gagal di Safari",
    "Tambahkan pintasan keyboard untuk pindah kolom",
    "Pisahkan telemetri dari jalur permintaan utama",
    "Tulis ulang panduan onboarding tim",
    "Kurangi waktu muat papan di bawah 200 ms",
    "Tinjau kebijakan retensi log audit",
    "Buat template cuti untuk tim operasi",
  ];
  for (let i = 0; i < sample.length * 4; i++) {
    const st = statuses[i % statuses.length]!;
    await client.query(
      `INSERT INTO tasks (id,workspace_id,team_id,number,title,status_id,created_by,priority,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 || ' minutes')::interval)`,
      [uuidv7(), WS_ID, TEAM, i + 1, `${sample[i % sample.length]} (#${i + 1})`,
       `0190f000-0000-7000-8000-0000000000${st[0]}`, DEMO_USER, i % 5, i]);
  }
}

async function main() {
  const client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, MIGRATIONS);
  await seed(client);

  const deps: AppDeps = {
    /**
     * Repositori sesi SUNGGUHAN. Versi sebelumnya mengembalikan sesi tetap
     * untuk hash apa pun — termasuk hash yang tidak pernah diterbitkan — yang
     * berarti tidak ada satu pun perilaku auth yang diuji oleh demo.
     */
    sessions: dbSessionRepo(client),
    db: async () => client as never,
    async teamRoleOf(_u, ws, teamId) {
      return ws === WS_ID && teamId === TEAM ? TEAM_ROLE.ADMIN : null;
    },
    async teamIdOfTask(ws, taskId) {
      const r = await client.query<{ team_id: string }>(
        `SELECT team_id FROM tasks WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [taskId, ws]);
      return r.rows[0]?.team_id ?? null;
    },
  };

  /**
   * `staticHandler` DIPASANG SEBELUM `createApp`, bukan sesudah.
   *
   * Bug yang diperbaiki: versi sebelumnya membuat `createApp(deps)` lalu
   * menulis `(deps as AppDeps).staticHandler = ...` pada objek asli. Karena
   * `deps` disalin ke objek baru saat ini, penulisan itu tidak pernah terlihat
   * server — sehingga `/` dan `/main.js` menjawab 404 dan UI tidak bisa dibuka
   * sama sekali. Hanya terlihat dengan MENJALANKAN servernya, bukan lewat uji.
   */
  deps.staticHandler = async (_req, res, url) => {
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
    // `/main.js` berasal dari bundel (`public/`), sisanya dari sumber web.
    const filePath = path === "/main.js" ? join(PUBLIC_ROOT, "main.js") : join(WEB_ROOT, safe);
    try {
      const buf = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(safe)] ?? "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("tidak ditemukan");
    }
    return true;
  };

  const app = createApp({
    ...deps,
    auth: {
      db: async () => client as never,
      // Demo berjalan di http://localhost tanpa TLS; cookie `Secure` akan
      // dibuang browser dan login tidak akan pernah "menempel".
      cookieSecure: false,
    },
  });

  /**
   * TIDAK ADA LAGI PENYUNTIKAN SESI. Dulu baris di sini berbunyi:
   * `if (!req.headers.cookie) req.headers.cookie = "kelindan_session=demo"`.
   * Itu membuat demo selalu "berhasil" apa pun keadaan autentikasi, dan
   * menyembunyikan bug nyata — termasuk sesi yang seharusnya sudah dicabut.
   */

  // Real-time: hub menempel pada server HTTP yang sama (satu port, satu origin).
  const hub = new Hub({
    db: async () => client as never,
    teamRoleOf: deps.teamRoleOf,
    /**
     * WebSocket memakai jalur otorisasi yang SAMA dengan HTTP (`resolveAuth`),
     * bukan pemeriksaan `includes("kelindan_session=")` yang menerima token
     * apa pun. Tanpa ini, sesi yang sudah dicabut tetap bisa membuka
     * WebSocket — jalur yang justru paling sulit terlihat.
     */
    auth: async (req) => {
      const resolved = await resolveAuth(
        req.headers.cookie as string | undefined,
        dbSessionRepo(client),
      );
      return resolved ? { userId: resolved.userId, workspaceId: resolved.workspaceId } : null;
    },
  });
  hub.attach(app.server);
  await hub.startListening().catch(() => {
    // PGlite tidak mendukung LISTEN lintas koneksi; demo tetap jalan tanpa
    // fan-out lintas proses, dan itu tercetak supaya tidak tampak seperti sukses.
    console.log(JSON.stringify({ level: "warn", msg: "LISTEN tidak tersedia pada PGlite" }));
  });
  const watcher = new RevocationWatcher({ db: async () => client as never, hub });
  watcher.start();

  const { port } = await app.listen(PORT, HOST);
  console.log(JSON.stringify({ level: "info", msg: "demo siap", port, host: HOST, team: TEAM }));
}

void main();

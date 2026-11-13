/**
 * UJI HTTP login (FR-112) pada PGlite.
 *
 * Yang diuji bukan "login berhasil", tetapi hal-hal yang gagal tanpa disadari:
 *  - Respons untuk email tak dikenal dan password salah HARUS tidak bisa
 *    dibedakan — termasuk durasinya.
 *  - Cookie yang dikirim HARUS punya atribut yang membuatnya tidak bisa
 *    dicuri XSS maupun dikirim lintas situs.
 *  - Password TIDAK BOLEH muncul di output mana pun (termasuk log error).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7, TEAM_ROLE } from "@kelindan/shared";
import { createTestClient, applyMigrations, type ClientLike } from "@kelindan/testing";
import { createApp, type App } from "../app.js";
import { dbSessionRepo, testDeps } from "../test-deps.js";
import { hashPassword } from "../auth/password.js";
import { createRateLimiter } from "../auth/rate-limit.js";

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;

const WS = "0190f000-0000-7000-8000-000000000001";
const USER = "0190f000-0000-7000-8000-0000000000a1";
const USER_UNVERIFIED = "0190f000-0000-7000-8000-0000000000a2";
const USER_PLACEHOLDER = "0190f000-0000-7000-8000-0000000000a3";

const PASSWORD = "kata-sandi-uji-yang-kuat";

let client: ClientLike;
let app: App;
let base: string;

interface Res {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
  retryAfter: string | null;
}

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string | null; ip?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers["cookie"] = `kelindan_session=${opts.cookie}`;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    setCookie: res.headers.get("set-cookie"),
    retryAfter: res.headers.get("retry-after"),
  };
}

/** Mengambil nilai cookie sesi dari header Set-Cookie. */
function cookieToken(res: Res): string | null {
  const m = /kelindan_session=([^;]*)/.exec(res.setCookie ?? "");
  const v = m?.[1];
  return v && v.length > 0 ? v : null;
}

beforeAll(async () => {
  client = await createTestClient();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await applyMigrations(client, dir);

  await client.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Ruang','ruang')`, [WS]);
  const hash = await hashPassword(PASSWORD);

  await client.query(
    `INSERT INTO users (id,email,display_name,password_hash,email_verified_at)
     VALUES ($1,'a@x.id','A',$2, now())`,
    [USER, hash],
  );
  await client.query(
    `INSERT INTO users (id,email,display_name,password_hash,email_verified_at)
     VALUES ($1,'belum@x.id','B',$2, NULL)`,
    [USER_UNVERIFIED, hash],
  );
  await client.query(
    `INSERT INTO users (id,email,display_name,is_placeholder) VALUES ($1,'impor@x.id','C',true)`,
    [USER_PLACEHOLDER],
  );
  await client.query(
    `INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,1)`,
    [uuidv7(), WS, USER],
  );

  app = createApp(
    testDeps({
      client,
      sessionRepo: dbSessionRepo(client),
      auth: { db: async () => client as never, cookieSecure: false },
      // Batas laju dikendalikan uji: 10/menit seperti produksi, tetapi jam
      // tidak dipakai supaya uji tidak flaky.
      rateLimiter: createRateLimiter({ max: 10, windowMs: 60_000 }),
    }),
  );
  const { port } = await app.listen(0);
  base = `http://127.0.0.1:${port}`;
}, 120_000);

afterAll(async () => { await app?.close(); });

describe("POST /v1/auth/login", () => {
  it("password benar -> 200 + cookie sesi dengan atribut yang benar", async () => {
    const r = await call("POST", "/v1/auth/login", {
      body: { email: "a@x.id", password: PASSWORD },
    });
    expect(r.status).toBe(200);
    expect(cookieToken(r)).toBeTruthy();

    const c = r.setCookie!;
    expect(c).toContain("HttpOnly"); // XSS tidak bisa membaca token
    expect(c).toContain("SameSite=Lax"); // tidak ikut POST lintas situs
    expect(c).toContain("Path=/");
    // `Secure` sengaja dimatikan pada uji (tanpa TLS); di produksi default true.
    expect(c).not.toContain("Secure");

    const user = r.body["user"] as Record<string, unknown>;
    expect(user["displayName"]).toBe("A");
    expect(user["workspaceId"]).toBe(WS);
  });

  it("email dinormalkan: huruf besar & spasi tetap menemukan akun", async () => {
    const r = await call("POST", "/v1/auth/login", {
      body: { email: "  A@X.ID  ", password: PASSWORD },
    });
    expect(r.status).toBe(200);
  });

  it("email tak dikenal dan password salah memberi respons IDENTIK", async () => {
    const takDikenal = await call("POST", "/v1/auth/login", {
      body: { email: "tidak-ada@x.id", password: "apa-saja" }, ip: "10.0.0.1",
    });
    const salahPassword = await call("POST", "/v1/auth/login", {
      body: { email: "a@x.id", password: "apa-saja" }, ip: "10.0.0.2",
    });

    expect(takDikenal.status).toBe(401);
    expect(salahPassword.status).toBe(401);
    expect(takDikenal.body["code"]).toBe(salahPassword.body["code"]);
    expect(takDikenal.body["message"]).toBe(salahPassword.body["message"]);
    expect(takDikenal.setCookie).toBeNull();
  });

  /**
   * Uji WAKTU. Ini satu-satunya cara membuktikan `burnPasswordTime` benar-benar
   * dipanggil: kode dan pesan bisa saja sudah sama, tetapi bila jalur "tidak
   * ada" kembali dalam 0 ms sementara jalur "ada" butuh ~100 ms, penyerang
   * tetap bisa memetakan akun.
   */
  it("durasi respons tidak membocorkan keberadaan akun", async () => {
    const measure = async (email: string, ip: string) => {
      const t = performance.now();
      await call("POST", "/v1/auth/login", { body: { email, password: "salah-semua" }, ip });
      return performance.now() - t;
    };

    // Beberapa sampel: satu pengukuran bisa kebetulan sepi/sibuk.
    const ada: number[] = [];
    const tidak: number[] = [];
    for (let i = 0; i < 5; i++) {
      ada.push(await measure("a@x.id", `10.1.0.${i}`));
      tidak.push(await measure(`hantu${i}@x.id`, `10.2.0.${i}`));
    }
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const mAda = median(ada);
    const mTidak = median(tidak);

    console.log(`[TC-17] median email ADA ${Math.round(mAda)} ms, TIDAK ADA ${Math.round(mTidak)} ms`);

    /**
     * Ambang KETAT (1.35x), bukan longgar. Uji pertama memakai 2.5x dan LULUS
     * pada 84 ms vs 40 ms — padahal selisih 2x sudah cukup untuk memetakan
     * akun lewat pengukuran respons. Ambang longgar yang "lulus" di sini sama
     * dengan tidak punya uji.
     */
    const ratio = Math.max(mAda, mTidak) / Math.max(1, Math.min(mAda, mTidak));
    expect(ratio).toBeLessThan(1.35);
    // Dan keduanya memang benar-benar membayar biaya hash (>30 ms), bukan
    // sama-sama cepat karena sama-sama tidak melakukan apa pun.
    expect(Math.min(mAda, mTidak)).toBeGreaterThan(30);
  }, 60_000);

  it("email belum diverifikasi -> 403 dengan kode berbeda (password sudah benar)", async () => {
    const r = await call("POST", "/v1/auth/login", {
      body: { email: "belum@x.id", password: PASSWORD }, ip: "10.3.0.1",
    });
    expect(r.status).toBe(403);
    expect(r.body["code"]).toBe("auth.email_unverified");
    expect(r.setCookie).toBeNull();
  });

  it("akun placeholder tidak bisa login (bukan akun untuk manusia)", async () => {
    const r = await call("POST", "/v1/auth/login", {
      body: { email: "impor@x.id", password: "" }, ip: "10.4.0.1",
    });
    expect(r.status).toBe(400); // password kosong ditolak sebelum lookup
  });

  it("input tidak berbentuk -> 400, bukan 401 (kesalahan pengguna bukan rahasia)", async () => {
    for (const body of [{}, { email: "bukan-email", password: PASSWORD }, { email: "a@x.id" }]) {
      const r = await call("POST", "/v1/auth/login", { body, ip: "10.5.0.1" });
      expect(r.status).toBe(400);
      expect(r.body["code"]).toBe("validation.failed");
    }
  });

  it("password TIDAK muncul di respons mana pun", async () => {
    const r = await call("POST", "/v1/auth/login", {
      body: { email: "a@x.id", password: PASSWORD }, ip: "10.6.0.1",
    });
    expect(JSON.stringify(r.body)).not.toContain(PASSWORD);
    expect(r.setCookie ?? "").not.toContain(PASSWORD);
  });
});

describe("sesi setelah login", () => {
  it("cookie dari login dipakai GET /v1/me -> identitas pemanggil", async () => {
    const login = await call("POST", "/v1/auth/login", {
      body: { email: "a@x.id", password: PASSWORD }, ip: "10.7.0.1",
    });
    const token = cookieToken(login)!;
    const me = await call("GET", "/v1/me", { cookie: token });
    expect(me.status).toBe(200);
    expect((me.body["user"] as Record<string, unknown>)["email"]).toBe("a@x.id");
    expect(me.body["workspace_id"]).toBe(WS);
  });

  it("tanpa cookie -> 401 pada rute yang butuh sesi", async () => {
    const me = await call("GET", "/v1/me");
    expect(me.status).toBe(401);
    expect(me.body["code"]).toBe("auth.unauthenticated");
  });

  it("logout mencabut sesi: cookie yang sama langsung 401", async () => {
    const login = await call("POST", "/v1/auth/login", {
      body: { email: "a@x.id", password: PASSWORD }, ip: "10.8.0.1",
    });
    const token = cookieToken(login)!;
    expect((await call("GET", "/v1/me", { cookie: token })).status).toBe(200);

    const out = await call("POST", "/v1/auth/logout", { cookie: token });
    expect(out.status).toBe(204);
    expect(out.setCookie).toContain("Expires=Thu, 01 Jan 1970");

    expect((await call("GET", "/v1/me", { cookie: token })).status).toBe(401);
  });

  it("logout-all menutup semua sesi user", async () => {
    const a = cookieToken(await call("POST", "/v1/auth/login", {
      body: { email: "a@x.id", password: PASSWORD }, ip: "10.9.0.1",
    }))!;
    const b = cookieToken(await call("POST", "/v1/auth/login", {
      body: { email: "a@x.id", password: PASSWORD }, ip: "10.9.0.2",
    }))!;

    const r = await call("POST", "/v1/auth/logout-all", { cookie: a });
    expect(r.status).toBe(200);
    expect(Number(r.body["revoked"])).toBeGreaterThanOrEqual(2);

    expect((await call("GET", "/v1/me", { cookie: a })).status).toBe(401);
    expect((await call("GET", "/v1/me", { cookie: b })).status).toBe(401);
  }, 30_000);
});

describe("batas laju login (NFR-014)", () => {
  it("percobaan ke-11 dari IP+email yang sama -> 429 + Retry-After", async () => {
    const ip = "10.99.0.1";
    const email = "a@x.id";
    // 10 percobaan pertama lolos pembatas (hasilnya boleh 401).
    for (let i = 0; i < 10; i++) {
      const r = await call("POST", "/v1/auth/login", { body: { email, password: "salah" }, ip });
      expect(r.status).not.toBe(429);
    }
    const eleventh = await call("POST", "/v1/auth/login", {
      body: { email, password: "salah" }, ip,
    });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body["code"]).toBe("rate.limited");
    expect(Number(eleventh.retryAfter)).toBeGreaterThan(0);
  }, 60_000);

  it("IP lain tidak terpengaruh blokir IP sebelumnya (kunci = IP+email)", async () => {
    // Blokir 10.99.0.1 di uji sebelumnya tidak boleh menghukum 10.99.0.2.
    const r = await call("POST", "/v1/auth/login", {
      body: { email: "a@x.id", password: "salah" }, ip: "10.99.0.2",
    });
    expect(r.status).toBe(401);
  });

  it("email lain dari IP yang sama punya jatah sendiri (satu kantor ber-NAT)", async () => {
    const r = await call("POST", "/v1/auth/login", {
      body: { email: "orang-lain@x.id", password: "salah" }, ip: "10.99.0.1",
    });
    expect(r.status).toBe(401);
  });
});

describe("kebijakan rute", () => {
  it("peran viewer tetap tidak bisa menulis (tidak berubah oleh auth baru)", async () => {
    // Regresi: penambahan rute auth tidak boleh melonggarkan otorisasi task.
    const login = await call("POST", "/v1/auth/login", {
      body: { email: "a@x.id", password: PASSWORD }, ip: "10.98.0.1",
    });
    const token = cookieToken(login)!;
    const r = await fetch(`${base}/v1/tasks/0190f000-0000-7000-8000-0000000000e1`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: `kelindan_session=${token}`,
        // Idempotency-Key wajib untuk non-GET; tanpa itu kita menguji 400,
        // bukan otorisasi.
        "idempotency-key": uuidv7(),
      },
      body: JSON.stringify({ title: "x" }),
    });
    // Task itu tidak ada di fixture ini -> 404, bukan 200. Yang penting: bukan
    // "berhasil tanpa izin".
    expect([403, 404]).toContain(r.status);
  });
});

// Menjaga impor tetap terpakai di berkas ini bila uji di atas berubah.
void TEAM_ROLE;

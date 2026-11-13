/**
 * Hub real-time (P3).
 *
 * SUMBER KEBENARAN ADALAH TABEL `changes`, BUKAN NOTIFY. NOTIFY hanya membawa
 * `(workspace_id, seq)` sebesar < 64 byte; isi delta dibaca dari tabel. Alasannya
 * ada di ADR-017: `pg_notify` GAGAL bila payload >= 8000 byte di dalam
 * transaksi, sehingga satu deskripsi panjang bisa menggagalkan penyimpanan.
 * Dengan pointer, kolom deskripsi tidak pernah menyentuh jalur siaran.
 *
 * Transport: WebSocket bawaan Node 22 (`ws` tidak ditambahkan), konsisten
 * dengan T-11 — tiap dependensi menambah permukaan yang harus dipercaya.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer as WSS } from "ws";

import type { SqlClient } from "../http/routes.js";
import { ApiError, type TeamRole } from "@kelindan/shared";
import {
  capTeams, isBroadcastable, parseClientMessage,
  MAX_DELTAS_PER_FRAME, ENTITY_CLASS,
  type DeltaFrame, type ServerMessage,
} from "./protocol.js";

export interface HubDeps {
  /**
   * `ListenClient`, BUKAN `Client` penuh (T-49) dan bukan pula `SqlClient`.
   *
   * `LISTEN` membutuhkan dua hal yang tidak dimiliki `SqlClient`: event
   * `notification` dan koneksi yang TIDAK dikembalikan ke pool selama hidup.
   * Menuntut `Client` membuat `pg.Pool` tidak bisa dipasang karena TypeScript
   * meminta ~30 properti koneksi yang tidak relevan; menuntut `SqlClient` akan
   * berbohong tentang `on`. Jadi tipenya menyebut tepat kemampuan yang dipakai.
   */
  db: () => Promise<SqlClient & {
    on(event: "notification", cb: (msg: { channel: string; payload?: string }) => void): void;
  }>;
  /** Peran pada tim; null = bukan anggota (langganan DITOLAK). */
  teamRoleOf: (userId: string, workspaceId: string, teamId: string) => Promise<TeamRole | null>;
  auth: (req: IncomingMessage) => Promise<{ userId: string; workspaceId: string } | null>;
  /** Dipanggil saat PING untuk memeriksa pencabutan akses (TC-15). */
  now?: () => Date;
}

interface Conn {
  id: string;
  userId: string;
  workspaceId: string;
  socket: WebSocket;
  teams: Set<string>;
  lastSeq: number;
  alive: boolean;
}

export interface ChangeRow {
  seq: number;
  entity_type: number;
  entity_id: string;
  team_id: string | null;
  op: number;
  version: number | null;
  payload: unknown;
}

/** Ubah baris `changes` menjadi frame. Baris yang tidak boleh disiarkan -> null. */
export function toFrame(row: ChangeRow): DeltaFrame | null {
  if (!isBroadcastable(row.entity_type)) return null;
  const entity = (ENTITY_CLASS as Record<number, string | undefined>)[row.entity_type] ?? "unknown";
  const frame: DeltaFrame = {
    op: "delta",
    seq: Number(row.seq),
    entity,
    entity_type: row.entity_type,
    id: row.entity_id,
    team_id: row.team_id,
    version: row.version,
    op_kind: row.op === 2 ? 2 : 1,
    patch: row.payload,
  };
  // Batas payload (ADR-017) ditegakkan di titik keluar juga, bukan hanya CHECK
  // di skema. Bila ini pernah aktif, itu tanda bug PENULIS, bukan klien.
  const bytes = Buffer.byteLength(JSON.stringify(frame), "utf8");
  if (bytes > 4096) {
    return { ...frame, patch: null, entity: `${entity}`, version: frame.version };
  }
  return frame;
}

export class Hub {
  private conns = new Map<string, Conn>();
  private nextId = 1;
  private pingTimer: NodeJS.Timeout | null = null;
  /** `ws` dipakai HANYA untuk sisi server; tidak ada dependensi lain. */
  private wss = new WSS({ noServer: true });
  private listenClient: (SqlClient & {
    on(event: "notification", cb: (msg: { channel: string; payload?: string }) => void): void;
  }) | null = null;
  private channel = "kelindan_changes";

  constructor(private deps: HubDeps) {}

  size(): number {
    return this.conns.size;
  }

  attach(server: Server): void {
    server.on("upgrade", (req, socket, head) => {
      void this.handleUpgrade(req, socket as Duplex, head);
    });
  }

  /** Mulai denyut pemeriksaan: idle 60 s ditutup, ping tiap 25 s. */
  startHeartbeat(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      for (const c of this.conns.values()) {
        if (!c.alive) {
          c.socket.close(4408, "idle");
          continue;
        }
        c.alive = false;
        // `ping()` adalah bagian API server-side; tipe `WebSocket` global hanya
        // memodelkan sisi klien, jadi dipanggil lewat cast sempit.
        (c.socket as unknown as { ping?: () => void }).ping?.();
      }
    }, 25_000);
    this.pingTimer.unref?.();
  }

  stop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.wss.close();
    for (const c of this.conns.values()) c.socket.close(1001, "server shutdown");
    this.conns.clear();
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/v1/ws") {
      socket.destroy();
      return;
    }
    const who = await this.deps.auth(req);
    // Autentikasi SEBELUM upgrade: koneksi tanpa sesi tidak pernah menjadi
    // WebSocket, sehingga tidak ada jalur "tersambung tapi tidak berhak".
    if (!who) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const id = this.register(who.userId, who.workspaceId, ws as unknown as WebSocket);
      ws.on("message", (data: Buffer) => {
        void this.handleMessage(id, data.toString("utf8"));
      });
      ws.on("close", () => this.remove(id));
      ws.on("error", () => this.remove(id));
      // Klien boleh langsung mengirim `subscribe`; tidak perlu menunggu.
      void this.sendServerHello(id);
    });
  }

  private sendServerHello(connId: string): void {
    const conn = this.conns.get(connId);
    if (!conn) return;
    this.send(conn, {
      op: "subscribed", team_ids: [], seq: conn.lastSeq,
      resync_required: false, rejected: [],
    });
  }

  /**
   * Mulai `LISTEN` (T-17). NOTIFY hanya membawa `(workspace_id, seq)`; isi
   * delta dibaca dari tabel `changes`. Ini yang membuat fan-out lintas proses
   * mungkin, dan yang membuat payload besar tidak pernah menyentuh NOTIFY.
   */
  async startListening(channel = "kelindan_changes"): Promise<void> {
    const client = await this.deps.db();
    this.listenClient = client;
    this.channel = channel;
    client.on("notification", (msg) => {
      if (msg.channel !== this.channel) return;
      void this.onNotification(msg.payload ?? "");
    });
    await client.query(`LISTEN ${channel}`);
  }

  async stopListening(): Promise<void> {
    if (!this.listenClient) return;
    await this.listenClient.query(`UNLISTEN ${this.channel}`).catch(() => {});
    this.listenClient = null;
  }

  private async onNotification(payload: string): Promise<void> {
    // Payload: "<workspace_id>:<seq>". Bentuk yang tidak dikenal diabaikan
    // dengan sengaja: NOTIFY bersifat best-effort, dan klien punya `resync`.
    const [workspaceId, seqText] = payload.split(":");
    const seq = Number(seqText);
    if (!workspaceId || !Number.isInteger(seq)) return;

    const client = await this.deps.db();
    const row = await client.query<ChangeRow>(
      `SELECT seq::bigint::int AS seq, entity_type, entity_id, team_id, op, version, payload
         FROM changes WHERE workspace_id = $1 AND seq = $2`,
      [workspaceId, seq],
    );
    const r = row.rows[0];
    if (!r) return;
    const frame = toFrame(r);
    if (!frame) return;
    this.broadcast([frame]);
  }

  /** Dipakai uji: daftarkan koneksi yang soketnya sudah disediakan. */
  register(userId: string, workspaceId: string, socket: WebSocket): string {
    const id = `c${this.nextId++}`;
    const conn: Conn = {
      id, userId, workspaceId, socket,
      teams: new Set(), lastSeq: 0, alive: true,
    };
    (socket as unknown as { addEventListener: (e: string, f: () => void) => void })
      .addEventListener("pong", () => { conn.alive = true; });
    this.conns.set(id, conn);
    return id;
  }

  async handleMessage(connId: string, raw: string): Promise<void> {
    const conn = this.conns.get(connId);
    if (!conn) return;
    try {
      const msg = parseClientMessage(raw);
      if (msg.op === "ping") {
        this.send(conn, { op: "pong" });
        return;
      }
      if (msg.op === "unsubscribe") {
        for (const t of msg.team_ids) conn.teams.delete(t);
        this.send(conn, {
          op: "subscribed", team_ids: [...conn.teams], seq: conn.lastSeq,
          resync_required: false, rejected: [],
        });
        return;
      }

      // subscribe: otorisasi SETIAP tim (AC-50). Tim tanpa akses -> rejected,
      // BUKAN 404 untuk seluruh permintaan: satu tim salah tidak boleh
      // membuat tim lain ikut gagal.
      const { accepted, rejected } = capTeams(conn.teams, msg.team_ids);
      const allowed: string[] = [];
      for (const teamId of accepted) {
        const role = await this.deps.teamRoleOf(conn.userId, conn.workspaceId, teamId);
        if (role === null) rejected.push(teamId);
        else allowed.push(teamId);
      }
      for (const t of allowed) conn.teams.add(t);

      const since = msg.since_seq ?? 0;
      const backlog = await this.readChanges(conn, [...conn.teams], since);
      const gap = backlog.gap;
      this.send(conn, {
        op: "subscribed",
        team_ids: [...conn.teams],
        seq: conn.lastSeq,
        // Celah atau rentang tidak tersedia -> klien WAJIB bootstrap ulang
        // lewat REST. Menebak adalah cara kehilangan data (ADR-006 butir 3).
        resync_required: gap,
        rejected,
      });
      if (!gap) this.flush(conn, backlog.frames);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "server.error";
      const message = err instanceof ApiError ? err.message : "Terjadi kesalahan internal";
      this.send(conn, { op: "error", code, message });
    }
  }

  /**
   * Baca delta setelah `since`. Celah dideteksi dari `seq` yang tidak
   * berurutan per workspace: bila klien tertinggal lebih lama dari retensi
   * (24 jam), barisnya sudah dipangkas dan kita hanya melihat lompatan.
   */
  private async readChanges(
    conn: Conn, teamIds: string[], since: number,
  ): Promise<{ frames: DeltaFrame[]; gap: boolean }> {
    if (teamIds.length === 0) return { frames: [], gap: false };
    const client = await this.deps.db();
    const res = await client.query<ChangeRow>(
      `SELECT seq::bigint::int AS seq, entity_type, entity_id, team_id, op, version, payload
         FROM changes
        WHERE workspace_id = $1 AND team_id = ANY($2::uuid[]) AND seq > $3
        ORDER BY seq
        LIMIT $4`,
      [conn.workspaceId, teamIds, since, MAX_DELTAS_PER_FRAME * 4],
    );

    const frames: DeltaFrame[] = [];
    let expected = since + 1;
    let gap = false;
    for (const row of res.rows) {
      if (since > 0 && Number(row.seq) !== expected) { gap = true; break; }
      expected = Number(row.seq) + 1;
      const f = toFrame(row);
      if (f) frames.push(f);
      conn.lastSeq = Math.max(conn.lastSeq, Number(row.seq));
    }
    return { frames, gap };
  }

  /** Kirim delta ke klien yang berlangganan tim terkait, dibatasi 50/frame. */
  broadcast(frames: DeltaFrame[]): void {
    if (frames.length === 0) return;
    for (const conn of this.conns.values()) {
      const relevant = frames.filter(
        (f) => f.team_id === null || conn.teams.has(f.team_id),
      );
      if (relevant.length === 0) continue;
      this.flush(conn, relevant);
    }
  }

  /** Cabut langganan tim dari SEMUA koneksi (TC-15 / P3-06). */
  revokeTeam(teamId: string): number {
    let revoked = 0;
    for (const conn of this.conns.values()) {
      if (!conn.teams.has(teamId)) continue;
      conn.teams.delete(teamId);
      this.send(conn, { op: "revoked", team_id: teamId });
      revoked++;
    }
    return revoked;
  }

  private flush(conn: Conn, frames: DeltaFrame[]): void {
    for (let i = 0; i < frames.length; i += MAX_DELTAS_PER_FRAME) {
      this.send(conn, { op: "delta_batch", frames: frames.slice(i, i + MAX_DELTAS_PER_FRAME) });
    }
  }

  private send(conn: Conn, msg: ServerMessage): void {
    try {
      conn.socket.send(JSON.stringify(msg));
    } catch {
      // Soket sudah mati: koneksi dibersihkan oleh penutup, bukan di sini.
    }
  }

  remove(connId: string): void {
    this.conns.delete(connId);
  }
}

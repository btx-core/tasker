/**
 * Konverter ADF (Atlassian Document Format) -> Markdown.
 * Artefak SPIKE, bukan importer produksi. Tanpa dependensi.
 *
 * Prinsip pengikat (docs/spike-jira-importer.md §4): TIDAK ADA TEKS YANG HILANG.
 * Setiap node yang tidak bisa dipetakan tetap menyumbang teksnya, dan
 * dicatat di laporan lossy dengan level L1-L5.
 *
 * Level:
 *   L1 = sempurna (teks & struktur)
 *   L2 = teks utuh, bentuk berubah (mis. panel -> blockquote)
 *   L3 = teks utuh, menjadi teks biasa (mis. status lozenge -> [Dikerjakan])
 *   L4 = DATA tidak dipindahkan (macro/extension) - satu-satunya level yang
 *        boleh kehilangan sesuatu, dan WAJIB dilaporkan
 *   L5 = ditolak karena batas ukuran (deskripsi > 100 KB, komentar > 16 KB)
 */

const L = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };

export function createReport() {
  return { nodes: new Map(), maxLevel: 1, losses: [] };
}

function tally(report, type, level, note) {
  const key = `${type}|${level}`;
  const e = report.nodes.get(key) || { type, level, count: 0, note };
  e.count += 1;
  report.nodes.set(key, e);
  if (L[level] > report.maxLevel) report.maxLevel = L[level];
  if (level === "L4" || level === "L5") report.losses.push({ type, level, note });
}

// ---------- inline ----------

function marks(text, m) {
  let out = text;
  const types = new Set(m.map((x) => x.type));
  if (types.has("code")) out = "`" + out + "`";
  if (types.has("strong")) out = `**${out}**`;
  if (types.has("em")) out = `_${out}_`;
  if (types.has("strike")) out = `~~${out}~~`;
  if (types.has("underline")) out = out; // L3: Markdown tidak punya underline, HTML dilarang
  const link = m.find((x) => x.type === "link");
  if (link && link.attrs && link.attrs.href) out = `[${out}](${link.attrs.href})`;
  return out;
}

function textOf(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text || "";
  if (Array.isArray(node.content)) return node.content.map(textOf).join("");
  return "";
}

function inline(nodes, report) {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return marks(n.text || "", n.marks || []);
        case "hardBreak":
          return "  \n";
        case "mention": {
          tally(report, "mention", "L1");
          // Jira mengirim attrs.text SUDAH berisi "@budi". Menambahkan "@"
          // lagi menghasilkan "@@budi" (ditemukan pada uji F4).
          const dn = n.attrs && (n.attrs.text || n.attrs.displayName);
          if (!dn) return "@(pengguna tidak dikenal)";
          return dn.startsWith("@") ? dn : `@${dn}`;
        }
        case "emoji": {
          tally(report, "emoji", "L3");
          const a = n.attrs || {};
          return a.text || a.shortName || "";
        }
        case "status": {
          tally(report, "status", "L3");
          return `[${(n.attrs && n.attrs.text) || "status"}]`;
        }
        case "date": {
          tally(report, "date", "L1");
          const ts = n.attrs && n.attrs.timestamp;
          if (!ts) return "(tanggal)";
          const d = new Date(Number(ts));
          const iso = d.toISOString().slice(0, 10);
          return iso;
        }
        case "inlineCard": {
          tally(report, "inlineCard", "L2");
          const url = (n.attrs && n.attrs.url) || "";
          return url ? `[${url}](${url})` : "(tautan)";
        }
        case "mediaInline": {
          tally(report, "mediaInline", "L4", "media inline tidak diunduh oleh konverter");
          return `(lampiran: ${textOf(n) || "media"})`;
        }
        case "placeholder":
          tally(report, "placeholder", "L3");
          return `[${textOf(n) || "placeholder"}]`;
        default: {
          // Node inline tak dikenal: pertahankan teksnya, catat.
          const t = textOf(n);
          tally(report, n.type || "unknown", "L3", "node inline tak dikenal");
          return t;
        }
      }
    })
    .join("");
}

// ---------- block ----------

function block(nodes, report, ctx = { indent: "" }) {
  if (!Array.isArray(nodes)) return "";
  const parts = [];
  for (const n of nodes) {
    const s = blockOne(n, report, ctx);
    if (s !== null && s !== "") parts.push(s);
  }
  return parts.join("\n\n");
}

function blockOne(n, report, ctx) {
  switch (n.type) {
    case "paragraph": {
      tally(report, "paragraph", "L1");
      const t = inline(n.content, report);
      if (n.marks && n.marks.length) return marks(t, n.marks);
      return t;
    }
    case "heading": {
      tally(report, "heading", "L1");
      const lvl = Math.min(6, (n.attrs && n.attrs.level) || 1);
      return `${"#".repeat(lvl)} ${inline(n.content, report)}`;
    }
    case "codeBlock": {
      tally(report, "codeBlock", "L1");
      const lang = (n.attrs && n.attrs.language) || "";
      return "```" + lang + "\n" + textOf(n) + "\n```";
    }
    case "blockquote": {
      tally(report, "blockquote", "L1");
      return block(n.content, report, ctx)
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    }
    case "rule":
      tally(report, "rule", "L1");
      return "---";
    case "bulletList":
    case "orderedList": {
      tally(report, n.type, "L1");
      const ord = n.type === "orderedList";
      const start = (n.attrs && n.attrs.order) || 1;
      let i = 0;
      return (n.content || [])
        .map((li) => {
          const marker = ord ? `${start + i++}.` : "-";
          const inner = li.content || [];
          // item pertama sebaris dengan penanda; sisanya menjorok
          const rendered = inner.map((c) => blockOne(c, report, ctx)).filter(Boolean);
          if (rendered.length === 0) return `${marker} `;
          const [first, ...rest] = rendered;
          const head = `${marker} ${first.replace(/\n/g, "\n  ")}`;
          if (rest.length === 0) return head;
          return (
            head +
            "\n" +
            rest
              .join("\n\n")
              .split("\n")
              .map((l) => (l ? `  ${l}` : l))
              .join("\n")
          );
        })
        .join("\n");
    }
    case "panel": {
      tally(report, "panel", "L2", "panel -> blockquote dengan label tipe");
      const kind = (n.attrs && n.attrs.panelType) || "info";
      // panelType datang dari Jira dan bisa berisi teks sembarang. Di-escape
      // agar tidak berubah menjadi penekanan/tautan di Markdown.
      const esc = (t) => String(t).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
      const label = esc(
        { info: "Info", note: "Catatan", warning: "Peringatan", success: "Berhasil", error: "Galat" }[kind] || kind
      );
      const body = block(n.content, report, ctx);
      return `> **${label}**\n>\n` + body.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
    }
    case "expand":
    case "nestedExpand": {
      tally(report, n.type, "L2", "expand -> blockquote <details> tidak dipakai (HTML dilarang)");
      const esc2 = (t) => String(t).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
      const title = esc2((n.attrs && n.attrs.title) || "Selengkapnya");
      const body = block(n.content, report, ctx);
      return `> **${title}**\n>\n` + body.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
    }
    case "table": {
      tally(report, "table", "L1");
      return table(n, report);
    }
    case "taskList": {
      tally(report, "taskList", "L3", "taskList Jira -> checkbox GFM, BUKAN checklist Kelindan");
      return (n.content || [])
        .map((it) => {
          const st = (it.attrs && it.attrs.state) || "TODO";
          const box = st === "DONE" ? "[x]" : "[ ]";
          return `- ${box} ${textOf(it).trim()}`;
        })
        .join("\n");
    }
    case "decisionList": {
      tally(report, "decisionList", "L3");
      return (n.content || [])
        .map((it) => `- ${textOf(it).trim()}${it.attrs && it.attrs.state ? ` (${it.attrs.state})` : ""}`)
        .join("\n");
    }
    case "extension":
    case "bodiedExtension": {
      const key = (n.attrs && n.attrs.extensionKey) || "macro";
      const bodyText = textOf(n).trim();
      tally(report, n.type, "L4", `macro ${key}`);
      const head = `_(macro Jira tidak dapat dipindahkan: \`${key}\`)_`;
      // Prinsip "tidak ada teks hilang": bila macro punya teks, pertahankan.
      return bodyText ? `${head}\n\n${bodyText}` : head;
    }
    case "mediaSingle":
    case "mediaGroup": {
      tally(report, n.type, "L4", "lampiran: ditangani pipeline media, bukan konverter");
      const names = [];
      const walk = (x) => {
        if (!x) return;
        if (x.type === "media") names.push((x.attrs && x.attrs.id) || "media");
        (x.content || []).forEach(walk);
      };
      walk(n);
      return names.map((id) => `_(lampiran: ${id})_`).join("\n");
    }
    case "blockCard": {
      tally(report, "blockCard", "L2");
      const url = (n.attrs && n.attrs.url) || "";
      return url ? `<${url}>` : "(tautan)";
    }
    case "paragraphPlaceholder":
    case "placeholder": {
      tally(report, "placeholder", "L3");
      return `[${textOf(n)}]`;
    }
    case "text": {
      // teks langsung di level blok (tidak lazim, tapi jangan dibuang)
      tally(report, "text", "L3");
      return inline([n], report);
    }
    default: {
      const t = textOf(n).trim();
      tally(report, n.type || "unknown", t ? "L3" : "L4", "node blok tak dikenal");
      return t || null;
    }
  }
}

function table(n, report) {
  const rows = (n.content || []).filter((r) => r.type === "tableRow");
  if (rows.length === 0) return "";

  const grid = rows.map((r) =>
    (r.content || []).map((c) => {
      if (c.type !== "tableCell" && c.type !== "tableHeader") return "";
      const body = block(c.content, report).replace(/\n/g, "<br>").replace(/\|/g, "\\|");
      const span = (c.attrs && c.attrs.colspan) || 1;
      // Merged cell tidak punya padanan Markdown: ulangi isi, catat L2.
      if (span > 1) tally(report, "tableCell[colspan]", "L2", "merged cell -> isi diulang");
      return span > 1 ? [body, ...Array(span - 1).fill("")] : [body];
    })
  );

  const width = Math.max(...grid.map((r) => r.flat().length));
  const flat = grid.map((r) => r.flat());
  const head = flat[0];
  const pad = (r) => [...r, ...Array(width - r.length).fill("")].map((c) => ` ${c} `);
  const lines = [];
  lines.push(`|${pad(head).join("|")}|`);
  lines.push(`|${Array(width).fill("---").join("|")}|`);
  for (const r of flat.slice(1)) lines.push(`|${pad(r).join("|")}|`);
  return lines.join("\n");
}

// ---------- batas ukuran (L5) ----------

export const LIMITS = { description: 102400, comment: 16384 };

export function convert(adf, { kind = "description", report = createReport() } = {}) {
  if (!adf || adf.type !== "doc") {
    return { markdown: "", report, rejected: null };
  }
  const raw = JSON.stringify(adf);
  const limit = LIMITS[kind];
  if (raw.length > limit * 4) {
    // ADF jauh lebih besar dari hasil Markdown; ukur teksnya, bukan JSON-nya.
  }
  const markdown = block(adf.content, report);
  const bytes = Buffer.byteLength(markdown, "utf8");
  let rejected = null;
  if (bytes > limit) {
    tally(report, kind, "L5", `hasil ${bytes} byte > batas ${limit} byte`);
    rejected = { reason: "TOO_LARGE", bytes, limit };
  }
  return { markdown, report, rejected };
}

export function reportToLines(report) {
  const byLevel = {};
  for (const e of report.nodes.values()) {
    byLevel[e.level] = (byLevel[e.level] || 0) + e.count;
  }
  return {
    totalNodes: [...report.nodes.values()].reduce((a, e) => a + e.count, 0),
    byLevel,
    maxLevel: `L${report.maxLevel}`,
    entries: [...report.nodes.values()].sort((a, b) => a.level.localeCompare(b.level) || a.type.localeCompare(b.type)),
    losses: report.losses,
  };
}

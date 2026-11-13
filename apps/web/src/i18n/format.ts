/**
 * SATU-SATUNYA modul format tanggal/angka (i18n.md §3, T-I18N3).
 *
 * Aturan pengikat: komponen TIDAK BOLEH merangkai tanggal sendiri
 * (`getDate()` + "/" + ...). Itu selalu salah di satu zona waktu, dan
 * kesalahannya baru terlihat setelah ada pengguna di zona lain.
 */
export type Locale = "id-ID" | "en-US";
export type TimeZone = "Asia/Jakarta" | "Asia/Tokyo" | "UTC";

let current: { locale: Locale; timeZone: TimeZone } = {
  locale: "id-ID",
  timeZone: "Asia/Jakarta",
};

export function setFormatContext(locale: Locale, timeZone: TimeZone): void {
  current = { locale, timeZone };
}

export function getFormatContext(): { locale: Locale; timeZone: TimeZone } {
  return current;
}

export function formatDate(iso: string | null): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(current.locale, {
    day: "2-digit", month: "short", timeZone: current.timeZone,
  }).format(d);
}

/** "3 hari lagi" / "2 jam lalu". Angka TIDAK diformat manual. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = then - now.getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(current.locale, { numeric: "auto" });
  const table: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000], ["second", 1000],
  ];
  for (const [unit, ms] of table) {
    if (abs >= ms || unit === "second") {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }
  return rtf.format(0, "second");
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(current.locale).format(n);
}

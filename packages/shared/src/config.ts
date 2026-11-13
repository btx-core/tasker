/**
 * Konfigurasi dari environment. Aturan (repo-layout.md §5.1):
 *  1. fail fast di boot dengan pesan yang bisa ditindaklanjuti
 *  2. TIDAK ADA default untuk rahasia
 *  3. satu sumber, divalidasi skema yang sama
 */
export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  sessionSecret: string;
  appUrl: string;
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  storageDriver: "filesystem" | "s3";
  emailMode: "none" | "smtp" | "relay";
}

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super("Konfigurasi tidak valid:\n  - " + problems.join("\n  - "));
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const SECRET_MIN = 32;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const problems: string[] = [];

  const req = (name: string): string => {
    const v = env[name];
    if (v === undefined || v.trim() === "") {
      problems.push(`${name} wajib diisi (lihat .env.example)`);
      return "";
    }
    return v;
  };

  const databaseUrl = req("DATABASE_URL");
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push("DATABASE_URL harus berawalan postgres:// atau postgresql://");
  }

  // Rahasia TIDAK PERNAH punya default: default rahasia adalah cara paling
  // umum aplikasi self-host dibobol.
  const sessionSecret = req("SESSION_SECRET");
  if (sessionSecret && Buffer.byteLength(sessionSecret) < SECRET_MIN) {
    problems.push(`SESSION_SECRET minimal ${SECRET_MIN} byte (sekarang ${Buffer.byteLength(sessionSecret)})`);
  }
  if (sessionSecret === "ganti-dengan-32-byte-acak-jangan-pakai-ini") {
    problems.push("SESSION_SECRET masih nilai contoh dari .env.example - ganti dengan acak");
  }

  const appUrl = req("APP_URL");
  if (appUrl && !/^https?:\/\//.test(appUrl)) problems.push("APP_URL harus http(s)://...");

  const nodeEnvRaw = req("NODE_ENV");
  if (nodeEnvRaw && !["development", "test", "production"].includes(nodeEnvRaw)) {
    problems.push("NODE_ENV harus development|test|production");
  }

  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("PORT harus 1..65535");

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv: nodeEnvRaw as AppConfig["nodeEnv"],
    databaseUrl,
    sessionSecret,
    appUrl,
    port,
    logLevel: (env.LOG_LEVEL as AppConfig["logLevel"]) ?? "info",
    storageDriver: (env.STORAGE_DRIVER as AppConfig["storageDriver"]) ?? "filesystem",
    emailMode: (env.EMAIL_MODE as AppConfig["emailMode"]) ?? "none",
  };
}

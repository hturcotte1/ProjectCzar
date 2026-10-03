import path from 'node:path';

/**
 * All settings come from environment variables. Every variable is documented in
 * `.env.example`. Nothing secret is ever logged.
 */
export interface Config {
  env: 'production' | 'development' | 'test';
  port: number;
  host: string;
  baseUrl: string;
  dataDir: string;
  databasePath: string;
  backupDir: string;
  /** How many proxy hops in front of Tempo to trust for the client address (false = none). */
  trustProxy: false | number;
  secureCookies: boolean;

  anthropicApiKey: string | null;
  conductorModel: string;
  conductorEffort: 'low' | 'medium' | 'high';
  conductorMonthlyBudgetUsd: number;
  conductorMaxRunsPerHour: number;
  conductorPriceInputPerMTok: number | null;
  conductorPriceOutputPerMTok: number | null;
  standInModel: string;

  cardTokenBudget: number;
  maxOpenInstructionsPerAgent: number;
  agentRateLimitPerMinute: number;
  agentBodyLimitBytes: number;
  schedulerTickSeconds: number;
  cardTimeoutMinutes: number;
  defaultTimezone: string;

  smtp: {
    host: string;
    port: number;
    user: string | null;
    pass: string | null;
    from: string;
    secure: boolean;
  } | null;
  ntfy: {
    server: string;
    token: string | null;
  };

  backupKeep: number;
  logLevel: string;
}

function num(v: string | undefined, d: number): number {
  if (v === undefined || v.trim() === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function bool(v: string | undefined, d: boolean): boolean {
  if (v === undefined || v.trim() === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

/**
 * TRUST_PROXY: how many proxies sit in front of Tempo. Only that many entries at the end of
 * X-Forwarded-For are believed, so a client cannot pick its own address by sending the header.
 * "true" means one proxy (Railway and Fly each add exactly one); "false" or "0" means none.
 */
function proxyHops(v: string | undefined, d: false | number): false | number {
  if (v === undefined || v.trim() === '') return d;
  const t = v.trim().toLowerCase();
  if (['true', 'yes', 'on'].includes(t)) return 1;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 5) : false;
}

function str(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const nodeEnv = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const port = num(env.PORT, 3000);
  const dataDir = path.resolve(str(env.DATA_DIR) ?? (nodeEnv === 'production' ? '/data' : './data'));
  const baseUrl = (str(env.BASE_URL) ?? `http://localhost:${port}`).replace(/\/+$/, '');
  const effort = str(env.CONDUCTOR_EFFORT);
  const smtpHost = str(env.SMTP_HOST);

  const config: Config = {
    env: nodeEnv,
    port,
    host: str(env.HOST) ?? '0.0.0.0',
    baseUrl,
    dataDir,
    databasePath: path.resolve(str(env.DATABASE_PATH) ?? path.join(dataDir, 'tempo.db')),
    backupDir: path.resolve(str(env.BACKUP_DIR) ?? path.join(dataDir, 'backups')),
    trustProxy: proxyHops(env.TRUST_PROXY, nodeEnv === 'production' ? 1 : false),
    secureCookies: bool(env.SECURE_COOKIES, baseUrl.startsWith('https://')),

    anthropicApiKey: str(env.ANTHROPIC_API_KEY),
    conductorModel: str(env.CONDUCTOR_MODEL) ?? 'claude-sonnet-5-5',
    conductorEffort: effort === 'low' || effort === 'high' ? effort : 'medium',
    conductorMonthlyBudgetUsd: num(env.CONDUCTOR_MONTHLY_BUDGET_USD, 15),
    conductorMaxRunsPerHour: num(env.CONDUCTOR_MAX_RUNS_PER_HOUR, 12),
    conductorPriceInputPerMTok: str(env.CONDUCTOR_PRICE_INPUT_PER_MTOK) ? num(env.CONDUCTOR_PRICE_INPUT_PER_MTOK, 0) : null,
    conductorPriceOutputPerMTok: str(env.CONDUCTOR_PRICE_OUTPUT_PER_MTOK) ? num(env.CONDUCTOR_PRICE_OUTPUT_PER_MTOK, 0) : null,
    standInModel: str(env.STAND_IN_MODEL) ?? 'claude-haiku-4-5',

    cardTokenBudget: num(env.CARD_TOKEN_BUDGET, 1500),
    maxOpenInstructionsPerAgent: num(env.MAX_OPEN_INSTRUCTIONS_PER_AGENT, 3),
    agentRateLimitPerMinute: num(env.AGENT_RATE_LIMIT_PER_MINUTE, 60),
    agentBodyLimitBytes: num(env.AGENT_BODY_LIMIT_BYTES, 64 * 1024),
    schedulerTickSeconds: num(env.SCHEDULER_TICK_SECONDS, 30),
    cardTimeoutMinutes: num(env.CARD_TIMEOUT_MINUTES, 20),
    defaultTimezone: str(env.DEFAULT_TIMEZONE) ?? 'America/Boise',

    smtp: smtpHost
      ? {
          host: smtpHost,
          port: num(env.SMTP_PORT, 587),
          user: str(env.SMTP_USER),
          pass: str(env.SMTP_PASS),
          from: str(env.SMTP_FROM) ?? 'Tempo <tempo@localhost>',
          secure: bool(env.SMTP_SECURE, num(env.SMTP_PORT, 587) === 465),
        }
      : null,
    ntfy: {
      server: (str(env.NTFY_SERVER) ?? 'https://ntfy.sh').replace(/\/+$/, ''),
      token: str(env.NTFY_TOKEN),
    },

    backupKeep: num(env.BACKUP_KEEP, 7),
    logLevel: str(env.LOG_LEVEL) ?? (nodeEnv === 'test' ? 'silent' : 'info'),
  };
  return { ...config, ...overrides };
}

/** Loads a .env file from the working folder if there is one (real environment variables win). */
export function loadDotEnvIfPresent(file = '.env'): void {
  try {
    const fs = process.getBuiltinModule('node:fs');
    if (fs.existsSync(file)) process.loadEnvFile(file);
  } catch {
    /* an unreadable .env is ignored; settings then come from the environment */
  }
}

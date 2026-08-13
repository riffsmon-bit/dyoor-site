import { config as loadDotEnv } from "dotenv";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";

loadDotEnv({ quiet: true });

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord numeric ID");
const optionalUrl = z.union([z.literal(""), z.url()]).default("");

function fallbackWhenMissing(value: unknown, fallback: () => unknown) {
  return value === undefined || value === null || value === "" ? fallback() : value;
}

function railwayVerificationBaseUrl() {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (!domain) return undefined;
  const hostname = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${hostname}/verify`;
}

function railwayDatabasePath() {
  const mountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  return mountPath ? resolve(mountPath, "dyoor-discord.db") : undefined;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DISCORD_BOT_TOKEN: z.string().min(40, "is missing or too short"),
  DISCORD_CLIENT_ID: snowflake.default(dyoorDiscordConfig.expected.applicationId),
  DISCORD_GUILD_ID: snowflake.default(dyoorDiscordConfig.expected.guildId),
  DISCORD_OWNER_ID: snowflake.default(dyoorDiscordConfig.expected.ownerId),
  MONAD_RPC_URL: z.url().default("https://rpc.monad.xyz"),
  ROBINHOOD_RPC_URL: z.url().default("https://rpc.mainnet.chain.robinhood.com"),
  WEBSITE_URL: optionalUrl.default("https://dyoor.xyz"),
  X_URL: optionalUrl,
  MARKETPLACE_URL: optionalUrl,
  VERIFICATION_BASE_URL: z.preprocess(
    (value) => fallbackWhenMissing(value, railwayVerificationBaseUrl),
    optionalUrl,
  ),
  OFFICIAL_DOMAINS: z.string().default(dyoorDiscordConfig.officialDomains.join(",")),
  HOLDER_RECHECK_INTERVAL_HOURS: z.coerce
    .number()
    .positive()
    .default(dyoorDiscordConfig.sync.recheckIntervalHours),
  HOLDER_GRACE_PERIOD_HOURS: z.coerce
    .number()
    .positive()
    .default(dyoorDiscordConfig.sync.gracePeriodHours),
  HOLDER_SYNC_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(dyoorDiscordConfig.sync.concurrency),
  RPC_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(dyoorDiscordConfig.sync.rpcTimeoutMs),
  DATABASE_PATH: z.preprocess(
    (value) => fallbackWhenMissing(value, railwayDatabasePath),
    z.string().default("database/dyoor-discord.db"),
  ),
  HTTP_HOST: z.preprocess(
    (value) =>
      fallbackWhenMissing(value, () => (process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : undefined)),
    z.string().default("127.0.0.1"),
  ),
  HTTP_PORT: z.preprocess(
    (value) => fallbackWhenMissing(value, () => process.env.PORT),
    z.coerce.number().int().min(1).max(65_535).default(3100),
  ),
  SESSION_HMAC_SECRET: z.string().min(32).optional(),
  OPENSEA_API_KEY: z.string().default(""),
  OPENSEA_API_BASE_URL: z.url().default("https://api.opensea.io"),
  SALES_CHANNEL_ID: snowflake.default("1475119645743648789"),
  SALES_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(120),
});

export type AppEnv = z.infer<typeof envSchema>;

const setupHelp: Record<string, string> = {
  DISCORD_BOT_TOKEN:
    "Put the existing DYØØR bot token in the repository root .env.local. Never paste it into chat or commit it.",
  DISCORD_CLIENT_ID: "The existing DYØØR application ID must remain 1488722061038715101.",
  DISCORD_GUILD_ID: "The official DYØØR guild ID must remain 1462783318004338837.",
  DISCORD_OWNER_ID: "The configured owner must match the live Discord guild owner.",
  MONAD_RPC_URL: "Set a trusted Monad Mainnet RPC endpoint.",
  ROBINHOOD_RPC_URL: "Set a trusted Robinhood Chain mainnet RPC endpoint.",
};

let cachedEnv: AppEnv | undefined;

function validateProductionRuntime(env: AppEnv) {
  if (env.NODE_ENV !== "production") return;
  if (!env.SESSION_HMAC_SECRET) {
    throw new Error("SESSION_HMAC_SECRET is required in production.");
  }
  if (!env.VERIFICATION_BASE_URL) {
    throw new Error("VERIFICATION_BASE_URL is required in production.");
  }
  const verificationUrl = new URL(env.VERIFICATION_BASE_URL);
  if (
    verificationUrl.protocol !== "https:" ||
    verificationUrl.pathname.replace(/\/$/, "") !== "/verify"
  ) {
    throw new Error("Production VERIFICATION_BASE_URL must be HTTPS and end in /verify.");
  }
  if (!env.OPENSEA_API_KEY) {
    throw new Error("OPENSEA_API_KEY is required for the production sales feed.");
  }
  if (!process.env.RAILWAY_ENVIRONMENT) return;

  const mountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (!mountPath) {
    throw new Error("Railway production requires a persistent volume mount.");
  }
  const relativeDatabasePath = relative(resolve(mountPath), resolve(env.DATABASE_PATH));
  if (relativeDatabasePath.startsWith("..") || isAbsolute(relativeDatabasePath)) {
    throw new Error("Railway DATABASE_PATH must remain inside the persistent volume.");
  }
  if (env.HTTP_HOST !== "0.0.0.0" && env.HTTP_HOST !== "::") {
    throw new Error("Railway HTTP_HOST must bind to 0.0.0.0 or ::.");
  }
}

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = String(issue?.path[0] ?? "environment");
    const guidance =
      setupHelp[key] ?? "Correct this value in .env.local and run the command again.";
    throw new Error(`${key} ${issue?.message ?? "is invalid"}.\n\n${guidance}`);
  }
  const env = parsed.data;
  const expected = dyoorDiscordConfig.expected;
  if (env.DISCORD_CLIENT_ID !== expected.applicationId) {
    throw new Error(
      `Refusing application ${env.DISCORD_CLIENT_ID}; expected ${expected.applicationId}.`,
    );
  }
  if (env.DISCORD_GUILD_ID !== expected.guildId) {
    throw new Error(`Refusing guild ${env.DISCORD_GUILD_ID}; expected ${expected.guildId}.`);
  }
  if (env.DISCORD_OWNER_ID !== expected.ownerId) {
    throw new Error(`Refusing owner ${env.DISCORD_OWNER_ID}; expected ${expected.ownerId}.`);
  }
  validateProductionRuntime(env);
  cachedEnv = env;
  return env;
}

export function resetEnvForTests(): void {
  cachedEnv = undefined;
}

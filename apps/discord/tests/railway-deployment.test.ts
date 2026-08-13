import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvForTests } from "../src/config/env.js";
import { snapshotStorageRoot } from "../src/discord/snapshot.js";

const environmentKeys = [
  "NODE_ENV",
  "DISCORD_BOT_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "DISCORD_OWNER_ID",
  "SESSION_HMAC_SECRET",
  "OPENSEA_API_KEY",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PUBLIC_DOMAIN",
  "RAILWAY_VOLUME_MOUNT_PATH",
  "PORT",
  "VERIFICATION_BASE_URL",
  "DATABASE_PATH",
  "HTTP_HOST",
  "HTTP_PORT",
] as const;

const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]] as const));

function restoreEnvironment() {
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTests();
}

afterEach(restoreEnvironment);

function configureRailwayEnvironment() {
  for (const key of environmentKeys) delete process.env[key];
  process.env.NODE_ENV = "production";
  process.env.DISCORD_BOT_TOKEN = "test-only-token-".padEnd(64, "x");
  process.env.SESSION_HMAC_SECRET = "test-only-session-secret-".padEnd(64, "x");
  process.env.OPENSEA_API_KEY = "test-only-opensea-key";
  process.env.RAILWAY_ENVIRONMENT = "production";
  process.env.RAILWAY_PUBLIC_DOMAIN = "dyoor-discord-production.up.railway.app";
  process.env.RAILWAY_VOLUME_MOUNT_PATH = "/data";
  process.env.PORT = "4567";
  resetEnvForTests();
}

describe("Railway production packaging", () => {
  it("derives safe runtime paths and URLs from Railway-provided variables", () => {
    configureRailwayEnvironment();
    const env = getEnv();

    expect(env.VERIFICATION_BASE_URL).toBe(
      "https://dyoor-discord-production.up.railway.app/verify",
    );
    expect(env.DATABASE_PATH).toBe(resolve("/data", "dyoor-discord.db"));
    expect(env.HTTP_HOST).toBe("0.0.0.0");
    expect(env.HTTP_PORT).toBe(4567);
    expect(snapshotStorageRoot()).toBe("/data");
  });

  it("keeps explicit runtime overrides authoritative", () => {
    configureRailwayEnvironment();
    process.env.VERIFICATION_BASE_URL = "https://verify.dyoor.xyz/verify";
    process.env.DATABASE_PATH = "/data/custom-dyoor.db";
    process.env.HTTP_HOST = "::";
    process.env.HTTP_PORT = "8080";
    resetEnvForTests();

    const env = getEnv();
    expect(env.VERIFICATION_BASE_URL).toBe("https://verify.dyoor.xyz/verify");
    expect(env.DATABASE_PATH).toBe("/data/custom-dyoor.db");
    expect(env.HTTP_HOST).toBe("::");
    expect(env.HTTP_PORT).toBe(8080);
  });

  it("refuses Railway production without a persistent volume", () => {
    configureRailwayEnvironment();
    delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
    resetEnvForTests();

    expect(() => getEnv()).toThrow("persistent volume mount");
  });

  it("refuses production without an HTTPS verification domain", () => {
    configureRailwayEnvironment();
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    resetEnvForTests();

    expect(() => getEnv()).toThrow("VERIFICATION_BASE_URL is required");
  });

  it("pins one replica, a health check, and the required persistent volume", () => {
    const railway = JSON.parse(readFileSync("railway.json", "utf8")) as {
      build: Record<string, unknown>;
      deploy: Record<string, unknown>;
    };
    expect(railway.build).toMatchObject({
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    });
    expect(railway.deploy).toMatchObject({
      numReplicas: 1,
      healthcheckPath: "/health",
      restartPolicyType: "ALWAYS",
      requiredMountPath: "/data",
    });
  });

  it("builds without local secrets and drops privileges before Node starts", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const entrypoint = readFileSync("docker-entrypoint.sh", "utf8");

    expect(dockerfile).toContain("FROM node:${NODE_VERSION}-bookworm-slim AS runtime");
    expect(dockerfile).toContain("COPY scripts ./scripts");
    expect(dockerfile).toContain('CMD ["node", "dist/src/index.js"]');
    expect(dockerfile).not.toContain("DISCORD_BOT_TOKEN");
    expect(dockerfile).not.toContain(".env.local");
    expect(entrypoint).toContain('exec gosu node "$@"');
    expect(entrypoint).toContain("RAILWAY_VOLUME_MOUNT_PATH");
  });
});

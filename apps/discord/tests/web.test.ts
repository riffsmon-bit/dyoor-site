import { getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConnection } from "../src/database/database.js";
import { VerificationRepository } from "../src/verification/repository.js";
import type { VerificationService } from "../src/verification/service.js";
import { buildVerificationServer } from "../src/web/server.js";
import { ids, testDatabase, testEnv } from "./helpers.js";

const wallet = getAddress("0x1111111111111111111111111111111111111111");
const evaluation = {
  dyoorified: true as const,
  season1Holder: true,
  ascended: false,
  season2Holder: true,
  hoodYoorHolder: false,
  rpcUncertain: [],
};
const openDatabases: DatabaseConnection[] = [];

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

async function setup() {
  const database = testDatabase();
  openDatabases.push(database);
  const repository = new VerificationRepository(database);
  const prepare = vi.fn((_token: string, submittedWallet: string) => ({
    message: "canonical SIWE message",
    chainId: 143,
    wallet: getAddress(submittedWallet),
  }));
  const complete = vi.fn(async () => ({
    discordUserId: ids.user,
    walletAddress: wallet,
    evaluation,
  }));
  const onVerified = vi.fn(async () => undefined);
  const service = { prepare, complete } as unknown as Pick<
    VerificationService,
    "prepare" | "complete"
  >;
  const web = await buildVerificationServer({
    env: testEnv(),
    repository,
    service,
    onVerified,
  });
  return { web, repository, prepare, complete, onVerified };
}

describe("wallet-verification web boundary", () => {
  it("exposes a hardened health check", async () => {
    const { web } = await setup();
    const response = await web.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "dyoor-wallet-verification" });
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    await web.close();
  });

  it("moves the random query token into a signed HttpOnly cookie", async () => {
    const { web, repository } = await setup();
    const session = repository.createSession(ids.user, ids.guild);
    const response = await web.inject({ method: "GET", url: `/verify?session=${session.token}` });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/verify/");
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toContain("dyoor_verification=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(response.headers.location).not.toContain(session.token);
    await web.close();
  });

  it("rejects preparation without a Discord-created session", async () => {
    const { web, prepare } = await setup();
    const response = await web.inject({
      method: "POST",
      url: "/api/verification/prepare",
      payload: { walletAddress: wallet, chainId: 143 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("invalid or expired");
    expect(prepare).not.toHaveBeenCalled();
    await web.close();
  });

  it("invokes Discord role sync only after signature completion", async () => {
    const { web, repository, complete, onVerified } = await setup();
    const session = repository.createSession(ids.user, ids.guild);
    const landing = await web.inject({ method: "GET", url: `/verify?session=${session.token}` });
    const cookie = String(landing.headers["set-cookie"]).split(";", 1)[0]!;
    const signature = `0x${"11".repeat(65)}`;
    const response = await web.inject({
      method: "POST",
      url: "/api/verification/complete",
      headers: { cookie },
      payload: { signature },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ verified: true, roles: evaluation });
    expect(complete).toHaveBeenCalledWith(session.token, signature);
    expect(onVerified).toHaveBeenCalledWith(
      expect.objectContaining({ discordUserId: ids.user, evaluation }),
    );
    await web.close();
  });
});

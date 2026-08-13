import { describe, expect, it } from "vitest";

const legacyRoutes = [
  "discord-login-start",
  "discord-oauth-callback",
  "discord-verify-nonce",
  "discord-verify-submit",
  "discord-refresh",
  "discord-status",
  "discord-hourly-sync",
];

describe("retired insecure Discord verifier", () => {
  it("fails every unsigned-cookie legacy entrypoint closed", async () => {
    for (const name of legacyRoutes) {
      const module = (await import(`../../../netlify/functions/${name}.js`)) as {
        handler: () => Promise<{ statusCode: number; body: string }>;
      };
      const response = await module.handler();
      expect(response.statusCode, name).toBe(410);
      expect(JSON.parse(response.body).error).toContain(
        "legacy Discord verification route is disabled",
      );
    }
  });
});

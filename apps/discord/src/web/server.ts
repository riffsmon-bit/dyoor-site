import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import type { VerificationRepository } from "../verification/repository.js";
import type { VerificationService, VerificationSuccess } from "../verification/service.js";

const walletBody = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.number().int().positive(),
});
const signatureBody = z.object({
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .max(2048),
});
const cookieName = "dyoor_verification";

export interface VerificationWebOptions {
  env: AppEnv;
  repository: VerificationRepository;
  service: Pick<VerificationService, "prepare" | "complete">;
  onVerified: (result: VerificationSuccess) => Promise<void>;
}

function userError(error: unknown) {
  if (!(error instanceof Error)) return "Verification could not be completed.";
  const safeMessages = [
    "invalid or expired",
    "already been used",
    "already bound",
    "already connected",
    "already associated",
    "signature",
    "does not currently own",
    "blockchain provider",
    "disabled until",
    "requires an HTTPS",
    "Wrong network",
    "could not be validated",
  ];
  return safeMessages.some((fragment) => error.message.includes(fragment))
    ? error.message
    : "Verification could not be completed. Your Discord roles have not changed.";
}

export async function buildVerificationServer(options: VerificationWebOptions) {
  const { env, repository, service } = options;
  if (!env.SESSION_HMAC_SECRET)
    throw new Error("SESSION_HMAC_SECRET is required to start verification");
  const app = Fastify({
    logger: false,
    trustProxy: env.NODE_ENV === "production",
    bodyLimit: 16 * 1024,
  });

  await app.register(cookie, { secret: env.SESSION_HMAC_SECRET });
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), "src/web/public"),
    prefix: "/verify/",
    decorateReply: true,
    cacheControl: false,
  });

  const tokenFromCookie = (cookieValue: string | undefined) => {
    if (!cookieValue) throw new Error("Verification link is invalid or expired.");
    const unsigned = app.unsignCookie(cookieValue);
    if (!unsigned.valid || !unsigned.value)
      throw new Error("Verification link is invalid or expired.");
    return unsigned.value;
  };

  app.get("/health", () => ({ status: "ok", service: "dyoor-wallet-verification" }));

  app.get<{ Querystring: { session?: string } }>("/verify", async (request, reply) => {
    const token = String(request.query.session ?? "");
    const session = token ? repository.getByToken(token) : null;
    if (!session || session.status === "EXPIRED" || session.consumedAt) {
      return reply
        .code(410)
        .type("text/plain")
        .send("This verification link is invalid or expired.");
    }
    reply.setCookie(cookieName, token, {
      path: "/",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      signed: true,
      maxAge: 10 * 60,
    });
    return reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .redirect("/verify/");
  });

  app.post(
    "/api/verification/prepare",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      try {
        const token = tokenFromCookie(request.cookies[cookieName]);
        const body = walletBody.parse(request.body);
        const result = service.prepare(token, body.walletAddress, body.chainId);
        return reply.header("Cache-Control", "no-store").send({
          message: result.message,
          chainId: result.chainId,
          network: "Monad Mainnet",
        });
      } catch (error) {
        return reply.code(400).send({ error: userError(error) });
      }
    },
  );

  app.post(
    "/api/verification/complete",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      try {
        const token = tokenFromCookie(request.cookies[cookieName]);
        const body = signatureBody.parse(request.body);
        const result = await service.complete(token, body.signature);
        await options.onVerified(result);
        reply.clearCookie(cookieName, { path: "/" });
        return reply.header("Cache-Control", "no-store").send({
          verified: true,
          roles: result.evaluation,
          message:
            "Wallet linked and every DYØØR holder entitlement was evaluated. Your Discord roles are synchronized.",
        });
      } catch (error) {
        return reply.code(400).send({ error: userError(error) });
      }
    },
  );

  app.post("/api/verification/cancel", async (request, reply) => {
    try {
      const token = tokenFromCookie(request.cookies[cookieName]);
      repository.cancelSession(token);
    } catch {
      // Cancellation remains idempotent and reveals no session state.
    }
    reply.clearCookie(cookieName, { path: "/" });
    return reply.send({ cancelled: true });
  });

  return app;
}

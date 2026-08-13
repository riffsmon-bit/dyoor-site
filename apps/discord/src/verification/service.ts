import { randomBytes } from "node:crypto";
import { createSiweMessage } from "viem/siwe";
import { getAddress, type Address, type Hex } from "viem";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";
import type { AppEnv } from "../config/env.js";
import { createChainClient, readWalletEntitlements } from "../blockchain/contract.js";
import type { HolderRoleKey } from "../discord/model.js";
import type { RoleEvaluation, VerificationRepository } from "./repository.js";

const authenticationChainId = 143;

export interface VerificationSuccess {
  discordUserId: string;
  walletAddress: string;
  evaluation: RoleEvaluation;
}

export class VerificationService {
  constructor(
    private readonly env: AppEnv,
    private readonly repository: VerificationRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly readEntitlements: typeof readWalletEntitlements = (runtimeEnv, wallet) =>
      readWalletEntitlements(runtimeEnv, wallet),
    private readonly verifySignature: (
      address: Address,
      message: string,
      signature: Hex,
    ) => Promise<boolean> = (address, message, signature) =>
      createChainClient(env, "monad").verifyMessage({ address, message, signature }),
  ) {}

  createDiscordSession(discordUserId: string, guildId: string) {
    if (guildId !== this.env.DISCORD_GUILD_ID) {
      throw new Error("Verification is not enabled for this guild.");
    }
    const session = this.repository.createSession(discordUserId, guildId);
    const url = this.verificationBaseUrl();
    url.searchParams.set("session", session.token);
    return { ...session, url: url.toString() };
  }

  prepare(token: string, submittedWallet: string, submittedChainId = authenticationChainId) {
    const wallet = getAddress(submittedWallet);
    const current = this.repository.getByToken(token);
    if (!current || current.status === "EXPIRED") {
      throw new Error("Verification link is invalid or expired.");
    }
    if (submittedChainId !== authenticationChainId) {
      this.repository.recordAudit("CHAIN_MISMATCH", current.discordUserId, wallet, {
        expectedChainId: authenticationChainId,
        receivedChainId: submittedChainId,
      });
      throw new Error("Wrong network. Switch to Monad Mainnet and try again.");
    }
    if (current.status === "PREPARED" && current.siweMessage) {
      if (current.walletAddress?.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error("This verification session is already bound to another wallet.");
      }
      return { message: current.siweMessage, chainId: authenticationChainId, wallet };
    }

    const baseUrl = this.verificationBaseUrl();
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = this.now();
    const message = createSiweMessage({
      address: wallet,
      chainId: authenticationChainId,
      domain: baseUrl.host,
      uri: baseUrl.origin,
      version: "1",
      nonce,
      issuedAt,
      expirationTime: new Date(current.expiresAt),
      requestId: current.sessionId,
      statement: "Sign in to DYØØR to link this wallet to your Discord identity.",
      resources: [
        `urn:dyoor:discord-user:${current.discordUserId}`,
        `urn:dyoor:discord-guild:${current.guildId}`,
      ],
    });
    this.repository.prepareSession(token, wallet, nonce, message);
    return { message, chainId: authenticationChainId, wallet };
  }

  async complete(token: string, signature: string): Promise<VerificationSuccess> {
    const session = this.repository.getByToken(token);
    if (
      !session ||
      session.status !== "PREPARED" ||
      !session.walletAddress ||
      !session.siweMessage ||
      session.consumedAt
    ) {
      throw new Error("Verification session is invalid, expired, or already used.");
    }
    if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
      this.repository.recordFailedSignature(token);
      throw new Error("The wallet signature format is invalid.");
    }
    const address = getAddress(session.walletAddress);
    let valid: boolean;
    try {
      valid = await this.verifySignature(address, session.siweMessage, signature as Hex);
    } catch {
      this.repository.recordSessionAudit(token, "RPC_ERROR", {
        stage: "signature_validation",
      });
      throw new Error(
        "The authentication signature could not be validated right now. No Discord roles changed; try again shortly.",
      );
    }
    if (!valid) {
      this.repository.recordFailedSignature(token);
      throw new Error("The wallet signature could not be verified.");
    }

    const reads = await this.readEntitlements(this.env, address);
    const chainIds = Object.fromEntries(
      dyoorDiscordConfig.contracts.map((contract) => [
        contract.key,
        dyoorDiscordConfig.chains.find((chain) => chain.key === contract.chainKey)?.id ?? 0,
      ]),
    ) as Record<HolderRoleKey, number>;
    return this.repository.linkWalletAndComplete(
      token,
      address,
      reads,
      chainIds,
      this.env.HOLDER_GRACE_PERIOD_HOURS * 60 * 60 * 1000,
    );
  }

  private verificationBaseUrl() {
    if (!this.env.VERIFICATION_BASE_URL) {
      throw new Error("Holder verification is disabled until VERIFICATION_BASE_URL is configured.");
    }
    const url = new URL(this.env.VERIFICATION_BASE_URL);
    if (this.env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("Production holder verification requires an HTTPS VERIFICATION_BASE_URL.");
    }
    if (url.pathname.replace(/\/$/, "") !== "/verify") {
      throw new Error("VERIFICATION_BASE_URL must end in /verify.");
    }
    return url;
  }
}

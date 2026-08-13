import { getAddress, type Address } from "viem";
import { dyoorDiscordConfig } from "../../config/dyoor-discord.js";
import type { EntitlementRead } from "../blockchain/contract.js";
import type { HolderRoleKey } from "../discord/model.js";
import type { RoleEvaluation, VerificationRepository } from "../verification/repository.js";

export interface MultiRoleAdapter {
  syncRoles(discordUserId: string, evaluation: RoleEvaluation): Promise<void>;
}

export interface RevalidationSummary {
  walletsChecked: number;
  moduleChecks: number;
  usersSynced: number;
  qualifiedReads: number;
  zeroReads: number;
  rpcFailures: number;
  roleFailures: number;
}

export class HolderRevalidator {
  constructor(
    private readonly repository: VerificationRepository,
    private readonly roleAdapter: MultiRoleAdapter,
    private readonly readEntitlements: (
      wallet: Address,
    ) => Promise<Record<HolderRoleKey, EntitlementRead>>,
    private readonly recheckIntervalMs: number,
    private readonly gracePeriodMs: number,
    private readonly concurrency = 4,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runOnce(force = false): Promise<RevalidationSummary> {
    const cutoff = force
      ? new Date(this.now().getTime() + 1)
      : new Date(this.now().getTime() - this.recheckIntervalMs);
    const wallets = this.repository.listWalletAddressesDue(cutoff);
    const summary: RevalidationSummary = {
      walletsChecked: 0,
      moduleChecks: 0,
      usersSynced: 0,
      qualifiedReads: 0,
      zeroReads: 0,
      rpcFailures: 0,
      roleFailures: 0,
    };
    const affectedUsers = new Set<string>();
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor++;
        const item = wallets[index];
        if (!item) return;
        summary.walletsChecked += 1;
        affectedUsers.add(item.discordUserId);
        let reads: Record<HolderRoleKey, EntitlementRead>;
        try {
          reads = await this.readEntitlements(getAddress(item.walletAddress));
        } catch (error) {
          reads = Object.fromEntries(
            dyoorDiscordConfig.contracts.map((contract) => [
              contract.key,
              {
                key: contract.key,
                status: "RPC_ERROR",
                error: error instanceof Error ? error.message : "Provider unavailable",
              } satisfies EntitlementRead,
            ]),
          ) as Record<HolderRoleKey, EntitlementRead>;
        }
        for (const contract of dyoorDiscordConfig.contracts) {
          const read = reads[contract.key];
          const chainId =
            dyoorDiscordConfig.chains.find((chain) => chain.key === contract.chainKey)?.id ?? 0;
          this.repository.recordEntitlementRead(
            item.walletAddress,
            contract.key,
            chainId,
            read,
            this.gracePeriodMs,
          );
          summary.moduleChecks += 1;
          if (read.status === "QUALIFIED") summary.qualifiedReads += 1;
          else if (read.status === "NOT_QUALIFIED") summary.zeroReads += 1;
          else summary.rpcFailures += 1;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, Math.max(1, wallets.length)) }, () =>
        worker(),
      ),
    );

    for (const discordUserId of affectedUsers) {
      const evaluation = this.repository.evaluateUserRoles(discordUserId);
      try {
        await this.roleAdapter.syncRoles(discordUserId, evaluation);
        summary.usersSynced += 1;
      } catch (error) {
        summary.roleFailures += 1;
        this.repository.recordRoleSync(
          discordUserId,
          evaluation,
          error instanceof Error ? error.message : "Discord role sync failed",
        );
      }
    }
    return summary;
  }
}

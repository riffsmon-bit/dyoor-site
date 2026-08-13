import { describe, expect, it } from "vitest";
import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import { commandJson } from "../src/bot/command-definitions.js";
import { managedPanels } from "../src/bot/panels.js";
import { automodPlan } from "../src/discord/automod.js";
import { fullyDeployedSnapshot, testEnv } from "./helpers.js";

describe("DYØØR slash commands", () => {
  it("contains the required member, moderation, audit, raid, and holder commands", () => {
    const names = commandJson.map((command) => command.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "warn",
        "warnings",
        "timeout",
        "untimeout",
        "kick",
        "ban",
        "unban",
        "slowmode",
        "lock",
        "unlock",
        "purge",
        "userinfo",
        "serverstatus",
        "raidmode",
        "verify",
        "reverify",
        "holder-status",
        "role-sync",
        "server-audit",
        "permission-audit",
        "sync-user",
        "sync-all",
        "holder",
      ]),
    );
  });

  it("never asks members to paste a wallet signature into Discord", () => {
    expect(JSON.stringify(commandJson).toLowerCase()).not.toContain('"name":"signature"');
    expect(commandJson.some((command) => command.name === "verify-confirm")).toBe(false);
  });
});

describe("bot-managed DYØØR panels", () => {
  it("separates basic verification from wallet verification", () => {
    const panels = managedPanels(dyoorDiscordConfig, testEnv());
    const rules = JSON.stringify(panels.find((panel) => panel.key === "rules-panel"));
    const waiting = JSON.stringify(panels.find((panel) => panel.key === "waiting-room-panel"));
    expect(rules).toContain("entrance:complete");
    expect(rules).not.toContain("wallet:verify");
    expect(waiting).toContain("wallet:verify");
    expect(waiting).toContain("Season 1");
    expect(waiting).toContain("HoodYØØR");
  });

  it("publishes concise wallet-safety copy and every centralized contract", () => {
    const serialized = JSON.stringify(managedPanels(dyoorDiscordConfig, testEnv()));
    expect(serialized).toContain("seed phrase");
    expect(serialized).toContain("setApprovalForAll");
    expect(serialized).toContain("No transaction");
    for (const contract of dyoorDiscordConfig.contracts) {
      expect(serialized.toLowerCase()).toContain(contract.address.toLowerCase());
    }
  });
});

describe("native security rules", () => {
  it("plans four DYØØR AutoMod rules without automatic bans", () => {
    const actions = automodPlan(fullyDeployedSnapshot(), dyoorDiscordConfig);
    expect(actions.filter((action) => action.operation === "CREATE")).toHaveLength(4);
    const serialized = JSON.stringify(dyoorDiscordConfig.automodRules).toLowerCase();
    expect(serialized).not.toContain('"ban"');
    expect(serialized).not.toContain('"timeout"');
  });

  it("preserves Discord-managed native rules that the bot cannot patch", () => {
    const snapshot = fullyDeployedSnapshot();
    snapshot.autoModerationRules = [
      {
        id: "discord-managed-mention-rule",
        guild_id: snapshot.guild.id,
        creator_id: "discord-native-safety",
        name: "Block Mention Spam",
        event_type: 1,
        trigger_type: 5,
        trigger_metadata: {
          mention_total_limit: 20,
          mention_raid_protection_enabled: true,
        },
        actions: [{ type: 1, metadata: {} }],
        enabled: true,
        exempt_roles: [],
        exempt_channels: [],
      },
    ];

    expect(
      automodPlan(snapshot, dyoorDiscordConfig).find(
        (action) => action.name === "Block Mention Spam",
      ),
    ).toMatchObject({
      operation: "UNCHANGED",
      detail: "Discord-managed native rule preserved",
    });
  });
});

import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import { buildDiscordPlan } from "../src/discord/plan.js";
import type { RoleKey, StaffRoleKey } from "../src/discord/model.js";
import {
  buildOverwrites,
  dangerousEveryonePermissions,
  requiredBotPermissions,
} from "../src/discord/permissions.js";
import { blankGuildSnapshot, fullyDeployedSnapshot, ids } from "./helpers.js";

function permissionContext() {
  return {
    everyoneId: ids.guild,
    botRoleId: ids.botRole,
    roleIds: new Map<RoleKey, string>(
      dyoorDiscordConfig.roles.map((role) => [role.key, `role-${role.key}`]),
    ),
    staffRoleIds: new Map<StaffRoleKey, string>(
      dyoorDiscordConfig.staffRoles.map((role) => [role.key, role.existingId]),
    ),
  };
}

function canView(policy: Parameters<typeof buildOverwrites>[0], roleId: string) {
  const overwrite = buildOverwrites(policy, permissionContext()).find((item) => item.id === roleId);
  return Boolean(BigInt(overwrite?.allow ?? 0) & PermissionFlagsBits.ViewChannel);
}

describe("DYØØR access matrix", () => {
  it("implements S1 OR Ascended access without a redundant combined role", () => {
    expect(canView("season1-ascended-chat", "role-season1")).toBe(true);
    expect(canView("season1-ascended-chat", "role-ascended")).toBe(true);
    expect(canView("season1-ascended-chat", "role-dyoorified")).toBe(false);
    expect(dyoorDiscordConfig.roles.some((role) => role.key === ("combined" as never))).toBe(false);
  });

  it("isolates S2 and HoodYØØR while keeping all verified members in the waiting room", () => {
    expect(canView("season2-chat", "role-season2")).toBe(true);
    expect(canView("season2-chat", "role-season1")).toBe(false);
    expect(canView("hoodyoor-chat", "role-hoodyoor")).toBe(true);
    expect(canView("hoodyoor-chat", "role-season2")).toBe(false);
    expect(canView("dyoorified-chat", "role-dyoorified")).toBe(true);
    expect(canView("dyoorified-chat", "role-season2")).toBe(true);
  });

  it("keeps entry channels visible but prevents unverified posting", () => {
    const overwrites = buildOverwrites("entry-readonly", permissionContext());
    const everyone = overwrites.find((entry) => entry.id === ids.guild);
    expect(BigInt(everyone?.allow ?? 0) & PermissionFlagsBits.ViewChannel).toBeTruthy();
    expect(BigInt(everyone?.deny ?? 0) & PermissionFlagsBits.SendMessages).toBeTruthy();
  });

  it("detects dangerous @everyone rights and excludes Administrator/Webhooks from the bot", () => {
    expect(
      dangerousEveryonePermissions({
        permissions: (
          PermissionFlagsBits.ViewChannel | PermissionFlagsBits.MentionEveryone
        ).toString(),
      }),
    ).toContain("MentionEveryone");
    const required = requiredBotPermissions(dyoorDiscordConfig);
    expect(required & PermissionFlagsBits.Administrator).toBeFalsy();
    expect(required & PermissionFlagsBits.ManageWebhooks).toBeFalsy();
    expect(required & PermissionFlagsBits.ManageRoles).toBeTruthy();
  });
});

describe("idempotent, non-destructive server plan", () => {
  it("creates missing managed resources but always reports zero deletes", () => {
    const plan = buildDiscordPlan(blankGuildSnapshot(), dyoorDiscordConfig);
    expect(plan.summary.creates).toBeGreaterThan(0);
    expect(plan.summary.deletes).toBe(0);
    expect(plan.actions.some((action) => action.operation === ("DELETE" as never))).toBe(false);
  });

  it("has no structural drift once every managed resource matches", () => {
    const plan = buildDiscordPlan(fullyDeployedSnapshot(), dyoorDiscordConfig);
    expect(plan.summary.creates).toBe(0);
    expect(plan.summary.updates).toBe(0);
    expect(plan.summary.failures).toBe(0);
    expect(plan.summary.deletes).toBe(0);
  });
});

import { Collection, type GuildMember, type Role } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import type { DatabaseConnection } from "../src/database/database.js";
import { DiscordRoleSyncAdapter } from "../src/holders/discord-role-adapter.js";
import { EntranceService } from "../src/onboarding/entrance.js";
import { VerificationRepository } from "../src/verification/repository.js";
import { ids, testDatabase, testEnv } from "./helpers.js";

const openDatabases: DatabaseConnection[] = [];

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

function ownerMember() {
  const configuredRoles = dyoorDiscordConfig.roles.map((role, index) => ({
    id: "existingId" in role ? role.existingId : `role-${role.key}`,
    name: role.name,
    managed: false,
    position: index + 1,
  }));
  const guildRoleCache = new Collection<string, Role>(
    configuredRoles.map((role) => [role.id, role as unknown as Role]),
  );
  const memberRoleCache = new Collection<string, Role>();
  const add = vi.fn(async (role: Role) => {
    memberRoleCache.set(role.id, role);
  });
  const remove = vi.fn(async (role: Role) => {
    memberRoleCache.delete(role.id);
  });
  const guild = {
    id: ids.guild,
    ownerId: ids.owner,
    roles: {
      cache: guildRoleCache,
      fetch: vi.fn(async () => guildRoleCache),
    },
    members: {
      fetchMe: vi.fn(async () => ({ roles: { highest: { position: 100 } } })),
    },
    channels: { cache: new Collection() },
  };
  const member = {
    id: ids.owner,
    guild,
    pending: false,
    roles: { cache: memberRoleCache, add, remove },
  } as unknown as GuildMember;
  return { member, add, memberRoleCache };
}

describe("owner holder role synchronization", () => {
  it("assigns every independently qualified holder role to the server owner", async () => {
    const database = testDatabase();
    openDatabases.push(database);
    const repository = new VerificationRepository(database);
    const adapter = new DiscordRoleSyncAdapter(testEnv(), repository);
    const { member, add, memberRoleCache } = ownerMember();

    const result = await adapter.syncMember(member, {
      dyoorified: true,
      season1Holder: true,
      ascended: true,
      season2Holder: true,
      hoodYoorHolder: false,
      rpcUncertain: [],
    });

    expect(result.ownerSkipped).toBe(false);
    expect(result.added).toEqual(["DYOORyfied", "DYOOR HODLER", "Ascended", "Season 2 Holder"]);
    expect(add).toHaveBeenCalledTimes(4);
    expect([...memberRoleCache.values()].map((role) => role.name)).toEqual(result.added);
  });

  it("acknowledges entrance immediately and grants DYOORyfied to the owner", async () => {
    const database = testDatabase();
    openDatabases.push(database);
    const repository = new VerificationRepository(database);
    const service = new EntranceService(testEnv(), repository);
    const { member, memberRoleCache } = ownerMember();
    const deferReply = vi.fn(async () => undefined);
    const editReply = vi.fn(async () => undefined);

    await service.enter({
      inCachedGuild: () => true,
      guildId: ids.guild,
      member,
      user: {
        id: ids.owner,
        bot: false,
        createdTimestamp: Date.now() - 365 * 24 * 60 * 60 * 1000,
      },
      deferReply,
      editReply,
    } as never);

    expect(deferReply).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("SYSTEM ACCESS GRANTED") }),
    );
    expect([...memberRoleCache.values()].map((role) => role.name)).toContain("DYOORyfied");
  });
});

import {
  ChannelType,
  Collection,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import {
  AuthorizationError,
  authorizedMember,
  manageableTarget,
} from "../src/bot/authorization.js";
import type { DatabaseConnection } from "../src/database/database.js";
import { AppRepository } from "../src/database/repositories.js";
import { ChannelControlService } from "../src/moderation/channel-controls.js";
import { InteractionRateLimiter } from "../src/onboarding/entrance.js";
import { canTransition, transitionOnboarding } from "../src/onboarding/state.js";
import { TicketService } from "../src/tickets/service.js";
import { ids, testDatabase, testEnv } from "./helpers.js";

const openDatabases: DatabaseConnection[] = [];
afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

function interaction(memberId: string, roleIds: string[]) {
  const roles = new Collection(roleIds.map((id) => [id, { id, name: id }]));
  return {
    inCachedGuild: () => true,
    member: { id: memberId, roles: { cache: roles } },
  } as unknown as ChatInputCommandInteraction;
}

describe("server-side authorization and onboarding", () => {
  it("uses owner and configured staff role IDs, not cosmetic names", () => {
    expect(authorizedMember(interaction(ids.owner, []), testEnv(), "owner").id).toBe(ids.owner);
    const moderatorId = dyoorDiscordConfig.staffRoles.find(
      (role) => role.key === "moderator",
    )!.existingId;
    expect(authorizedMember(interaction(ids.user, [moderatorId]), testEnv(), "moderator").id).toBe(
      ids.user,
    );
    expect(() =>
      authorizedMember(interaction(ids.user, ["fake-Moderator"]), testEnv(), "moderator"),
    ).toThrow(AuthorizationError);
  });

  it("never permits the server owner to be targeted", async () => {
    const guild = { ownerId: ids.owner, members: { fetchMe: vi.fn() } };
    await expect(
      manageableTarget(
        { id: ids.user, guild } as unknown as GuildMember,
        { id: ids.owner } as unknown as GuildMember,
      ),
    ).rejects.toThrow("owner cannot be modified");
  });

  it("requires the basic-verification state transition before holder state", () => {
    let state = transitionOnboarding("NEW", "SCREENING_COMPLETE");
    state = transitionOnboarding(state, "VISITOR");
    state = transitionOnboarding(state, "HOLDER");
    expect(state).toBe("HOLDER");
    expect(canTransition("NEW", "HOLDER")).toBe(false);
    const limiter = new InteractionRateLimiter();
    expect(limiter.allow("member", 30_000, 100_000)).toBe(true);
    expect(limiter.allow("member", 30_000, 110_000)).toBe(false);
  });
});

describe("private ticket and raid-mode safety", () => {
  it("creates ticket overwrites for only the creator, bot, and configured staff", async () => {
    const database = testDatabase();
    openDatabases.push(database);
    const repository = new AppRepository(database);
    const service = new TicketService(testEnv(), repository);
    const parent = { id: "open-tickets", type: ChannelType.GuildCategory, name: "Open Tickets" };
    const everyone = { id: ids.guild, name: "@everyone" };
    const staffRoles = dyoorDiscordConfig.staffRoles.map((role) => ({
      id: role.existingId,
      name: role.name,
    }));
    const send = vi.fn(async () => undefined);
    const create = vi.fn(
      async (_options: {
        permissionOverwrites: Array<{ id: string; allow?: bigint[]; deny?: bigint[] }>;
      }) => ({
        id: "ticket-channel",
        send,
      }),
    );
    const deferReply = vi.fn(async () => undefined);
    const editReply = vi.fn(async () => undefined);
    const guild = {
      roles: {
        everyone,
        cache: new Collection<string, { id: string; name: string }>([
          [everyone.id, everyone],
          ...staffRoles.map((role) => [role.id, role] as const),
        ]),
      },
      channels: {
        cache: new Collection([[parent.id, parent]]),
        create,
      },
      members: { fetchMe: vi.fn(async () => ({ id: ids.client })) },
    };
    const current = {
      inCachedGuild: () => true,
      guildId: ids.guild,
      guild,
      user: { id: ids.user },
      values: ["holder"],
      deferReply,
      editReply,
    } as never;
    await service.create(current);
    const options = create.mock.calls[0]![0];
    const overwrites = options.permissionOverwrites as Array<{
      id: string;
      allow?: bigint[];
      deny?: bigint[];
    }>;
    expect(overwrites.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        ids.guild,
        ids.user,
        ids.client,
        ...staffRoles.map((role) => role.id),
      ]),
    );
    expect(overwrites.find((entry) => entry.id === ids.guild)?.deny).toContain(
      PermissionFlagsBits.ViewChannel,
    );
    expect(JSON.stringify(send.mock.calls[0])).toContain("Never send a seed phrase");
  });

  it("toggles raid mode by reversible channel state and never bans recent joins", async () => {
    const database = testDatabase();
    openDatabases.push(database);
    const service = new ChannelControlService(new AppRepository(database));
    const waitingRoom = { type: ChannelType.GuildText, name: "waiting-room" };
    const guild = {
      id: ids.guild,
      channels: { cache: new Collection([["waiting-room", waitingRoom]]) },
    } as unknown as Guild;
    const lock = vi.spyOn(service, "lock").mockResolvedValue(true);
    const unlock = vi.spyOn(service, "unlock").mockResolvedValue(true);
    await service.setRaidMode(guild, true);
    expect(lock).toHaveBeenCalledWith(waitingRoom, 30);
    expect(service.raidModeStatus(ids.guild)).toBe(true);
    await service.setRaidMode(guild, false);
    expect(unlock).toHaveBeenCalledWith(waitingRoom);
    expect(service.raidModeStatus(ids.guild)).toBe(false);
  });
});

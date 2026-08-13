import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GuildSnapshot } from "./inspect.js";

function timestampForFile(date: Date) {
  return date
    .toISOString()
    .replace(/:/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function snapshotStorageRoot() {
  return process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || process.cwd();
}

export function sanitizedSnapshot(
  snapshot: GuildSnapshot,
  managedMessages: readonly unknown[] = [],
) {
  return {
    schemaVersion: 2,
    capturedAt: snapshot.capturedAt,
    scope: "Discord configuration recovery; not a message or member backup",
    guild: {
      id: snapshot.guild.id,
      name: snapshot.guild.name,
      ownerId: snapshot.guild.owner_id,
      description: snapshot.guild.description,
      features: snapshot.guild.features,
      verificationLevel: snapshot.guild.verification_level,
      explicitContentFilter: snapshot.guild.explicit_content_filter,
      mfaLevel: snapshot.guild.mfa_level,
      rulesChannelId: snapshot.guild.rules_channel_id,
      publicUpdatesChannelId: snapshot.guild.public_updates_channel_id,
      safetyAlertsChannelId: snapshot.guild.safety_alerts_channel_id,
    },
    roles: snapshot.roles.map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      position: role.position,
      permissions: role.permissions,
      managed: role.managed,
      mentionable: role.mentionable,
    })),
    channels: snapshot.channels.map((channel) => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      parentId: channel.parent_id,
      position: "position" in channel ? channel.position : undefined,
      topic: "topic" in channel ? channel.topic : undefined,
      slowmodeSeconds: "rate_limit_per_user" in channel ? channel.rate_limit_per_user : undefined,
      permissionOverwrites: channel.permission_overwrites,
    })),
    scheduledEvents: snapshot.scheduledEvents.map((event) => ({
      id: event.id,
      name: event.name,
      description: event.description,
      scheduledStartTime: event.scheduled_start_time,
      scheduledEndTime: event.scheduled_end_time,
      status: event.status,
      entityType: event.entity_type,
      entityMetadata: event.entity_metadata,
    })),
    guildCommands: snapshot.guildCommands.map((command) => ({
      id: command.id,
      name: command.name,
      description: command.description,
      type: command.type,
      options: command.options,
      defaultMemberPermissions: command.default_member_permissions,
      nsfw: command.nsfw,
    })),
    autoModerationRules: snapshot.autoModerationRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      eventType: rule.event_type,
      triggerType: rule.trigger_type,
      triggerMetadata: rule.trigger_metadata,
      actions: rule.actions,
      enabled: rule.enabled,
      exemptRoles: rule.exempt_roles,
      exemptChannels: rule.exempt_channels,
    })),
    application: {
      id: snapshot.application.id,
      name: snapshot.application.name,
      botPublic: snapshot.application.bot_public,
      botRequireCodeGrant: snapshot.application.bot_require_code_grant,
      flags: snapshot.application.flags,
      interactionsEndpointUrl: snapshot.application.interactions_endpoint_url,
      redirectUris: snapshot.application.redirect_uris,
      installParams: snapshot.application.install_params,
    },
    onboarding: snapshot.onboarding,
    integrations:
      snapshot.integrations?.map((item) => {
        const value = item as Record<string, unknown>;
        return {
          id: value.id,
          name: value.name,
          type: value.type,
          enabled: value.enabled,
          roleId: value.role_id,
        };
      }) ?? null,
    webhooks:
      snapshot.webhooks?.map((item) => {
        const value = item as Record<string, unknown>;
        return {
          id: value.id,
          name: value.name,
          type: value.type,
          channelId: value.channel_id,
          applicationId: value.application_id,
        };
      }) ?? null,
    inspectionErrors: snapshot.inspectionErrors,
    managedMessages,
  };
}

export async function writeDiscordSnapshot(
  snapshot: GuildSnapshot,
  projectRoot = snapshotStorageRoot(),
  managedMessages: readonly unknown[] = [],
) {
  const directory = resolve(projectRoot, "backups/discord");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `${timestampForFile(new Date())}.json`);
  await writeFile(
    path,
    `${JSON.stringify(sanitizedSnapshot(snapshot, managedMessages), null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    },
  );
  return path;
}

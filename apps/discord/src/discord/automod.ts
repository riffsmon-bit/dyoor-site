import { ChannelType, Routes, type REST } from "discord.js";
import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  type APIAutoModerationRule,
  type RESTPostAPIAutoModerationRuleJSONBody,
} from "discord-api-types/v10";
import type { DesiredAutomodRule, ProjectConfig } from "./model.js";
import type { GuildSnapshot } from "./inspect.js";
import type { PlanAction } from "./plan.js";

const reason = "Approved DYØØR idempotent native AutoMod provisioning";

function triggerType(kind: DesiredAutomodRule["kind"]) {
  if (kind === "keyword") return AutoModerationRuleTriggerType.Keyword;
  if (kind === "spam") return AutoModerationRuleTriggerType.Spam;
  return AutoModerationRuleTriggerType.MentionSpam;
}

function dependencies(snapshot: GuildSnapshot, config: ProjectConfig) {
  const desiredAlert = config.categories
    .flatMap((category) => category.channels)
    .find((channel) => channel.key === "security-alerts");
  const alertChannels = snapshot.channels.filter(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      (channel.id === desiredAlert?.existingId || channel.name === desiredAlert?.name),
  );
  if (alertChannels.length !== 1) return null;
  const exemptRoleIds: string[] = [];
  for (const reference of config.staffRoles) {
    const match = snapshot.roles.find(
      (role) => role.id === reference.existingId && role.name === reference.name,
    );
    if (!match) return null;
    exemptRoleIds.push(match.id);
  }
  return { alertChannelId: alertChannels[0]!.id, exemptRoleIds: exemptRoleIds.sort() };
}

function desiredBody(
  desired: DesiredAutomodRule,
  resolved: NonNullable<ReturnType<typeof dependencies>>,
): RESTPostAPIAutoModerationRuleJSONBody {
  const trigger_metadata =
    desired.kind === "keyword"
      ? {
          keyword_filter: [...(desired.keywords ?? [])],
          regex_patterns: [],
          allow_list: [],
        }
      : desired.kind === "mention-spam"
        ? {
            mention_total_limit: desired.mentionLimit ?? 5,
            mention_raid_protection_enabled: true,
          }
        : {};
  return {
    name: desired.name,
    event_type: AutoModerationRuleEventType.MessageSend,
    trigger_type: triggerType(desired.kind),
    trigger_metadata,
    actions: [
      {
        type: AutoModerationActionType.BlockMessage,
        metadata: { custom_message: desired.blockMessage },
      },
      {
        type: AutoModerationActionType.SendAlertMessage,
        metadata: { channel_id: resolved.alertChannelId },
      },
    ],
    enabled: true,
    exempt_roles: resolved.exemptRoleIds,
    exempt_channels: [],
  };
}

function comparableExisting(rule: APIAutoModerationRule) {
  return {
    name: rule.name,
    event_type: rule.event_type,
    trigger_type: rule.trigger_type,
    trigger_metadata: rule.trigger_metadata,
    actions: rule.actions,
    enabled: rule.enabled,
    exempt_roles: [...rule.exempt_roles].sort(),
    exempt_channels: [...rule.exempt_channels].sort(),
  };
}

function conflictsWithPlatformLimit(
  snapshot: GuildSnapshot,
  desired: DesiredAutomodRule,
  desiredNames: ReadonlySet<string>,
) {
  const type = triggerType(desired.kind);
  const unmanagedSameType = snapshot.autoModerationRules.filter(
    (rule) => rule.trigger_type === type && !desiredNames.has(rule.name),
  );
  if (
    type === AutoModerationRuleTriggerType.Spam ||
    type === AutoModerationRuleTriggerType.MentionSpam
  ) {
    return unmanagedSameType.length >= 1;
  }
  return (
    type === AutoModerationRuleTriggerType.Keyword &&
    snapshot.autoModerationRules.filter(
      (rule) => rule.trigger_type === AutoModerationRuleTriggerType.Keyword,
    ).length >= 6
  );
}

export function automodPlan(snapshot: GuildSnapshot, config: ProjectConfig): PlanAction[] {
  const actions: PlanAction[] = [];
  const resolved = dependencies(snapshot, config);
  const desiredNames = new Set(config.automodRules.map((rule) => rule.name));

  for (const desired of config.automodRules) {
    const matches = snapshot.autoModerationRules.filter((rule) => rule.name === desired.name);
    if (matches.length > 1) {
      actions.push({
        operation: "FAIL",
        resource: "AUTOMOD",
        name: desired.name,
        detail: "duplicate managed AutoMod rule names",
      });
      continue;
    }
    const existing = matches[0];
    if (!existing) {
      actions.push({
        operation: conflictsWithPlatformLimit(snapshot, desired, desiredNames) ? "FAIL" : "CREATE",
        resource: "AUTOMOD",
        name: desired.name,
        detail: conflictsWithPlatformLimit(snapshot, desired, desiredNames)
          ? "an unmanaged rule already occupies Discord’s single-rule trigger limit"
          : "native Discord safety rule",
      });
      continue;
    }
    if (existing.trigger_type !== triggerType(desired.kind)) {
      actions.push({
        operation: "FAIL",
        resource: "AUTOMOD",
        name: desired.name,
        detail: "trigger type cannot be changed in place",
      });
    } else if (existing.creator_id !== snapshot.bot.id) {
      actions.push({
        operation: "UNCHANGED",
        resource: "AUTOMOD",
        name: desired.name,
        detail: "Discord-managed native rule preserved",
      });
    } else if (!resolved) {
      actions.push({
        operation: "WARN",
        resource: "AUTOMOD",
        name: desired.name,
        detail: "role/channel dependencies will resolve after structural provisioning",
      });
    } else if (
      JSON.stringify(comparableExisting(existing)) !==
      JSON.stringify(desiredBody(desired, resolved))
    ) {
      actions.push({ operation: "UPDATE", resource: "AUTOMOD", name: desired.name });
    } else {
      actions.push({ operation: "UNCHANGED", resource: "AUTOMOD", name: desired.name });
    }
  }

  for (const existing of snapshot.autoModerationRules) {
    if (!desiredNames.has(existing.name)) {
      actions.push({
        operation: "UNMANAGED",
        resource: "AUTOMOD",
        name: existing.name,
        detail: "preserved; deletes remain disabled",
      });
    }
  }
  return actions;
}

export async function provisionAutomod(rest: REST, snapshot: GuildSnapshot, config: ProjectConfig) {
  const resolved = dependencies(snapshot, config);
  if (!resolved) throw new Error("AutoMod dependencies are missing or duplicated");
  let created = 0;
  let updated = 0;
  for (const desired of config.automodRules) {
    const matches = snapshot.autoModerationRules.filter((rule) => rule.name === desired.name);
    if (matches.length > 1) throw new Error(`Refusing duplicate AutoMod rule ${desired.name}`);
    const existing = matches[0];
    const body = desiredBody(desired, resolved);
    if (!existing) {
      await rest.post(Routes.guildAutoModerationRules(snapshot.guild.id), { body, reason });
      created += 1;
    } else if (existing.trigger_type !== body.trigger_type) {
      throw new Error(`Cannot update AutoMod trigger type for ${desired.name}`);
    } else if (existing.creator_id !== snapshot.bot.id) {
      continue;
    } else if (JSON.stringify(comparableExisting(existing)) !== JSON.stringify(body)) {
      const { trigger_type: _immutableTrigger, ...patchBody } = body;
      void _immutableTrigger;
      await rest.patch(Routes.guildAutoModerationRule(snapshot.guild.id, existing.id), {
        body: patchBody,
        reason,
      });
      updated += 1;
    }
  }
  return { created, updated, deletes: 0 as const };
}

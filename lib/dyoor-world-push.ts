export const DYOOR_WORLD_PUSH_CATEGORIES = [
  "announcements",
  "replies",
  "directMessages",
  "tips",
  "trades",
  "chat",
  "sales",
  "burns",
] as const;

export type DyoorWorldPushCategory =
  (typeof DYOOR_WORLD_PUSH_CATEGORIES)[number];

export type DyoorWorldPushPreferences = Record<
  DyoorWorldPushCategory,
  boolean
> & {
  previews: boolean;
};

export const DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES:
Readonly<DyoorWorldPushPreferences> = Object.freeze({
  announcements: true,
  replies: true,
  directMessages: true,
  tips: true,
  trades: true,
  chat: false,
  sales: false,
  burns: false,
  previews: false,
});

export function normalizeDyoorWorldPushPreferences(
  value: unknown,
): DyoorWorldPushPreferences {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    announcements: typeof input.announcements === "boolean"
      ? input.announcements
      : DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES.announcements,
    replies: typeof input.replies === "boolean"
      ? input.replies
      : DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES.replies,
    directMessages: typeof input.directMessages === "boolean"
      ? input.directMessages
      : DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES.directMessages,
    tips: typeof input.tips === "boolean"
      ? input.tips
      : DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES.tips,
    trades: typeof input.trades === "boolean"
      ? input.trades
      : DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES.trades,
    chat: typeof input.chat === "boolean"
      ? input.chat
      : DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES.chat,
    sales: typeof input.sales === "boolean"
      ? input.sales
      : DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES.sales,
    burns: typeof input.burns === "boolean"
      ? input.burns
      : DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES.burns,
    previews: typeof input.previews === "boolean"
      ? input.previews
      : DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES.previews,
  };
}

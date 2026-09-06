import type { DyoorWorldMessageAttachment } from "@/lib/dyoor-world-media";

export const DYOOR_WORLD_CHAIN_ID = 143;
export const DYOOR_WORLD_DISPLAY_SUFFIX = ".dYOOR";
export const DYOOR_WORLD_CANONICAL_SUFFIX = ".dyoor";
export const DYOOR_WORLD_SESSION_COOKIE = "dyoor_world_session";
export const DYOOR_WORLD_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const DYOOR_WORLD_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export const DYOOR_WORLD_COLLECTIONS = [
  {
    key: "season1",
    label: "Season 1",
    chainId: 143,
    chainLabel: "Monad Mainnet",
    address: "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f",
    ownershipMethod: "balanceOf",
  },
  {
    key: "ascended",
    label: "Ascended",
    chainId: 143,
    chainLabel: "Monad Mainnet",
    address: "0xf9611226c1ccccca37951938d6f358d3d5106549",
    ownershipMethod: "tokensOfStaker",
  },
  {
    key: "season2",
    label: "Season 2",
    chainId: 143,
    chainLabel: "Monad Mainnet",
    address: "0x349d8eb480c92cf75371fba5c6344a4d11b9103a",
    ownershipMethod: "balanceOf",
  },
  {
    key: "hoodyoor",
    label: "HoodYØØR",
    chainId: 4_663,
    chainLabel: "Robinhood Chain Mainnet",
    address: "0x8277f8126722b11d7b44c5c453bcf62a78aafa25",
    ownershipMethod: "balanceOf",
  },
] as const;

export type DyoorWorldEntitlementKey =
  (typeof DYOOR_WORLD_COLLECTIONS)[number]["key"];
export type DyoorWorldEntitlements = Record<DyoorWorldEntitlementKey, boolean>;
export type DyoorWorldChannelAccess =
  | "any"
  | DyoorWorldEntitlementKey
  | readonly DyoorWorldEntitlementKey[];

export const DYOOR_WORLD_EMPTY_ENTITLEMENTS: DyoorWorldEntitlements = {
  season1: false,
  ascended: false,
  season2: false,
  hoodyoor: false,
};

export const DYOOR_WORLD_CHANNELS = [
  {
    id: "announcements",
    label: "announcements",
    description: "Owner-only project dispatches and official links.",
    readOnly: true,
    access: "any",
  },
  {
    id: "world-lobby",
    label: "world-lobby",
    description: "The shared commons for all verified D.Y.O.O.R holders.",
    readOnly: false,
    access: "any",
  },
  {
    id: "season-1",
    label: "s1-ascended",
    description: "Private chat for verified Season 1 or Ascended holders.",
    readOnly: false,
    access: ["season1", "ascended"],
  },
  {
    id: "season-2",
    label: "season-2",
    description: "Private chat for verified Season 2 holders.",
    readOnly: false,
    access: "season2",
  },
  {
    id: "hoodyoor",
    label: "hoodyoor",
    description: "Private chat for verified HoodYØØR holders.",
    readOnly: false,
    access: "hoodyoor",
  },
  {
    id: "trait-lab",
    label: "trait-lab",
    description: "Dynamic trait rolls, rarity finds, and build discussion.",
    readOnly: false,
    access: "season2",
  },
  {
    id: "energy-grid",
    label: "energy-grid",
    description: "Energy flywheel strategy, harvests, and ecosystem signals.",
    readOnly: false,
    access: "season2",
  },
  {
    id: "trade-desk",
    label: "trade-desk",
    description: "Non-custodial S2 swaps coordinated by the World escrow.",
    readOnly: false,
    access: "season2",
  },
  {
    id: "sales-feed",
    label: "sales-feed",
    description: "Verified D.Y.O.O.R sales transmitted by the World sales bot.",
    readOnly: true,
    access: "season2",
  },
  {
    id: "tip-ledger",
    label: "tip-ledger",
    description: "Verified direct MON tips between World holders.",
    readOnly: true,
    access: "season2",
  },
  {
    id: "burn-log",
    label: "burn-log",
    description: "Permanent S2 burns and deflationary collection history.",
    readOnly: true,
    access: "season2",
  },
] as const;

export type DyoorWorldChannelId = (typeof DYOOR_WORLD_CHANNELS)[number]["id"];
export type DyoorWorldChannel = (typeof DYOOR_WORLD_CHANNELS)[number];
export type DyoorWorldMessageKind =
  | "user"
  | "announcement"
  | "system"
  | "sale"
  | "tip"
  | "trade"
  | "burn";
export type DyoorWorldMessageReply = {
  messageId: string;
  wallet: string;
  author: string;
  content: string;
  attachmentKind?: DyoorWorldMessageAttachment["kind"];
};

export type DyoorWorldAvatar = {
  tokenId: string;
  imageUrl: string;
  updatedAt: string;
};

export type DyoorWorldNameClaim = {
  version: 1;
  id: string;
  wallet: string;
  label: string;
  createdAt: string;
};

export type DyoorWorldProfile = {
  wallet: string;
  label: string;
  displayName: string;
  canonicalName: string;
  createdAt: string;
  registryStatus: "preview-reservation" | "monad-active";
};

export type DyoorWorldMessage = {
  version: 1 | 2 | 3 | 4;
  id: string;
  channelId: DyoorWorldChannelId;
  wallet: string;
  content: string;
  createdAt: string;
  kind?: DyoorWorldMessageKind;
  systemAuthor?: string;
  data?: Record<string, string | number | boolean | null>;
  attachment?: DyoorWorldMessageAttachment;
  replyTo?: DyoorWorldMessageReply;
};

export type DyoorWorldMessageView = DyoorWorldMessage & {
  author: string;
  avatar?: DyoorWorldAvatar | null;
  energyReward?: number;
};

const RESERVED_WORLD_LABELS = new Set([
  "admin",
  "administrator",
  "api",
  "app",
  "ascension",
  "bot",
  "burn",
  "dyoor",
  "dyoorworld",
  "energy",
  "help",
  "holder",
  "holders",
  "mesh",
  "m3sh",
  "moderator",
  "official",
  "owner",
  "reward",
  "rewards",
  "root",
  "sales",
  "salesbot",
  "security",
  "staff",
  "support",
  "system",
  "tip",
  "tips",
  "trade",
  "trades",
  "traitlab",
  "treasury",
  "verify",
  "world",
]);

export function normalizeWorldWallet(value: unknown) {
  const wallet = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

export function normalizeWorldMessageId(value: unknown) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9._:-]{1,180}$/.test(id) && !id.includes("..") ? id : "";
}

export function normalizeDyoorWorldMessageReply(
  value: unknown,
): DyoorWorldMessageReply | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const messageId = normalizeWorldMessageId(input.messageId);
  const wallet = normalizeWorldWallet(input.wallet);
  const author = String(input.author || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 80);
  const content = String(input.content || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 240);
  const attachmentKind = ["image", "gif", "sticker"].includes(String(input.attachmentKind || ""))
    ? input.attachmentKind as DyoorWorldMessageAttachment["kind"]
    : undefined;
  if (!messageId || !wallet || !author || (!content && !attachmentKind)) return null;
  return {
    messageId,
    wallet,
    author,
    content,
    ...(attachmentKind ? { attachmentKind } : {}),
  };
}

export function normalizeWorldLabel(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

export function validateWorldLabel(value: unknown) {
  const label = normalizeWorldLabel(value);
  if (label.length < 3 || label.length > 24) {
    return { ok: false as const, label, error: "Choose a name between 3 and 24 characters." };
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
    return {
      ok: false as const,
      label,
      error: "Use lowercase letters, numbers, or interior hyphens only.",
    };
  }
  if (label.includes("--")) {
    return { ok: false as const, label, error: "Consecutive hyphens are not allowed." };
  }
  if (RESERVED_WORLD_LABELS.has(label)) {
    return { ok: false as const, label, error: "That name is reserved by D.Y.O.O.R." };
  }
  return { ok: true as const, label };
}

export function formatWorldName(label: string) {
  return `${normalizeWorldLabel(label)}${DYOOR_WORLD_DISPLAY_SUFFIX}`;
}

export function formatWorldCanonicalName(label: string) {
  return `${normalizeWorldLabel(label)}${DYOOR_WORLD_CANONICAL_SUFFIX}`;
}

export function isWorldChannel(value: unknown): value is DyoorWorldChannelId {
  return DYOOR_WORLD_CHANNELS.some((channel) => channel.id === value);
}

export function canAccessDyoorWorldChannel(
  channelValue: unknown,
  entitlements: Partial<DyoorWorldEntitlements> | null | undefined,
) {
  const channel = DYOOR_WORLD_CHANNELS.find((item) => item.id === channelValue);
  if (!channel) return false;
  if (channel.access === "any") return true;
  if (Array.isArray(channel.access)) {
    const required = channel.access as readonly DyoorWorldEntitlementKey[];
    return required.some((entitlement) => entitlements?.[entitlement] === true);
  }
  return entitlements?.[channel.access as DyoorWorldEntitlementKey] === true;
}

export function dyoorWorldChannelsForEntitlements(
  entitlements: Partial<DyoorWorldEntitlements> | null | undefined,
) {
  return DYOOR_WORLD_CHANNELS.filter((channel) => (
    canAccessDyoorWorldChannel(channel.id, entitlements)
  ));
}

export function worldChannelFromTag(value: unknown): DyoorWorldChannelId | null {
  const tag = String(value || "").trim().replace(/^#/, "").toLowerCase();
  return DYOOR_WORLD_CHANNELS.find((channel) => channel.label === tag)?.id || null;
}

export function parseWorldMessageLink(value: unknown) {
  let label = String(value || "").trim();
  if (!label || label.length > 2_048) return null;

  let trailing = "";
  while (/[.,!?;:)\]}]$/.test(label)) {
    trailing = `${label.slice(-1)}${trailing}`;
    label = label.slice(0, -1);
  }

  try {
    const link = new URL(label);
    if (
      link.protocol !== "https:"
      || !link.hostname
      || link.username
      || link.password
    ) {
      return null;
    }
    return {
      href: link.href,
      label,
      trailing,
    };
  } catch {
    return null;
  }
}

export function isWorldWritableChannel(value: unknown): value is DyoorWorldChannelId {
  return DYOOR_WORLD_CHANNELS.some((channel) => channel.id === value && !channel.readOnly);
}

export function isWorldOwnerChannel(value: unknown): value is DyoorWorldChannelId {
  return value === "announcements";
}

function validClaim(claim: DyoorWorldNameClaim) {
  return Boolean(
    claim
      && claim.version === 1
      && claim.id
      && normalizeWorldWallet(claim.wallet)
      && validateWorldLabel(claim.label).ok
      && Number.isFinite(Date.parse(claim.createdAt)),
  );
}

export function resolveWorldNameClaims(claims: DyoorWorldNameClaim[]) {
  const byWallet = new Map<string, DyoorWorldNameClaim>();
  const byLabel = new Map<string, DyoorWorldNameClaim>();
  const accepted: DyoorWorldNameClaim[] = [];

  const ordered = claims
    .filter(validClaim)
    .map((claim) => ({
      ...claim,
      wallet: normalizeWorldWallet(claim.wallet),
      label: normalizeWorldLabel(claim.label),
    }))
    .sort((left, right) => {
      const created = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return created || left.id.localeCompare(right.id);
    });

  for (const claim of ordered) {
    if (byWallet.has(claim.wallet) || byLabel.has(claim.label)) continue;
    byWallet.set(claim.wallet, claim);
    byLabel.set(claim.label, claim);
    accepted.push(claim);
  }

  return { accepted, byWallet, byLabel };
}

export function worldProfileFromClaim(
  claim: DyoorWorldNameClaim,
  registryStatus: DyoorWorldProfile["registryStatus"] = "preview-reservation",
): DyoorWorldProfile {
  return {
    wallet: normalizeWorldWallet(claim.wallet),
    label: normalizeWorldLabel(claim.label),
    displayName: formatWorldName(claim.label),
    canonicalName: formatWorldCanonicalName(claim.label),
    createdAt: claim.createdAt,
    registryStatus,
  };
}

export function shortWorldWallet(wallet: string) {
  const normalized = normalizeWorldWallet(wallet);
  return normalized ? `${normalized.slice(0, 6)}…${normalized.slice(-4)}` : "unknown-holder";
}

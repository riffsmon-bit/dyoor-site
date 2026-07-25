export const DYOOR_WORLD_CHAIN_ID = 143;
export const DYOOR_WORLD_DISPLAY_SUFFIX = ".dYOOR";
export const DYOOR_WORLD_CANONICAL_SUFFIX = ".dyoor";
export const DYOOR_WORLD_SESSION_COOKIE = "dyoor_world_session";
export const DYOOR_WORLD_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const DYOOR_WORLD_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export const DYOOR_WORLD_CHANNELS = [
  {
    id: "world-lobby",
    label: "world-lobby",
    description: "The holder-only commons for D.Y.O.O.R.",
    readOnly: false,
  },
  {
    id: "trait-lab",
    label: "trait-lab",
    description: "Dynamic trait rolls, rarity finds, and build discussion.",
    readOnly: false,
  },
  {
    id: "energy-grid",
    label: "energy-grid",
    description: "Energy flywheel strategy, harvests, and ecosystem signals.",
    readOnly: false,
  },
  {
    id: "trade-desk",
    label: "trade-desk",
    description: "Non-custodial S2 swaps coordinated by the World escrow.",
    readOnly: false,
  },
  {
    id: "sales-feed",
    label: "sales-feed",
    description: "Verified D.Y.O.O.R sales transmitted by the World sales bot.",
    readOnly: true,
  },
  {
    id: "tip-ledger",
    label: "tip-ledger",
    description: "Verified direct MON tips between World holders.",
    readOnly: true,
  },
  {
    id: "burn-log",
    label: "burn-log",
    description: "Permanent S2 burns and deflationary collection history.",
    readOnly: true,
  },
] as const;

export type DyoorWorldChannelId = (typeof DYOOR_WORLD_CHANNELS)[number]["id"];
export type DyoorWorldMessageKind = "user" | "system" | "sale" | "tip" | "trade" | "burn";

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
  version: 1 | 2;
  id: string;
  channelId: DyoorWorldChannelId;
  wallet: string;
  content: string;
  createdAt: string;
  kind?: DyoorWorldMessageKind;
  systemAuthor?: string;
  data?: Record<string, string | number | boolean | null>;
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

export function isWorldWritableChannel(value: unknown): value is DyoorWorldChannelId {
  return DYOOR_WORLD_CHANNELS.some((channel) => channel.id === value && !channel.readOnly);
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

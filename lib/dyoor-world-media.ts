export const DYOOR_WORLD_STICKERS = [
  {
    id: "gm-droid",
    label: "GM, DROID",
    signal: "SIGNAL ONLINE",
    imageUrl: "/dyoor-world/stickers/gm-droid.webp",
  },
  {
    id: "charged-up",
    label: "CHARGED UP",
    signal: "ENERGY GRID",
    imageUrl: "/dyoor-world/stickers/charged-up.webp",
  },
  {
    id: "diamond-droid",
    label: "DIAMOND DROID",
    signal: "HOLD THE LINE",
    imageUrl: "/dyoor-world/stickers/diamond-droid.webp",
  },
  {
    id: "burn-verified",
    label: "BURN VERIFIED",
    signal: "SUPPLY DOWN",
    imageUrl: "/dyoor-world/stickers/burn-verified.webp",
  },
  {
    id: "send-it",
    label: "SEND IT",
    signal: "MONAD MODE",
    imageUrl: "/dyoor-world/stickers/send-it.webp",
  },
] as const;

export type DyoorWorldStickerId = (typeof DYOOR_WORLD_STICKERS)[number]["id"];

export type DyoorWorldMessageAttachment =
  | {
      kind: "image" | "gif";
      url: string;
      alt?: string;
    }
  | {
      kind: "sticker";
      stickerId: DyoorWorldStickerId;
    };

export type DyoorWorldMediaAttachment = Extract<
  DyoorWorldMessageAttachment,
  { kind: "image" | "gif" }
>;

const WORLD_STICKER_IDS = new Set<string>(
  DYOOR_WORLD_STICKERS.map((sticker) => sticker.id),
);

const EXTENSIONLESS_MEDIA_HOSTS = new Set([
  "cdn.discordapp.com",
  "i.giphy.com",
  "i.imgur.com",
  "images.unsplash.com",
  "media.discordapp.net",
  "media.giphy.com",
  "media.tenor.com",
  "static.klipy.co",
  "static.klipy.com",
  "static2.klipy.co",
  "static2.klipy.com",
]);

const WORLD_MEDIA_ID_SOURCE = "[a-z0-9]{10}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const HOSTED_WORLD_MEDIA_PATH = new RegExp(
  `^/api/dyoor-world/media/0x[a-f0-9]{40}/${WORLD_MEDIA_ID_SOURCE}$`,
);

function isBlockedMediaHostname(hostnameValue: string) {
  const hostname = hostnameValue.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname === "::"
    || hostname === "::1"
    || hostname.includes(":")
  ) {
    return true;
  }

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || octets[0] >= 224
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isKnownMediaHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return Array.from(EXTENSIONLESS_MEDIA_HOSTS).some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  );
}

export function normalizeDyoorWorldMediaUrl(
  value: unknown,
): DyoorWorldMediaAttachment | null {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 1_200) return null;
  if (HOSTED_WORLD_MEDIA_PATH.test(raw)) {
    return {
      kind: "image",
      url: raw,
    };
  }

  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || isBlockedMediaHostname(url.hostname)
    ) {
      return null;
    }

    const path = url.pathname.toLowerCase();
    const extension = path.match(/\.([a-z0-9]+)$/)?.[1] || "";
    const supportedExtension = ["avif", "gif", "jpeg", "jpg", "png", "webp"].includes(extension);
    if (!supportedExtension && !isKnownMediaHost(url.hostname)) return null;

    const isGif = extension === "gif"
      || /(^|\.)giphy\.com$/i.test(url.hostname)
      || /(^|\.)tenor\.com$/i.test(url.hostname)
      || /(^|\.)klipy\.(?:co|com)$/i.test(url.hostname);
    return {
      kind: isGif ? "gif" : "image",
      url: url.toString(),
    };
  } catch {
    return null;
  }
}

export function dyoorWorldSticker(value: unknown) {
  const stickerId = String(value || "").trim();
  return DYOOR_WORLD_STICKERS.find((sticker) => sticker.id === stickerId) || null;
}

export function normalizeDyoorWorldAttachment(
  value: unknown,
): DyoorWorldMessageAttachment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.kind === "sticker") {
    const stickerId = String(input.stickerId || "").trim();
    if (!WORLD_STICKER_IDS.has(stickerId)) return null;
    return {
      kind: "sticker",
      stickerId: stickerId as DyoorWorldStickerId,
    };
  }

  if (input.kind !== "image" && input.kind !== "gif") return null;
  const media = normalizeDyoorWorldMediaUrl(input.url);
  if (!media) return null;
  const alt = String(input.alt || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 120);
  return {
    ...media,
    ...(alt ? { alt } : {}),
  };
}

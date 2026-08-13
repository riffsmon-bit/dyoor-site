import type { CharacterProfile, Direction, Trait } from "../../types/game";

export const METADATA_SPRITE_SPEC_VERSION = "dyoor-metadata-overworld-v3-halogen-silhouette";

export type PixelSurface = {
  rect: (
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ) => void;
};

export type ClothingKind =
  | "none"
  | "tee"
  | "hoodie"
  | "suit"
  | "coat"
  | "fur"
  | "robe"
  | "overalls"
  | "racer"
  | "striped";

export type EyeKind =
  | "default"
  | "intense"
  | "excited"
  | "scared"
  | "glasses"
  | "laser"
  | "cyclops"
  | "third-eye"
  | "patch"
  | "vr"
  | "glow";

export type MouthKind =
  | "default"
  | "frown"
  | "open"
  | "tongue"
  | "grill"
  | "fangs"
  | "braces"
  | "smoke"
  | "drool"
  | "gold"
  | "kiss";

export type HatKind =
  | "none"
  | "halo"
  | "cap"
  | "beanie"
  | "crown"
  | "horns"
  | "antenna"
  | "party"
  | "cowboy"
  | "pirate"
  | "helmet"
  | "mask"
  | "headband";

export type AccessoryKind =
  | "none"
  | "chain"
  | "bandana"
  | "bandaid"
  | "companion"
  | "hive";

export type SpecialKind =
  | "none"
  | "space-suit"
  | "deep-sea"
  | "ski-mask"
  | "anime-mask"
  | "gimp";

export type MetadataDroidVisual = {
  traitValues: Record<string, string>;
  body: string;
  bodyShadow: string;
  bodyHighlight: string;
  outline: string;
  eye: string;
  accent: string;
  chrome: boolean;
  condition: "none" | "dirty" | "broken" | "s1";
  sticker: "none" | "face" | "chest";
  clothing: {
    kind: ClothingKind;
    color: string;
    shadow: string;
    trim: string;
  };
  eyes: {
    kind: EyeKind;
    color: string;
  };
  mouth: {
    kind: MouthKind;
    color: string;
  };
  hat: {
    kind: HatKind;
    color: string;
    trim: string;
  };
  accessories: Array<{
    kind: AccessoryKind;
    color: string;
  }>;
  special: SpecialKind;
  signature: number;
};

const NONE = /^none$/i;
const OUTLINE = "#070912";
const WHITE = "#fff8dc";
const DARK_METAL = "#4c586c";

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function valueFor(traits: Trait[], traitType: string) {
  return traits.find((trait) => trait.traitType.trim().toLowerCase() === traitType.toLowerCase())
    ?.value
    ?.trim() || "None";
}

function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function parseHex(color: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match?.[1]) return { red: 128, green: 128, blue: 128 };
  const value = Number.parseInt(match[1], 16);
  return {
    red: (value >> 16) & 0xff,
    green: (value >> 8) & 0xff,
    blue: value & 0xff,
  };
}

function shade(color: string, amount: number) {
  const { red, green, blue } = parseHex(color);
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value + amount)));
  return `#${[channel(red), channel(green), channel(blue)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function deterministicColor(value: string) {
  const palette = [
    "#35d9ce",
    "#7757e8",
    "#ef4f62",
    "#edb73e",
    "#4f9ff5",
    "#d953cf",
    "#6bd44b",
    "#e27b38",
  ];
  return palette[hashString(value) % palette.length] || "#35d9ce";
}

function semanticColor(value: string, fallback = deterministicColor(value)) {
  const name = normalized(value);
  if (/gold/.test(name)) return "#e5ad2f";
  if (/baby blue/.test(name)) return "#75d6ee";
  if (/blue/.test(name)) return "#309add";
  if (/lime/.test(name)) return "#5ce53f";
  if (/olive/.test(name)) return "#718c3a";
  if (/green/.test(name)) return "#38b968";
  if (/rose|pink|pank|pernk/.test(name)) return "#db4fa2";
  if (/purple|monad/.test(name)) return "#7d56e7";
  if (/orange|yorange/.test(name)) return "#e7822d";
  if (/red/.test(name)) return "#df3447";
  if (/yellow/.test(name)) return "#e6d044";
  if (/white|whyte|hawhyte/.test(name)) return "#e8edf1";
  if (/beige/.test(name)) return "#c5a978";
  if (/grey|gray/.test(name)) return "#9299a6";
  if (/black|dark/.test(name)) return "#252633";
  return fallback;
}

function bodyPalette(value: string) {
  const name = normalized(value);
  const chrome = name.includes("chrome");
  let body = semanticColor(value, "#50d974");
  if (name.includes("optimus")) body = "#d9363e";
  if (name === "black") body = "#252936";
  if (name === "white") body = "#e9ecec";
  if (chrome) body = shade(body, 24);
  return {
    body,
    shadow: shade(body, chrome ? -62 : -52),
    highlight: shade(body, chrome ? 72 : 42),
    chrome,
  };
}

function clothingKind(value: string): ClothingKind {
  const name = normalized(value);
  if (NONE.test(name)) return "none";
  if (/fur coat/.test(name)) return "fur";
  if (/hoodie/.test(name)) return "hoodie";
  if (/tuxedo|shirt w:tie|tech bro/.test(name)) return "suit";
  if (/lab coat|jacket|dictator/.test(name)) return "coat";
  if (/king|robe|luffy|cape|caveman/.test(name)) return "robe";
  if (/overall/.test(name)) return "overalls";
  if (/racer/.test(name)) return "racer";
  if (/plaid|stripe|convict|jailhouse/.test(name)) return "striped";
  return "tee";
}

function eyeKind(value: string): EyeKind {
  const name = normalized(value);
  if (/laser/.test(name)) return "laser";
  if (/vr headset/.test(name)) return "vr";
  if (/cyclops/.test(name)) return "cyclops";
  if (/third eye/.test(name)) return "third-eye";
  if (/eye patch/.test(name)) return "patch";
  if (/glow|zombie|abyss/.test(name)) return "glow";
  if (/spec|glasses|sunglasses|pit viper|ricky v|neverland/.test(name)) return "glasses";
  if (/scared/.test(name)) return "scared";
  if (/intense|snake|sly|eyeliner|know what/.test(name)) return "intense";
  if (/excited|googley|got em/.test(name)) return "excited";
  return "default";
}

function mouthKind(value: string): MouthKind {
  const name = normalized(value);
  if (/diamond grill|gold grill/.test(name)) return "grill";
  if (/fang/.test(name)) return "fangs";
  if (/brace/.test(name)) return "braces";
  if (/tongue/.test(name)) return "tongue";
  if (/drool/.test(name)) return "drool";
  if (/cigar|cigarette|joint|pipe|toothpick/.test(name)) return "smoke";
  if (/gold bar/.test(name)) return "gold";
  if (/muah/.test(name)) return "kiss";
  if (/ahhh|waa|ayee|ayeyo|party horn|pepe/.test(name)) return "open";
  if (/displeased|emo|meh|errrh|deep thought|un enthused/.test(name)) return "frown";
  return "default";
}

function hatKind(value: string): HatKind {
  const name = normalized(value);
  if (NONE.test(name)) return "none";
  if (/halo/.test(name)) return "halo";
  if (/crown|casino/.test(name)) return "crown";
  if (/horn/.test(name)) return "horns";
  if (/antenna|wormhole|burning chog/.test(name)) return "antenna";
  if (/party|dunce/.test(name)) return "party";
  if (/cowboy/.test(name)) return "cowboy";
  if (/pirate|captain/.test(name)) return "pirate";
  if (/construction/.test(name)) return "helmet";
  if (/mask|shystie|emonad|salmonad|pampam|bartman/.test(name)) return "mask";
  if (/sweatband|durag|alternative/.test(name)) return "headband";
  if (/beanie/.test(name)) return "beanie";
  return "cap";
}

function accessoryKind(value: string): AccessoryKind {
  const name = normalized(value);
  if (NONE.test(name)) return "none";
  if (/chain|choker/.test(name)) return "chain";
  if (/bandana/.test(name)) return "bandana";
  if (/bandaid/.test(name)) return "bandaid";
  if (/hive/.test(name)) return "hive";
  return "companion";
}

function specialKind(value: string): SpecialKind {
  const name = normalized(value);
  if (NONE.test(name)) return "none";
  if (/space suit/.test(name)) return "space-suit";
  if (/deepsea/.test(name)) return "deep-sea";
  if (/ski mask/.test(name)) return "ski-mask";
  if (/anime mask/.test(name)) return "anime-mask";
  return "gimp";
}

export function buildMetadataDroidVisual(traits: Trait[]): MetadataDroidVisual {
  const traitValues = Object.fromEntries(
    traits.map((trait) => [trait.traitType.trim(), trait.value.trim()]),
  );
  const droidValue = valueFor(traits, "Droid");
  const clothesValue = valueFor(traits, "Clothes");
  const eyesValue = valueFor(traits, "Eyes");
  const mouthValue = valueFor(traits, "Mouth");
  const hatValue = valueFor(traits, "Hat");
  const conditionValue = valueFor(traits, "Conditions");
  const stickerValue = valueFor(traits, "Stickers/Body art");
  const specialValue = valueFor(traits, "Special");
  const body = bodyPalette(droidValue);
  const clothingColor = semanticColor(clothesValue, deterministicColor(clothesValue));
  const hatColor = semanticColor(hatValue, deterministicColor(hatValue));
  const conditionName = normalized(conditionValue);
  const accessories = ["Accessories", "Accessories 2"].map((traitType) => {
    const value = valueFor(traits, traitType);
    return {
      kind: accessoryKind(value),
      color: semanticColor(value, deterministicColor(value)),
    };
  }).filter((entry) => entry.kind !== "none");

  return {
    traitValues,
    body: body.body,
    bodyShadow: body.shadow,
    bodyHighlight: body.highlight,
    outline: OUTLINE,
    eye: WHITE,
    accent: deterministicColor(`${droidValue}:${clothesValue}:${hatValue}`),
    chrome: body.chrome,
    condition: /s1 skin/.test(conditionName)
      ? "s1"
      : /broken/.test(conditionName)
        ? "broken"
        : /dirty/.test(conditionName)
          ? "dirty"
          : "none",
    sticker: /face/.test(normalized(stickerValue))
      ? "face"
      : NONE.test(stickerValue)
        ? "none"
        : "chest",
    clothing: {
      kind: clothingKind(clothesValue),
      color: clothingColor,
      shadow: shade(clothingColor, -54),
      trim: /gold/.test(normalized(clothesValue))
        ? "#f2c84b"
        : /white/.test(normalized(clothesValue))
          ? "#f4f2e8"
          : shade(clothingColor, 58),
    },
    eyes: {
      kind: eyeKind(eyesValue),
      color: /radiation|laser/.test(normalized(eyesValue)) ? "#ff374f" : "#9b72ff",
    },
    mouth: {
      kind: mouthKind(mouthValue),
      color: /gold/.test(normalized(mouthValue)) ? "#f3c74c" : "#48e6ef",
    },
    hat: {
      kind: hatKind(hatValue),
      color: hatColor,
      trim: /halo|crown|casino/.test(normalized(hatValue)) ? "#ffd84e" : shade(hatColor, 56),
    },
    accessories,
    special: specialKind(specialValue),
    signature: hashString(JSON.stringify(traitValues)),
  };
}

export function metadataSpriteTextureKey(profile: CharacterProfile) {
  const identity = profile.tokenId ? `token-${profile.tokenId}` : profile.id;
  const safeIdentity = identity.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 48);
  const safeHash = profile.traitHash.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(-32);
  return `droid-meta-${safeIdentity}-${safeHash || "traits"}`;
}

function px(
  surface: PixelSurface,
  originX: number,
  originY: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
) {
  surface.rect(originX + x, originY + y, width, height, color);
}

function drawLegs(
  surface: PixelSurface,
  ox: number,
  oy: number,
  stride: number,
  visual: MetadataDroidVisual,
) {
  const legColor = visual.special === "space-suit" ? "#d9e7ef" : DARK_METAL;
  px(surface, ox, oy, 27 + stride, 49, 4, 8, visual.outline);
  px(surface, ox, oy, 34 - stride, 49, 4, 8, visual.outline);
  px(surface, ox, oy, 28 + stride, 50, 2, 6, legColor);
  px(surface, ox, oy, 35 - stride, 50, 2, 6, legColor);
  px(surface, ox, oy, 28 + stride, 52, 2, 1, visual.bodyHighlight);
  px(surface, ox, oy, 35 - stride, 52, 2, 1, visual.bodyHighlight);
  px(surface, ox, oy, 24 + stride, 56, 8, 2, visual.outline);
  px(surface, ox, oy, 33 - stride, 56, 8, 2, visual.outline);
  px(surface, ox, oy, 25 + stride, 55, 7, 2, visual.clothing.color);
  px(surface, ox, oy, 33 - stride, 55, 7, 2, visual.clothing.color);
}

function drawNeck(
  surface: PixelSurface,
  ox: number,
  oy: number,
  visual: MetadataDroidVisual,
) {
  px(surface, ox, oy, 29, 33, 6, 8, visual.outline);
  px(surface, ox, oy, 31, 34, 2, 7, DARK_METAL);
  px(surface, ox, oy, 30, 35, 4, 1, visual.bodyHighlight);
  px(surface, ox, oy, 30, 38, 4, 1, visual.bodyShadow);
}

function drawTorso(
  surface: PixelSurface,
  ox: number,
  oy: number,
  direction: Direction,
  visual: MetadataDroidVisual,
) {
  const { clothing } = visual;
  const back = direction === "up";
  if (clothing.kind === "none") {
    px(surface, ox, oy, 26, 39, 12, 12, visual.outline);
    px(surface, ox, oy, 28, 40, 8, 10, visual.body);
    px(surface, ox, oy, 28, 48, 8, 2, visual.bodyShadow);
  } else if (clothing.kind === "fur") {
    px(surface, ox, oy, 19, 38, 26, 13, visual.outline);
    px(surface, ox, oy, 21, 38, 22, 11, clothing.color);
    px(surface, ox, oy, 18, 41, 5, 6, clothing.color);
    px(surface, ox, oy, 41, 41, 5, 6, clothing.color);
    px(surface, ox, oy, 21, 48, 5, 4, clothing.shadow);
    px(surface, ox, oy, 29, 47, 5, 5, clothing.shadow);
    px(surface, ox, oy, 38, 48, 5, 4, clothing.shadow);
    px(surface, ox, oy, 22, 39, 2, 3, clothing.trim);
    px(surface, ox, oy, 31, 40, 2, 3, clothing.trim);
    px(surface, ox, oy, 40, 39, 2, 3, clothing.trim);
  } else {
    const width = clothing.kind === "robe" || clothing.kind === "coat" ? 20 : 16;
    const left = 32 - Math.floor(width / 2);
    const height = clothing.kind === "robe" ? 13 : 11;
    px(surface, ox, oy, left - 2, 39, width + 4, height + 2, visual.outline);
    px(surface, ox, oy, left, 40, width, height, clothing.color);
    px(surface, ox, oy, left, 48, width, Math.max(2, height - 8), clothing.shadow);
    if (clothing.kind === "hoodie") {
      px(surface, ox, oy, 24, 35, 16, 6, visual.outline);
      px(surface, ox, oy, 26, 36, 12, 4, clothing.shadow);
      if (!back) {
        px(surface, ox, oy, 29, 41, 1, 5, clothing.trim);
        px(surface, ox, oy, 34, 41, 1, 5, clothing.trim);
      }
    }
    if (clothing.kind === "suit" && !back) {
      px(surface, ox, oy, 27, 40, 10, 3, "#f1eee7");
      px(surface, ox, oy, 31, 42, 3, 7, clothing.trim);
    }
    if (clothing.kind === "overalls" && !back) {
      px(surface, ox, oy, 27, 39, 2, 10, clothing.trim);
      px(surface, ox, oy, 35, 39, 2, 10, clothing.trim);
      px(surface, ox, oy, 28, 44, 8, 6, clothing.shadow);
    }
    if (clothing.kind === "racer") {
      px(surface, ox, oy, 25, 41, 14, 2, clothing.trim);
      px(surface, ox, oy, 30, 40, 4, 11, clothing.trim);
    }
    if (clothing.kind === "striped") {
      px(surface, ox, oy, left, 42, width, 2, clothing.trim);
      px(surface, ox, oy, left, 47, width, 2, clothing.trim);
    }
    if (clothing.kind === "coat" && !back) {
      px(surface, ox, oy, 31, 40, 2, height, clothing.trim);
    }
    if (clothing.kind === "robe") {
      px(surface, ox, oy, left - 2, 50, width + 4, 4, clothing.shadow);
    }
  }

  const sleeve = clothing.kind === "none" ? visual.body : clothing.color;
  px(surface, ox, oy, 21, 40, 4, 9, visual.outline);
  px(surface, ox, oy, 39, 40, 4, 9, visual.outline);
  px(surface, ox, oy, 22, 41, 2, 7, sleeve);
  px(surface, ox, oy, 40, 41, 2, 7, sleeve);
  px(surface, ox, oy, 21, 48, 4, 4, visual.outline);
  px(surface, ox, oy, 39, 48, 4, 4, visual.outline);
  px(surface, ox, oy, 22, 49, 2, 2, visual.body);
  px(surface, ox, oy, 40, 49, 2, 2, visual.body);
}

function drawHead(
  surface: PixelSurface,
  ox: number,
  oy: number,
  direction: Direction,
  visual: MetadataDroidVisual,
) {
  const sideOffset = direction === "left" ? -1 : direction === "right" ? 1 : 0;
  // Shared Dr. Halogen-style anatomy: a stepped capsule head rather than a
  // rectangular humanoid block. Every metadata combination uses this anchor.
  px(surface, ox, oy, 27 + sideOffset, 4, 10, 2, visual.outline);
  px(surface, ox, oy, 25 + sideOffset, 6, 14, 3, visual.outline);
  px(surface, ox, oy, 24 + sideOffset, 9, 16, 20, visual.outline);
  px(surface, ox, oy, 25 + sideOffset, 29, 14, 4, visual.outline);
  px(surface, ox, oy, 27 + sideOffset, 33, 10, 2, visual.outline);
  px(surface, ox, oy, 27 + sideOffset, 6, 10, 3, visual.body);
  px(surface, ox, oy, 26 + sideOffset, 9, 12, 20, visual.body);
  px(surface, ox, oy, 27 + sideOffset, 29, 10, 4, visual.body);
  px(surface, ox, oy, 26 + sideOffset, 10, 2, 18, visual.bodyShadow);
  px(surface, ox, oy, 36 + sideOffset, 9, 2, 18, visual.bodyHighlight);
  px(surface, ox, oy, 28 + sideOffset, 6, 7, 1, visual.bodyHighlight);
  const earX = direction === "right" ? 39 : 21;
  px(surface, ox, oy, earX, 19, 4, 7, visual.outline);
  px(surface, ox, oy, earX + 1, 21, 2, 3, visual.bodyShadow);

  if (visual.chrome) {
    px(surface, ox, oy, 29 + sideOffset, 10, 1, 18, visual.bodyHighlight);
    px(surface, ox, oy, 35 + sideOffset, 8, 1, 7, "#f5f7f1");
  }
  if (visual.condition === "dirty") {
    px(surface, ox, oy, 27, 11, 2, 2, "#5e4933");
    px(surface, ox, oy, 35, 27, 3, 2, "#5e4933");
  }
  if (visual.condition === "broken") {
    px(surface, ox, oy, 26, 10, 4, 1, visual.outline);
    px(surface, ox, oy, 29, 11, 1, 4, visual.outline);
    px(surface, ox, oy, 34, 28, 4, 1, visual.outline);
  }
  if (visual.condition === "s1") {
    px(surface, ox, oy, 27, 10, 10, 2, "#63ffe4");
    px(surface, ox, oy, 36, 12, 1, 14, "#7f55ff");
  }
}

function drawEyes(
  surface: PixelSurface,
  ox: number,
  oy: number,
  direction: Direction,
  visual: MetadataDroidVisual,
) {
  if (direction === "up") {
    px(surface, ox, oy, 26, 11, 12, 2, visual.bodyShadow);
    return;
  }
  const side = direction !== "down";
  const eyeXs = side
    ? [direction === "left" ? 24 : 32]
    : [24, 32];
  if (visual.eyes.kind === "cyclops") {
    px(surface, ox, oy, side ? eyeXs[0] || 27 : 28, 14, 8, 8, visual.outline);
    px(surface, ox, oy, side ? (eyeXs[0] || 27) + 2 : 30, 16, 4, 4, visual.eyes.color);
    return;
  }
  for (const eyeX of eyeXs) {
    const y = visual.eyes.kind === "intense" ? 15 : 14;
    px(surface, ox, oy, eyeX, y, 8, 8, visual.outline);
    px(surface, ox, oy, eyeX + 1, y + 1, 6, 6, visual.eye);
    const pupilX = direction === "left" ? eyeX + 2 : direction === "right" ? eyeX + 5 : eyeX + 3;
    const pupilY = visual.eyes.kind === "scared" ? y + 3 : y + 4;
    px(surface, ox, oy, pupilX, pupilY, 2, 2, visual.outline);
    if (visual.eyes.kind === "excited") px(surface, ox, oy, eyeX + 2, y + 2, 2, 2, "#ffffff");
  }
  if (visual.eyes.kind === "intense") {
    px(surface, ox, oy, side ? eyeXs[0] || 24 : 24, 14, side ? 8 : 16, 2, visual.outline);
  }
  if (["glasses", "vr"].includes(visual.eyes.kind)) {
    const left = side ? eyeXs[0] || 24 : 23;
    const width = side ? 9 : 18;
    px(surface, ox, oy, left, 14, width, visual.eyes.kind === "vr" ? 8 : 2, visual.outline);
    if (visual.eyes.kind === "glasses") {
      px(surface, ox, oy, left + 1, 15, side ? 8 : 7, 6, "#6ee7ef");
      if (!side) px(surface, ox, oy, left + 10, 15, 7, 6, "#6ee7ef");
    } else {
      px(surface, ox, oy, left + 1, 15, width - 2, 6, "#724bdf");
    }
  }
  if (visual.eyes.kind === "laser") {
    const beamColor = visual.eyes.color;
    if (direction === "down") {
      px(surface, ox, oy, 24, 17, 16, 2, beamColor);
      px(surface, ox, oy, 21, 18, 22, 1, "#ffb0b8");
    } else {
      const start = direction === "left" ? 18 : 39;
      px(surface, ox, oy, start, 17, 8, 2, beamColor);
    }
  }
  if (visual.eyes.kind === "glow") {
    for (const eyeX of eyeXs) px(surface, ox, oy, eyeX + 1, 15, 6, 6, visual.eyes.color);
  }
  if (visual.eyes.kind === "patch") {
    const patchX = side ? eyeXs[0] || 24 : 24;
    px(surface, ox, oy, patchX, 14, 8, 8, visual.outline);
    px(surface, ox, oy, patchX - 1, 13, side ? 11 : 20, 1, visual.outline);
  }
  if (visual.eyes.kind === "third-eye" && direction === "down") {
    px(surface, ox, oy, 30, 10, 4, 3, visual.outline);
    px(surface, ox, oy, 31, 11, 2, 1, visual.eyes.color);
  }
}

function drawMouth(
  surface: PixelSurface,
  ox: number,
  oy: number,
  direction: Direction,
  visual: MetadataDroidVisual,
) {
  if (direction === "up") return;
  const left = direction === "left" ? 25 : direction === "right" ? 33 : 27;
  const width = direction === "down" ? 10 : 6;
  const { kind } = visual.mouth;
  if (kind === "open" || kind === "tongue") {
    px(surface, ox, oy, left, 25, width, 6, visual.outline);
    px(surface, ox, oy, left + 2, 27, Math.max(3, width - 4), 3, "#7d1e38");
    if (kind === "tongue") px(surface, ox, oy, left + 3, 29, Math.max(2, width - 6), 3, "#f15b83");
    return;
  }
  px(surface, ox, oy, left, 26, width, 3, visual.outline);
  if (kind === "frown") {
    px(surface, ox, oy, left + 2, 25, Math.max(2, width - 4), 1, visual.outline);
  } else if (kind === "grill" || kind === "braces") {
    px(surface, ox, oy, left + 1, 26, width - 2, 3, kind === "grill" ? "#e9f7f8" : "#b7cad5");
    for (let x = left + 3; x < left + width - 1; x += 3) px(surface, ox, oy, x, 26, 1, 3, "#59636c");
  } else if (kind === "fangs") {
    px(surface, ox, oy, left + 2, 27, 2, 3, "#ffffff");
    px(surface, ox, oy, left + width - 4, 27, 2, 3, "#ffffff");
  } else if (kind === "gold") {
    px(surface, ox, oy, left + 2, 26, width - 4, 3, visual.mouth.color);
  } else if (kind === "kiss") {
    px(surface, ox, oy, left + 4, 25, Math.max(2, width - 8), 4, "#ed4f91");
  }
  if (kind === "drool") {
    px(surface, ox, oy, left + width - 3, 28, 2, 4, visual.mouth.color);
    px(surface, ox, oy, left + width - 2, 31, 2, 2, "#7ff8ff");
  }
  if (kind === "smoke") {
    const itemX = direction === "left" ? left - 4 : left + width - 1;
    px(surface, ox, oy, itemX, 27, 6, 1, "#d6b17d");
    px(surface, ox, oy, itemX + (direction === "left" ? -2 : 6), 25, 2, 2, "#d8dde7");
  }
}

function drawHat(
  surface: PixelSurface,
  ox: number,
  oy: number,
  direction: Direction,
  visual: MetadataDroidVisual,
) {
  const { hat } = visual;
  if (hat.kind === "none") return;
  if (hat.kind === "halo") {
    px(surface, ox, oy, 25, 1, 14, 1, visual.outline);
    px(surface, ox, oy, 22, 2, 20, 3, visual.outline);
    px(surface, ox, oy, 24, 2, 16, 1, hat.trim);
    px(surface, ox, oy, 25, 4, 14, 1, hat.trim);
    return;
  }
  if (hat.kind === "horns") {
    px(surface, ox, oy, 21, 3, 5, 5, visual.outline);
    px(surface, ox, oy, 38, 3, 5, 5, visual.outline);
    px(surface, ox, oy, 22, 2, 3, 5, "#efe2c2");
    px(surface, ox, oy, 39, 2, 3, 5, "#efe2c2");
    return;
  }
  if (hat.kind === "antenna") {
    px(surface, ox, oy, 31, 0, 2, 7, visual.outline);
    px(surface, ox, oy, 30, 0, 4, 3, hat.trim);
    return;
  }
  if (hat.kind === "crown") {
    px(surface, ox, oy, 22, 2, 20, 6, visual.outline);
    px(surface, ox, oy, 24, 3, 16, 4, hat.trim);
    px(surface, ox, oy, 24, 0, 3, 4, hat.trim);
    px(surface, ox, oy, 31, 0, 3, 4, hat.trim);
    px(surface, ox, oy, 38, 0, 3, 4, hat.trim);
    return;
  }
  if (hat.kind === "party") {
    px(surface, ox, oy, 26, 0, 12, 7, visual.outline);
    px(surface, ox, oy, 28, 1, 8, 6, hat.color);
    px(surface, ox, oy, 31, 0, 3, 2, hat.trim);
    return;
  }
  if (hat.kind === "cowboy" || hat.kind === "pirate") {
    px(surface, ox, oy, 19, 4, 26, 4, visual.outline);
    px(surface, ox, oy, 22, 2, 20, 5, hat.color);
    px(surface, ox, oy, 20, 5, 24, 2, hat.trim);
    return;
  }
  if (hat.kind === "mask") {
    px(surface, ox, oy, 21, 6, 22, 18, visual.outline);
    px(surface, ox, oy, 23, 7, 18, 16, hat.color);
    return;
  }
  if (hat.kind === "headband") {
    px(surface, ox, oy, 21, 7, 22, 4, visual.outline);
    px(surface, ox, oy, 23, 8, 18, 2, hat.color);
    return;
  }
  if (hat.kind === "helmet") {
    px(surface, ox, oy, 20, 3, 24, 7, visual.outline);
    px(surface, ox, oy, 22, 4, 20, 5, hat.color);
    px(surface, ox, oy, 18, 8, 28, 3, hat.trim);
    return;
  }
  if (hat.kind === "beanie") {
    px(surface, ox, oy, 21, 3, 22, 7, visual.outline);
    px(surface, ox, oy, 23, 4, 18, 5, hat.color);
    px(surface, ox, oy, 20, 8, 24, 3, hat.trim);
    return;
  }
  // Cap: direction-sensitive brim preserves asymmetrical identity.
  px(surface, ox, oy, 21, 3, 22, 7, visual.outline);
  px(surface, ox, oy, 23, 4, 18, 5, hat.color);
  const brimX = direction === "left" ? 16 : direction === "right" ? 37 : 18;
  px(surface, ox, oy, brimX, 8, direction === "down" ? 28 : 11, 3, visual.outline);
  px(surface, ox, oy, brimX + 1, 8, direction === "down" ? 26 : 9, 2, hat.trim);
}

function drawAccessories(
  surface: PixelSurface,
  ox: number,
  oy: number,
  direction: Direction,
  visual: MetadataDroidVisual,
) {
  visual.accessories.forEach((accessory, index) => {
    if (accessory.kind === "chain" && direction !== "up") {
      px(surface, ox, oy, 27 + index, 39, 10, 1, "#f5cc48");
      px(surface, ox, oy, 31, 40, 3, 4, accessory.color);
    } else if (accessory.kind === "bandana") {
      px(surface, ox, oy, 23, 34 + index, 18, 3, visual.outline);
      px(surface, ox, oy, 25, 35 + index, 14, 1, accessory.color);
    } else if (accessory.kind === "bandaid" && direction !== "up") {
      const x = direction === "right" ? 36 : 25;
      px(surface, ox, oy, x, 24, 6, 2, "#e8b07b");
      px(surface, ox, oy, x + 2, 24, 2, 2, "#8a5b43");
    } else if (accessory.kind === "hive") {
      px(surface, ox, oy, 12 + index * 36, 38, 7, 7, visual.outline);
      px(surface, ox, oy, 14 + index * 36, 40, 3, 3, "#f2c740");
    } else if (accessory.kind === "companion") {
      const side = index % 2 === 0 ? 12 : 46;
      px(surface, ox, oy, side, 36, 8, 10, visual.outline);
      px(surface, ox, oy, side + 2, 37, 5, 7, accessory.color);
      px(surface, ox, oy, side + 3, 39, 1, 1, "#ffffff");
      px(surface, ox, oy, side + 5, 39, 1, 1, "#ffffff");
    }
  });
}

function drawDetails(
  surface: PixelSurface,
  ox: number,
  oy: number,
  direction: Direction,
  visual: MetadataDroidVisual,
) {
  if (visual.sticker === "face" && direction !== "up") {
    px(surface, ox, oy, direction === "right" ? 36 : 26, 23, 4, 4, "#ffda48");
  }
  if (visual.sticker === "chest" && direction !== "up") {
    px(surface, ox, oy, 30, 44, 5, 4, "#4dffe3");
    px(surface, ox, oy, 31, 45, 3, 2, "#7d55ff");
  }
  if (visual.special === "space-suit") {
    px(surface, ox, oy, 19, 4, 26, 31, "#b7d9e5");
    px(surface, ox, oy, 21, 6, 22, 27, visual.outline);
    px(surface, ox, oy, 23, 8, 18, 23, "#345f75");
  } else if (visual.special === "deep-sea") {
    px(surface, ox, oy, 18, 4, 28, 31, "#d6a83f");
    px(surface, ox, oy, 21, 7, 22, 25, visual.outline);
    px(surface, ox, oy, 24, 10, 16, 19, "#264a61");
  } else if (visual.special === "ski-mask") {
    px(surface, ox, oy, 22, 7, 20, 22, "#2b2536");
    if (direction !== "up") px(surface, ox, oy, 24, 14, 16, 8, "#3fef70");
  } else if (visual.special === "anime-mask") {
    if (direction !== "up") {
      px(surface, ox, oy, 23, 13, 18, 17, "#ede9e0");
      px(surface, ox, oy, 25, 16, 4, 4, "#ed4f65");
      px(surface, ox, oy, 35, 16, 4, 4, "#ed4f65");
    }
  } else if (visual.special === "gimp") {
    px(surface, ox, oy, 22, 7, 20, 26, "#1e1d25");
    px(surface, ox, oy, 31, 8, 2, 24, "#a7a7ad");
  }
}

export function drawMetadataDroidFrame(
  surface: PixelSurface,
  originX: number,
  originY: number,
  direction: Direction,
  walkFrame: number,
  visual: MetadataDroidVisual,
) {
  const bob = walkFrame % 2;
  const stride = walkFrame === 1 ? -2 : walkFrame === 3 ? 2 : 0;
  const oy = originY + bob;
  drawLegs(surface, originX, oy, stride, visual);
  drawNeck(surface, originX, oy, visual);
  drawTorso(surface, originX, oy, direction, visual);
  drawHead(surface, originX, oy, direction, visual);
  drawEyes(surface, originX, oy, direction, visual);
  drawMouth(surface, originX, oy, direction, visual);
  drawHat(surface, originX, oy, direction, visual);
  drawAccessories(surface, originX, oy, direction, visual);
  drawDetails(surface, originX, oy, direction, visual);
}

import sharp from "sharp";

type DyoorWorldNameImageInput = {
  displayName: string;
  wallet: string;
};

const MARKETPLACE_IMAGE_SIZE = 3_000;
const PIXEL_GLYPHS: Record<string, readonly string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  ":": ["00000", "00110", "00110", "00000", "00110", "00110", "00000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function pixelGlyphPath(rows: readonly string[]) {
  const commands: string[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "1") {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x] === "1") x += 1;
      const length = x - start;
      commands.push(`M${start} ${y}h${length}v1h-${length}z`);
    }
  });
  return commands.join("");
}

const PIXEL_GLYPH_PATHS = Object.fromEntries(
  Object.entries(PIXEL_GLYPHS).map(([character, rows]) => [
    character,
    pixelGlyphPath(rows),
  ]),
);

export function dyoorWorldPixelTextSvg(input: {
  text: string;
  centerX: number;
  topY: number;
  maxWidth: number;
  height: number;
  fill: string;
  opacity?: number;
  preserveCase?: boolean;
}) {
  const text = String(input.text || "");
  const characters = [...text];
  if (characters.length === 0) return "";
  const baseWidth = Math.max(5, (characters.length * 6) - 1);
  const scale = Math.min(input.height / 7, input.maxWidth / baseWidth);
  const left = input.centerX - ((baseWidth * scale) / 2);
  const opacity = input.opacity === undefined ? 1 : input.opacity;
  const glyphs = characters.map((character, index) => {
    const normalizedCharacter = character.toUpperCase();
    const path = Object.hasOwn(PIXEL_GLYPH_PATHS, normalizedCharacter)
      ? PIXEL_GLYPH_PATHS[normalizedCharacter]
      : PIXEL_GLYPH_PATHS["?"];
    if (!path) return "";
    const isLowercase = Boolean(
      input.preserveCase
      && character >= "a"
      && character <= "z",
    );
    const lowercaseTransform = isLowercase
      ? " translate(0 1.47) scale(1 .79)"
      : "";
    return `<path d="${path}" transform="translate(${index * 6} 0)${lowercaseTransform}"/>`;
  }).join("");
  return [
    `<g aria-label="${escapeXml(text)}" fill="${input.fill}" fill-opacity="${opacity}"`,
    ` shape-rendering="geometricPrecision" transform="translate(${left} ${input.topY}) scale(${scale})">`,
    glyphs,
    "</g>",
  ].join("");
}

export function dyoorWorldNameSvg(input: DyoorWorldNameImageInput) {
  const displayName = escapeXml(String(input.displayName || ""));
  const wallet = escapeXml(String(input.wallet || ""));

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" role="img" aria-labelledby="title description">',
    `<title id="title">${displayName}</title>`,
    `<desc id="description">A soulbound dYOOR World holder identity owned by ${wallet}</desc>`,
    "<defs>",
    '<radialGradient id="background" cx="18%" cy="8%" r="110%"><stop stop-color="#203f52"/><stop offset=".42" stop-color="#11112b"/><stop offset="1" stop-color="#03030a"/></radialGradient>',
    '<linearGradient id="name" x1="0" x2="1"><stop stop-color="#77fff0"/><stop offset=".55" stop-color="#f3f1ff"/><stop offset="1" stop-color="#b99cff"/></linearGradient>',
    '<linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#39ffe2"/><stop offset=".48" stop-color="#836ef9"/><stop offset="1" stop-color="#ff4fd8"/></linearGradient>',
    '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
    '<pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#ffffff" stroke-opacity=".035" stroke-width="1"/></pattern>',
    "</defs>",
    '<rect width="1200" height="1200" fill="url(#background)"/>',
    '<rect width="1200" height="1200" fill="url(#grid)"/>',
    '<circle cx="108" cy="116" r="230" fill="#39ffe2" fill-opacity=".055"/>',
    '<circle cx="1100" cy="1060" r="310" fill="#836ef9" fill-opacity=".08"/>',
    '<rect x="42" y="42" width="1116" height="1116" rx="56" fill="none" stroke="url(#frame)" stroke-width="4"/>',
    '<rect x="66" y="66" width="1068" height="1068" rx="42" fill="none" stroke="#ffffff" stroke-opacity=".09" stroke-width="2"/>',
    dyoorWorldPixelTextSvg({
      text: "D.Y.O.O.R WORLD",
      centerX: 600,
      topY: 124,
      maxWidth: 610,
      height: 27,
      fill: "#77fff0",
    }),
    dyoorWorldPixelTextSvg({
      text: "MONAD-NATIVE NAME REGISTRY",
      centerX: 600,
      topY: 187,
      maxWidth: 620,
      height: 19,
      fill: "#ffffff",
      opacity: 0.4,
    }),
    '<g transform="translate(600 458)" fill="none" stroke="url(#frame)" stroke-width="8" filter="url(#glow)">',
    '<path d="m-142-82 142-87 142 87v171L0 184-142 89z"/>',
    '<path d="M-142-82 0 8l142-90M0 8v176"/>',
    '<circle cx="0" cy="-169" r="18" fill="#39ffe2"/>',
    '<circle cx="-142" cy="-82" r="18" fill="#39ffe2"/>',
    '<circle cx="142" cy="-82" r="18" fill="#836ef9"/>',
    '<circle cx="-142" cy="89" r="18" fill="#39ffe2"/>',
    '<circle cx="142" cy="89" r="18" fill="#ff4fd8"/>',
    '<circle cx="0" cy="184" r="18" fill="#836ef9"/>',
    "</g>",
    dyoorWorldPixelTextSvg({
      text: String(input.displayName || ""),
      centerX: 600,
      topY: 718,
      maxWidth: 980,
      height: 92,
      fill: "url(#name)",
      preserveCase: true,
    }),
    '<rect x="222" y="844" width="756" height="1" fill="#ffffff" fill-opacity=".15"/>',
    dyoorWorldPixelTextSvg({
      text: "SOULBOUND HOLDER IDENTITY",
      centerX: 600,
      topY: 884,
      maxWidth: 680,
      height: 24,
      fill: "#ffffff",
      opacity: 0.52,
    }),
    dyoorWorldPixelTextSvg({
      text: String(input.wallet || "").toUpperCase(),
      centerX: 600,
      topY: 950,
      maxWidth: 820,
      height: 21,
      fill: "#ffffff",
      opacity: 0.34,
    }),
    '<g transform="translate(386 1044)">',
    '<rect width="428" height="58" rx="29" fill="#39ffe2" fill-opacity=".08" stroke="#39ffe2" stroke-opacity=".32"/>',
    '<circle cx="34" cy="29" r="7" fill="#39ffe2"/>',
    "</g>",
    dyoorWorldPixelTextSvg({
      text: "S2 HOLDER VERIFIED",
      centerX: 612,
      topY: 1064,
      maxWidth: 310,
      height: 18,
      fill: "#77fff0",
    }),
    "</svg>",
  ].join("");
}

export async function dyoorWorldNamePng(input: DyoorWorldNameImageInput) {
  const svg = dyoorWorldNameSvg(input);
  return await sharp(Buffer.from(svg))
    .resize(MARKETPLACE_IMAGE_SIZE, MARKETPLACE_IMAGE_SIZE, {
      fit: "fill",
    })
    .png({
      adaptiveFiltering: true,
      compressionLevel: 9,
    })
    .toBuffer();
}

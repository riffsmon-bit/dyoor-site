type DyoorWorldNameImageInput = {
  displayName: string;
  wallet: string;
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function nameFontSize(displayName: string) {
  const estimatedWidth = Math.max(displayName.length * 0.66, 1);
  return Math.max(48, Math.min(86, Math.floor(1_020 / estimatedWidth)));
}

export function dyoorWorldNameSvg(input: DyoorWorldNameImageInput) {
  const displayName = escapeXml(String(input.displayName || ""));
  const wallet = escapeXml(String(input.wallet || ""));
  const fontSize = nameFontSize(String(input.displayName || ""));

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
    '<text x="600" y="148" fill="#77fff0" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="27" font-weight="800" letter-spacing="11" text-anchor="middle">D.Y.O.O.R WORLD</text>',
    '<text x="600" y="204" fill="#ffffff" fill-opacity=".4" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="19" font-weight="700" letter-spacing="5" text-anchor="middle">MONAD-NATIVE NAME REGISTRY</text>',
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
    `<text x="600" y="790" fill="url(#name)" font-family="Arial Black, Inter, system-ui, sans-serif" font-size="${fontSize}" font-weight="900" text-anchor="middle">${displayName}</text>`,
    '<rect x="222" y="844" width="756" height="1" fill="#ffffff" fill-opacity=".15"/>',
    '<text x="600" y="906" fill="#ffffff" fill-opacity=".52" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="24" font-weight="700" text-anchor="middle">SOULBOUND HOLDER IDENTITY</text>',
    `<text x="600" y="970" fill="#ffffff" fill-opacity=".34" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="21" font-weight="600" text-anchor="middle">${wallet}</text>`,
    '<g transform="translate(386 1044)">',
    '<rect width="428" height="58" rx="29" fill="#39ffe2" fill-opacity=".08" stroke="#39ffe2" stroke-opacity=".32"/>',
    '<circle cx="34" cy="29" r="7" fill="#39ffe2"/>',
    '<text x="221" y="37" fill="#77fff0" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20" font-weight="800" letter-spacing="3" text-anchor="middle">S2 HOLDER VERIFIED</text>',
    "</g>",
    "</svg>",
  ].join("");
}

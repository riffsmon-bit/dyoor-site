import {
  assertDyoorWorldRateLimit,
  dyoorWorldClientIp,
  dyoorWorldErrorStatus,
  dyoorWorldNamesContractAddress,
  getDyoorWorldNameToken,
} from "@/lib/dyoor-world-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": status === 200 ? "public, max-age=60" : "no-store" },
  });
}

function nameSvg(displayName: string, wallet: string) {
  const safeName = displayName.replace(/[^a-zA-Z0-9.-]/g, "");
  const safeWallet = wallet.replace(/[^a-fA-F0-9x]/g, "");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">',
    "<defs>",
    '<radialGradient id="g" cx="20%" cy="10%" r="100%"><stop stop-color="#213d51"/><stop offset=".5" stop-color="#0b0b1d"/><stop offset="1" stop-color="#03030a"/></radialGradient>',
    '<filter id="glow"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
    "</defs>",
    '<rect width="1200" height="1200" rx="72" fill="url(#g)"/>',
    '<path d="M0 930 1200 230M0 1080 1200 380" stroke="#836ef9" stroke-opacity=".12" stroke-width="2"/>',
    '<g transform="translate(600 400)" fill="none" stroke="#39ffe2" stroke-width="9" filter="url(#glow)">',
    '<path d="m-180-104 180-110 180 110v215L0 232l-180-121z"/><path d="M-180-104 0 8l180-112M0 8v224"/>',
    '<circle cx="0" cy="-214" r="28" fill="#39ffe2"/><circle cx="-180" cy="-104" r="28" fill="#39ffe2"/><circle cx="180" cy="-104" r="28" fill="#39ffe2"/><circle cx="-180" cy="111" r="28" fill="#39ffe2"/><circle cx="180" cy="111" r="28" fill="#39ffe2"/><circle cx="0" cy="232" r="28" fill="#39ffe2"/>',
    "</g>",
    `<text x="600" y="780" fill="#f7f5ff" font-family="ui-monospace,monospace" font-size="76" font-weight="900" text-anchor="middle">${safeName}</text>`,
    `<text x="600" y="850" fill="#aeb0c5" font-family="ui-monospace,monospace" font-size="27" font-weight="700" text-anchor="middle">${safeWallet}</text>`,
    '<text x="600" y="1040" fill="#39ffe2" font-family="ui-monospace,monospace" font-size="25" font-weight="800" letter-spacing="8" text-anchor="middle">MONAD-NATIVE HOLDER IDENTITY</text>',
    "</svg>",
  ].join("");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  try {
    const { tokenId } = await context.params;
    assertDyoorWorldRateLimit(
      `name-metadata:${dyoorWorldClientIp(request)}`,
      30,
      60_000,
    );
    const record = await getDyoorWorldNameToken(tokenId);
    const svg = nameSvg(record.profile.displayName, record.wallet);
    return json(200, {
      name: record.profile.displayName,
      description: "A soulbound, S2 holder-gated identity for dYOOR World on Monad.",
      image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      external_url: "https://dyoor.netlify.app/dyoor-world",
      attributes: [
        { trait_type: "Name", value: record.profile.displayName },
        { trait_type: "Label", value: record.profile.label },
        { trait_type: "Network", value: "Monad Mainnet" },
        { trait_type: "Transferability", value: "Soulbound" },
        { trait_type: "Holder Gate", value: "D.Y.O.O.R S2" },
        { trait_type: "Registry", value: dyoorWorldNamesContractAddress() },
      ],
    });
  } catch (error) {
    return json(dyoorWorldErrorStatus(error), {
      error: (error as Error)?.message || "Could not load the dYOOR World name.",
    });
  }
}

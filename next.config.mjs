/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://cdn.jsdelivr.net https://unpkg.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "font-src 'self' data: https://fonts.gstatic.com https:",
  "frame-src 'self' https:",
  "child-src 'self' https:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const hoodYoorOnchainData = [
  "./data/robinhood/dyoor-trait-catalog.json",
  "./data/robinhood/dyoor-trait-asset-manifest.json",
  "./data/robinhood/onchain-128/hoodyoor-onchain-art-manifest.json",
  "./data/robinhood/onchain-128/hoodyoor-onchain-art.bin",
  "./data/robinhood/onchain-128/hoodyoor-reroll-rules.json",
  "./data/robinhood/onchain-128/hoodyoor-reroll-rules.bin",
];

// @vercel/nft conservatively expands the dynamic data/robinhood base path used
// by the Trait Lab catalog. Keep the six explicit runtime files above, but do
// not ship design sources, generation sheets, audit snapshots, or source PNGs
// inside the serverless function.
const hoodYoorNonRuntimeData = [
  "./data/robinhood/brand/**/*",
  "./data/robinhood/branding/**/*",
  "./data/robinhood/generations/**/*",
  "./data/robinhood/gtd-sources/**/*",
  "./data/robinhood/layers/**/*",
  "./data/robinhood/onchain-128/chunks/**/*",
  "./data/robinhood/pixel-pilot/**/*",
  "./data/robinhood/previews/**/*",
  "./data/robinhood/security-review/**/*",
  "./data/robinhood/snapshots/**/*",
  "./data/robinhood/source-art/**/*",
];

// Sharp is an external native package. Explicitly trace both its JavaScript
// wrapper and Netlify's Linux x64 runtime so a prebuilt bundle created on macOS
// cannot accidentally ship only the developer machine's native binary.
const sharpNetlifyRuntime = [
  "./node_modules/sharp/**/*",
  "./node_modules/@img/sharp-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/**/*",
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["web-push"],
  outputFileTracingExcludes: {
    "/*": [
      "./artifacts/**/*",
      "./broadcast/**/*",
      "./cache/**/*",
      "./coverage/**/*",
      "./data/runtime/**/*",
      "./data/snapshots/**/*",
      "./dyoor-builder/layers/**/*",
      "./lib/seadrop/**/*",
      "./out/**/*",
      "./scripts/**/*",
      "./test/**/*",
    ],
    "/api/robinhood/trait-lab": hoodYoorNonRuntimeData,
    "/api/robinhood/trait-lab/confirm": hoodYoorNonRuntimeData,
    "/api/robinhood/trait-lab/image": hoodYoorNonRuntimeData,
    "/api/robinhood/trait-lab/preview": hoodYoorNonRuntimeData,
  },
  outputFileTracingIncludes: {
    "/*": sharpNetlifyRuntime,
    "/api/robinhood/trait-lab": hoodYoorOnchainData,
    "/api/robinhood/trait-lab/confirm": hoodYoorOnchainData,
    "/api/robinhood/trait-lab/image": hoodYoorOnchainData,
    "/api/robinhood/trait-lab/preview": hoodYoorOnchainData,
    "/api/metadata/[tokenId]": [
      "./data/dyoor-s2-base-layers/**/*",
    ],
    "/api/s2/trait-lab/confirm": [
      "./data/dyoor-s2-base-layers/**/*",
    ],
    "/api/s2/trait-lab/preview": [
      "./data/dyoor-s2-base-layers/**/*",
    ],
    "/api/s2/trait-lab/render/[imageId]": [
      "./data/dyoor-s2-base-layers/**/*",
    ],
    "/api/s2/trait-marketplace/quote": [
      "./data/dyoor-s2-base-layers/**/*",
    ],
    "/api/s2/trait-marketplace/preview": [
      "./data/dyoor-s2-base-layers/**/*",
    ],
    "/api/s2/trait-marketplace/purchase": [
      "./data/dyoor-s2-base-layers/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/dyoor-world-sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
      {
        source: "/api/metadata/:tokenId",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store",
          },
          {
            key: "CDN-Cache-Control",
            value: "no-store",
          },
          {
            key: "Netlify-CDN-Cache-Control",
            value: "no-store",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: csp,
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/admin-ascension", destination: "/admin", permanent: false },
      { source: "/robinhood/:path*", destination: "/", permanent: false },
      { source: "/swap.html", destination: "/", permanent: false },
      { source: "/admin-ascension.html", destination: "/admin", permanent: false },
      { source: "/blueprint-checker", destination: "/", permanent: false },
      { source: "/blueprint-checker.html", destination: "/", permanent: false },
      { source: "/verify", destination: "/", permanent: false },
      { source: "/verify.html", destination: "/", permanent: false },
      { source: "/quests", destination: "/", permanent: false },
      { source: "/quests.html", destination: "/", permanent: false },
      { source: "/stake", destination: "/ascension", permanent: false },
      { source: "/stake.html", destination: "/ascension", permanent: false },
      { source: "/whitepaper.html", destination: "/whitepaper", permanent: false },
    ];
  },
};

export default nextConfig;

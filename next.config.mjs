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

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "/*": [
      "./artifacts/**/*",
      "./broadcast/**/*",
      "./cache/**/*",
      "./coverage/**/*",
      "./data/runtime/**/*",
      "./data/snapshots/**/*",
      "./lib/seadrop/**/*",
      "./out/**/*",
      "./scripts/**/*",
      "./test/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/api/metadata/:tokenId",
        headers: [
          {
            key: "Cache-Control",
            value: "s-maxage=60, stale-while-revalidate=300",
          },
          {
            key: "CDN-Cache-Control",
            value: "s-maxage=60, stale-while-revalidate=300",
          },
          {
            key: "Netlify-CDN-Cache-Control",
            value: "s-maxage=60, stale-while-revalidate=300",
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
      { source: "/admin-ascension", destination: "/", permanent: false },
      { source: "/admin-ascension.html", destination: "/", permanent: false },
      { source: "/quests", destination: "/", permanent: false },
      { source: "/quests.html", destination: "/", permanent: false },
      { source: "/stake", destination: "/ascension", permanent: false },
      { source: "/stake.html", destination: "/ascension", permanent: false },
      { source: "/whitepaper.html", destination: "/whitepaper", permanent: false },
    ];
  },
};

export default nextConfig;

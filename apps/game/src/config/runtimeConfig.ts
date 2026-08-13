const DEFAULT_SITE_ORIGIN = "https://dyoor.netlify.app";

function validHttpOrigin(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

const configuredOrigin = String(import.meta.env.VITE_DYOOR_SITE_ORIGIN || "").trim();

export const runtimeConfig = Object.freeze({
  siteOrigin: validHttpOrigin(configuredOrigin) || DEFAULT_SITE_ORIGIN,
  mockWalletEnabled:
    import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("mock-wallet") === "1",
  season2Contract: "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A",
  chainId: 143,
});

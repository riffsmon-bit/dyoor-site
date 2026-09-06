// Public production metadata only. Never read preview/local Trait Lab state or credentials.
export const ARTWORK_TOKEN_IDS = ["11", "16", "7", "3"];
export const METADATA_ORIGIN = "https://dyoor.netlify.app";

export function parseLiveArtwork(metadata, tokenId) {
  if (!ARTWORK_TOKEN_IDS.includes(tokenId) || !metadata || typeof metadata !== "object" ||
      String(metadata.token_id) !== tokenId || !Array.isArray(metadata.attributes)) {
    throw new Error("Invalid production metadata identity");
  }
  const version = String(metadata.attributes.find(item => item?.trait_type === "Metadata Version")?.value || "");
  if (!/^[1-9][0-9]{0,8}$/.test(version)) throw new Error("Metadata version unavailable");
  const raw = metadata.image;
  if (typeof raw !== "string") throw new Error("Artwork unavailable");
  let imageUrl;
  if (/^ipfs:\/\/[a-zA-Z0-9]{46,90}\/[a-zA-Z0-9_./-]+$/.test(raw) && !raw.includes("..")) {
    imageUrl = `https://ipfs.dyoor.fun/ipfs/${raw.slice(7)}`;
  } else {
    const url = new URL(raw);
    if (!["https://dyoor.fun", METADATA_ORIGIN].includes(url.origin) || url.username || url.password ||
        !new RegExp(`^/api/s2/trait-lab/render/${tokenId}-v${version}-[a-zA-Z0-9-]+$`).test(url.pathname) ||
        url.search || url.hash) throw new Error("Unrecognized production artwork URL");
    // Same production site as the on-chain metadata URI; never use preview render storage.
    imageUrl = `${METADATA_ORIGIN}${url.pathname}`;
  }
  return { tokenId, version, imageUrl, source: `${METADATA_ORIGIN}/api/metadata/${tokenId}` };
}

export async function readLiveArtwork(tokenId, fetcher = fetch) {
  if (!ARTWORK_TOKEN_IDS.includes(tokenId)) throw new Error("Unsupported preview token");
  const response = await fetcher(`${METADATA_ORIGIN}/api/metadata/${tokenId}`, {
    method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Production metadata unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty production metadata");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 262144) throw new Error("Production metadata too large");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const artwork = parseLiveArtwork(JSON.parse(new TextDecoder().decode(bytes)), tokenId);
  return { ...artwork, checkedAt: new Date().toISOString() };
}

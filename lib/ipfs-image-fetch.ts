import { ipfsGatewayUrls } from "./ipfs-gateway.ts";

/** Server-side image reads retry independent gateways without changing a CID. */
export async function fetchIpfsImageBuffer(value: string, timeoutMs = 8000) {
  for (const url of ipfsGatewayUrls(value)) {
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "image/png,image/*" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch {
      // A network error at one gateway must not make a compatible reroll fail.
    }
  }
  return null;
}

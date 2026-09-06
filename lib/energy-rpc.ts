import { JsonRpcProvider } from "ethers";

// Settlement must not inherit a browser/Alchemy subscription's exhausted quota.
// Use one explicitly configured provider for signing/broadcast; never retry a
// possibly-submitted credit by creating a new transaction on another provider.
export function createEnergyRpcProvider(env: Record<string, string | undefined> = process.env) {
  const url = env.ENERGY_RPC_URL?.trim() || "https://rpc.monad.xyz";
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("ENERGY_RPC_URL must use HTTPS.");
  // Dynamic network detection is intentional; settlement checks chain 143.
  return new JsonRpcProvider(url);
}

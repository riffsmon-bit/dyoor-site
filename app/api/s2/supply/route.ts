import { dyoorS2Contract } from "@/lib/contracts/addresses";
import { readContractWithFailover } from "@/lib/rpc";
import { resolveS2ChainSupply, resolveS2RecordedBurnSupply } from "@/lib/s2-supply";
import { getBurnedDroidGallery } from "@/src/lib/storage/s2TraitLabStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supplyAbi = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalMinted",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function chainSupply() {
  const [currentSupply, issuedSupply] = await Promise.all([
    readContractWithFailover({
      address: dyoorS2Contract,
      abi: supplyAbi,
      functionName: "totalSupply",
      label: "S2 current supply",
    }),
    readContractWithFailover({
      address: dyoorS2Contract,
      abi: supplyAbi,
      functionName: "totalMinted",
      label: "S2 issued supply",
    }),
  ]);
  if (typeof currentSupply !== "bigint" || typeof issuedSupply !== "bigint") {
    throw new Error("S2 supply contract returned an invalid value.");
  }
  return resolveS2ChainSupply(currentSupply, issuedSupply);
}

async function recordedBurnSupply() {
  const gallery = await getBurnedDroidGallery();
  return resolveS2RecordedBurnSupply(gallery.items.length);
}

export async function GET() {
  const snapshot = await chainSupply()
    .catch(() => recordedBurnSupply())
    .catch(() => resolveS2RecordedBurnSupply(0));

  return Response.json({
    ok: true,
    ...snapshot,
    updatedAt: new Date().toISOString(),
  }, {
    headers: {
      "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120",
    },
  });
}

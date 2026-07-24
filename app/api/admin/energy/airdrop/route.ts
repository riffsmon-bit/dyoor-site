import { POST as executeEnergyBankAirdrop } from "../../energy-airdrop/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return await executeEnergyBankAirdrop(request);
}

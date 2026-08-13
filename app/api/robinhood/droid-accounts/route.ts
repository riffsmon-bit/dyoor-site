import { handleDroidAccountsRequest } from "@/lib/droid-accounts/http";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "@/lib/robinhood-chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return await handleDroidAccountsRequest(request, ROBINHOOD_MAINNET_CHAIN_ID);
}

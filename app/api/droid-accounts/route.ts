import { handleDroidAccountsRequest } from "@/lib/droid-accounts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return await handleDroidAccountsRequest(request);
}

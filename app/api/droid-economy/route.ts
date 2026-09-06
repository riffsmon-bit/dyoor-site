import { handleDroidEconomyRequest } from "@/lib/droid-economy/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return await handleDroidEconomyRequest(request);
}

import { handleEcosystemRevenueRequest } from "@/lib/droid-economy/revenue-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleEcosystemRevenueRequest(request);
}

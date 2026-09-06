import { NextResponse } from "next/server";
import { quoteMonadDroidTradingCanary } from "@/lib/droid-trading/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const quote = await quoteMonadDroidTradingCanary({
      tokenId: params.get("tokenId"),
      amount: params.get("amount"),
      slippageBps: params.get("slippageBps"),
    });
    return NextResponse.json(quote, {
      headers: { "cache-control": "no-store" },
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Trading simulation unavailable.";
    const inputError = /enter|must be|limited to|no more than|slippage/i.test(message);
    return NextResponse.json({ ok: false, error: message }, {
      status: inputError ? 400 : 503,
      headers: { "cache-control": "no-store" },
    });
  }
}

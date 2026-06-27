import quoteHandler from "@/netlify/functions/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return quoteHandler(request);
}

export async function POST(request: Request) {
  return quoteHandler(request);
}

export async function OPTIONS(request: Request) {
  return quoteHandler(request);
}

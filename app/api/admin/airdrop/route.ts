import { getStore } from "@netlify/blobs";
import { adminOwnerWallet, normalizeAdminAddress, verifyAdminAirdrop } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_NAME = "dyoor-s2-airdrop-jobs";
const INDEX_KEY = "index.json";

type JobIndex = {
  updatedAt?: string;
  jobs?: Record<string, {
    jobId: string;
    csvFilename?: string;
    csvSha256?: string;
    chainId?: number;
    contractAddress?: string;
    status?: string;
    updatedAt?: string;
  }>;
};

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await store().get(key, { type: "json", consistency: "strong" });
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown) {
  await store().setJSON(key, value);
}

function cleanJobId(value: unknown) {
  const raw = String(value || "").trim();
  return /^[a-zA-Z0-9._:-]{8,160}$/.test(raw) ? raw : "";
}

function publicJobSummary(job: Record<string, unknown>) {
  return {
    jobId: job.jobId,
    chainId: job.chainId,
    contractAddress: job.contractAddress,
    csvFilename: job.csvFilename,
    csvSha256: job.csvSha256,
    uniqueWalletCount: job.uniqueWalletCount,
    totalQuantity: job.totalQuantity,
    batchSize: job.batchSize,
    batchCount: Array.isArray(job.batches) ? job.batches.length : 0,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = normalizeAdminAddress(url.searchParams.get("wallet"));
  const owner = adminOwnerWallet();
  const authorized = Boolean(owner && wallet && wallet.toLowerCase() === owner.toLowerCase());
  if (!authorized) return json(200, { ok: true, authorized: false, jobs: [] });

  const jobId = cleanJobId(url.searchParams.get("jobId"));
  if (jobId) {
    const job = await readJson<Record<string, unknown> | null>(`jobs/${jobId}.json`, null);
    return json(200, { ok: true, authorized, job });
  }

  const index = await readJson<JobIndex>(INDEX_KEY, { jobs: {} });
  return json(200, {
    ok: true,
    authorized,
    jobs: Object.values(index.jobs || {}).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    await verifyAdminAirdrop(body, { consumeNonce: false });
    const mode = String(body.mode || "");
    const job = body.job && typeof body.job === "object" ? body.job as Record<string, unknown> : {};
    const jobId = cleanJobId(job.jobId || body.jobId);
    if (!jobId) return json(400, { ok: false, error: "Invalid job ID." });

    const now = new Date().toISOString();
    const existing = await readJson<Record<string, unknown> | null>(`jobs/${jobId}.json`, null);
    const next: Record<string, unknown> = {
      ...(existing || {}),
      ...job,
      jobId,
      updatedAt: now,
      createdAt: existing?.createdAt || job.createdAt || now,
      updatedBy: normalizeAdminAddress(body.wallet),
      mode,
    };

    await writeJson(`jobs/${jobId}.json`, next);

    const index = await readJson<JobIndex>(INDEX_KEY, { jobs: {} });
    const jobs = {
      ...(index.jobs || {}),
      [jobId]: {
        jobId,
        csvFilename: String(next.csvFilename || ""),
        csvSha256: String(next.csvSha256 || ""),
        chainId: Number(next.chainId || 0) || undefined,
        contractAddress: String(next.contractAddress || ""),
        status: String(next.status || "draft"),
        updatedAt: now,
      },
    };
    await writeJson(INDEX_KEY, { updatedAt: now, jobs });

    return json(200, { ok: true, job: publicJobSummary(next) });
  } catch (error: any) {
    return json(error?.status || 500, { ok: false, error: error?.message || "Airdrop job request failed." });
  }
}

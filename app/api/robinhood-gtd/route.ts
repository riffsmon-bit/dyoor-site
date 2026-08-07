import { ethers } from "ethers";
import {
  normalizeRobinhoodGtdWallet,
  ROBINHOOD_GTD_CAMPAIGN,
  ROBINHOOD_GTD_CHAIN_ID,
  ROBINHOOD_GTD_CHAIN_NAME,
  ROBINHOOD_GTD_COLLECTION_NAME,
  ROBINHOOD_GTD_SIGNATURE_TTL_MS,
  robinhoodGtdConfirmationMessage,
} from "@/lib/robinhood-gtd";
import { createJsonStore } from "@/src/lib/storage/fileStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_NAME = "dyoor-robinhood-gtd";
const SUBMISSION_PREFIX = "submissions/";
const store = createJsonStore(STORE_NAME);

type RobinhoodGtdSubmission = {
  version: 1;
  campaign: string;
  wallet: string;
  destinationChain: {
    name: string;
    chainId: number;
  };
  createdAt: string;
  proof: {
    issuedAt: string;
    nonce: string;
    message: string;
    signature: string;
  };
};

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function registrationOpen() {
  return process.env.ROBINHOOD_GTD_REGISTRATION_ENABLED !== "0";
}

function submissionKey(wallet: string) {
  return `${SUBMISSION_PREFIX}${wallet}.json`;
}

function publicSubmission(submission: RobinhoodGtdSubmission | null) {
  if (!submission) return null;
  return {
    wallet: submission.wallet,
    campaign: submission.campaign,
    createdAt: submission.createdAt,
    destinationChain: submission.destinationChain,
  };
}

async function submissionCount() {
  const keys = await store.listKeys(SUBMISSION_PREFIX);
  return keys.filter((key) => key.endsWith(".json")).length;
}

function validNonce(value: string) {
  return /^[a-zA-Z0-9-]{16,96}$/.test(value);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const suppliedWallet = url.searchParams.get("wallet");
    const wallet = normalizeRobinhoodGtdWallet(suppliedWallet);

    if (suppliedWallet && !wallet) {
      return json(400, { ok: false, error: "Enter a valid EVM wallet address." });
    }

    const [submission, acceptedCount] = await Promise.all([
      wallet
        ? store.getJsonStrict<RobinhoodGtdSubmission>(submissionKey(wallet))
        : Promise.resolve(null),
      submissionCount(),
    ]);

    return json(200, {
      ok: true,
      registrationOpen: registrationOpen(),
      collection: ROBINHOOD_GTD_COLLECTION_NAME,
      campaign: ROBINHOOD_GTD_CAMPAIGN,
      destinationChain: {
        name: ROBINHOOD_GTD_CHAIN_NAME,
        chainId: ROBINHOOD_GTD_CHAIN_ID,
      },
      acceptedCount,
      submitted: Boolean(submission),
      submission: publicSubmission(submission),
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Could not load GTD registration status.",
    });
  }
}
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const wallet = normalizeRobinhoodGtdWallet(body.wallet);
    const issuedAt = String(body.issuedAt || "").trim();
    const nonce = String(body.nonce || "").trim();
    const message = String(body.message || "");
    const signature = String(body.signature || "").trim();

    if (!wallet) return json(400, { ok: false, error: "Connect a valid EVM wallet." });

    const existing = await store.getJsonStrict<RobinhoodGtdSubmission>(submissionKey(wallet));
    if (existing) {
      return json(200, {
        ok: true,
        duplicate: true,
        submitted: true,
        acceptedCount: await submissionCount(),
        submission: publicSubmission(existing),
      });
    }

    if (!registrationOpen()) {
      return json(410, { ok: false, registrationOpen: false, error: "GTD wallet registration is closed." });
    }

    if (!issuedAt || !validNonce(nonce) || !message || !/^0x[a-fA-F0-9]+$/.test(signature)) {
      return json(400, { ok: false, error: "The wallet confirmation is incomplete. Please sign again." });
    }

    const issuedAtMs = Date.parse(issuedAt);
    const now = Date.now();
    if (
      !Number.isFinite(issuedAtMs)
      || issuedAtMs > now + 30_000
      || now - issuedAtMs > ROBINHOOD_GTD_SIGNATURE_TTL_MS
    ) {
      return json(401, { ok: false, error: "The wallet confirmation expired. Please sign again." });
    }

    const expectedMessage = robinhoodGtdConfirmationMessage({ wallet, issuedAt, nonce });
    if (message !== expectedMessage) {
      return json(400, { ok: false, error: "The signed confirmation does not match this GTD campaign." });
    }

    let recoveredWallet = "";
    try {
      recoveredWallet = normalizeRobinhoodGtdWallet(ethers.verifyMessage(message, signature));
    } catch {
      recoveredWallet = "";
    }
    if (recoveredWallet !== wallet) {
      return json(401, { ok: false, error: "The signature does not match the connected wallet." });
    }

    const submission: RobinhoodGtdSubmission = {
      version: 1,
      campaign: ROBINHOOD_GTD_CAMPAIGN,
      wallet,
      destinationChain: {
        name: ROBINHOOD_GTD_CHAIN_NAME,
        chainId: ROBINHOOD_GTD_CHAIN_ID,
      },
      createdAt: new Date(now).toISOString(),
      proof: {
        issuedAt,
        nonce,
        message,
        signature,
      },
    };

    await store.setJson(submissionKey(wallet), submission);

    return json(201, {
      ok: true,
      duplicate: false,
      submitted: true,
      acceptedCount: await submissionCount(),
      submission: publicSubmission(submission),
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the GTD wallet.",
    });
  }
}

import { Interface, getAddress, keccak256, toUtf8Bytes, type JsonRpcProvider } from "ethers";
import { createLocalControlReader, type LocalControlManifest } from "./local-authority.ts";

// Structured owner review, NOT an AI tool or live executor. Only the fixed local
// free-mint capability is supported. Natural-language text confers no authority.
export type LocalMissionDraftV1 = {
  version: 1; capability: "FREE_FIXTURE_MINT"; runner: string;
  validAfter: number; expiresAt: number; maxActions: number; maxActionsPerDay: number;
  protectedReserveWei: string;
};
const keys = ["version", "capability", "runner", "validAfter", "expiresAt", "maxActions", "maxActionsPerDay", "protectedReserveWei"];
export function parseLocalMissionDraft(value: unknown): LocalMissionDraftV1 {
  const fail = () => { throw Error("Invalid local mission draft. No authority was created."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))
    || v.version !== 1 || v.capability !== "FREE_FIXTURE_MINT") return fail();
  for (const key of ["validAfter", "expiresAt", "maxActions", "maxActionsPerDay"]) {
    if (typeof v[key] !== "number" || !Number.isSafeInteger(v[key]) || v[key] < 0) return fail();
  }
  if (typeof v.runner !== "string" || !/^0x[0-9a-f]{40}$/i.test(v.runner)
    || getAddress(v.runner) === "0x0000000000000000000000000000000000000000") return fail();
  if (typeof v.protectedReserveWei !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(v.protectedReserveWei)
    || BigInt(v.protectedReserveWei) >= 2n ** 256n) return fail();
  const result = { ...v, runner: v.runner.toLowerCase() } as LocalMissionDraftV1;
  if (result.maxActions < 1 || result.maxActions > 20 || result.maxActionsPerDay < 1
    || result.maxActionsPerDay > result.maxActions || result.expiresAt <= result.validAfter) return fail();
  return result;
}
const launch = new Interface([
  "function launch((address runner,uint64 validAfter,uint64 expiresAt,uint32 maxActions,uint32 maxActionsPerDay,uint256 protectedReserveWei,bytes32 missionHash),uint256 expectedNonce,uint256 expectedEpoch) returns(uint256)",
]);

export async function prepareLocalMissionReview(rpc: JsonRpcProvider, manifest: LocalControlManifest, wallet: string, input: unknown) {
  const draft = parseLocalMissionDraft(input);
  const reader = createLocalControlReader(rpc, manifest);
  const authority = await reader.current();
  if (authority.owner !== wallet.toLowerCase() || draft.runner === authority.account
    || draft.expiresAt <= authority.timestamp || draft.expiresAt > authority.timestamp + 7 * 86400
    || BigInt(draft.protectedReserveWei) > BigInt(authority.nativeBalanceWei)) throw Error("Local mission policy denied.");
  // Explicit field ordering: stable hash binds all reviewed rules and exact era.
  const review = { version: 1, chainId: 31337, collection: authority.collection, tokenId: authority.tokenId,
    wrapper: authority.wrapper, account: authority.account, owner: authority.owner, epoch: authority.epoch, nonce: authority.nonce,
    capability: draft.capability, runner: draft.runner, validAfter: draft.validAfter, expiresAt: draft.expiresAt,
    maxActions: draft.maxActions, maxActionsPerDay: draft.maxActionsPerDay, protectedReserveWei: draft.protectedReserveWei };
  const missionHash = keccak256(toUtf8Bytes(JSON.stringify(review)));
  const limits = { runner: draft.runner, validAfter: draft.validAfter, expiresAt: draft.expiresAt,
    maxActions: draft.maxActions, maxActionsPerDay: draft.maxActionsPerDay, protectedReserveWei: draft.protectedReserveWei, missionHash };
  const transaction = { chainId: 31337, from: authority.owner, to: authority.account, value: "0x0",
    data: launch.encodeFunctionData("launch", [limits, authority.nonce, authority.epoch]) };
  // Actual account-specific eth_call. No signer/sendTransaction is accepted here.
  const simulated = await rpc.call({ ...transaction, blockTag: authority.block });
  const nextMissionId = String(launch.decodeFunctionResult("launch", simulated)[0]);
  await reader.unchanged(authority);
  return { version: 1 as const, status: "OWNER_TRANSACTION_REQUIRED" as const, executionEnabled: false as const,
    review, missionHash, transaction, authority, simulation: { kind: "LOCAL_LAUNCH_ETH_CALL", block: authority.block,
      hash: authority.hash, nextMissionId, guarantee: false as const } };
}

import type { DroidActivityItem } from "@/lib/droid-accounts/types";

export const MONAD_CANARY_OBSERVATION_SHA256 =
  "d64d76e15180cb1c6df329d18d734e9e40148d609273f8a76cf1ee3e19797917";
export const MONAD_CANARY_OBSERVATION_FINAL_BLOCK = 96_231_661;
export const MONAD_CANARY_TOKEN_ID = 11;
export const MONAD_CANARY_COLLECTION = "0x349d8eb480c92cf75371fba5c6344a4d11b9103a";
export const MONAD_CANARY_ACCOUNT = "0x6b7e71b10ee63bba4c460e80c7569eaf3fb129cd";

export const MONAD_CANARY_ACTIVITY_EVIDENCE = Object.freeze([
  {
    id: "0xa796c880a92a6d9b3de493cb794035b8e220f603a1e77ebab6a6bc8c578f76eb:139",
    kind: "activated",
    blockNumber: 95_938_575,
    logAddress: "0xc32b411e7dcabd85a9b25c6eadd87f0a3fe8ea1b",
  },
  {
    id: "0x0979a5f5f76b79e140188caec388ac06adde9fdc161cfd138366f22cb1e79264:185",
    kind: "native-received",
    blockNumber: 95_939_143,
    logAddress: MONAD_CANARY_ACCOUNT,
  },
  {
    id: "0xda8a1f603c3503f0903dac33ea4c62e1c74212f067d2381c26c5646d4b1d6d76:160",
    kind: "executed",
    blockNumber: 95_939_810,
    logAddress: MONAD_CANARY_ACCOUNT,
  },
  {
    id: "0x47db37daed5f37401654b3f067799faf8c45de85ca689005e459a76ed1e402a5:88",
    kind: "owner-changed",
    blockNumber: 95_940_423,
    logAddress: MONAD_CANARY_COLLECTION,
  },
  {
    id: "0xb0410557463b0e8fbb90777e51e1aadf8fa5a6d0467392011372450140a6cc60:116",
    kind: "executed",
    blockNumber: 95_940_974,
    logAddress: MONAD_CANARY_ACCOUNT,
  },
] as const);

/**
 * A one-time monotonic bootstrap is allowed only for the exact, hashed #11
 * observation evidence. It never synthesizes an event and never applies to a
 * different chain, collection, account, or token.
 */
export function matchesMonadCanaryActivityEvidence(input: {
  chainId: number;
  collectionAddress: string;
  tokenId: number;
  droidAccount: string;
  events: DroidActivityItem[];
}) {
  if (
    input.chainId !== 143
    || input.collectionAddress.toLowerCase() !== MONAD_CANARY_COLLECTION
    || input.tokenId !== MONAD_CANARY_TOKEN_ID
    || input.droidAccount.toLowerCase() !== MONAD_CANARY_ACCOUNT
    || input.events.length !== MONAD_CANARY_ACTIVITY_EVIDENCE.length
  ) return false;

  const actual = new Map(input.events.map((event) => [event.id.toLowerCase(), event]));
  return MONAD_CANARY_ACTIVITY_EVIDENCE.every((expected) => {
    const event = actual.get(expected.id);
    return Boolean(
      event
      && event.chainId === 143
      && event.tokenId === MONAD_CANARY_TOKEN_ID
      && event.droidAccount.toLowerCase() === MONAD_CANARY_ACCOUNT
      && event.kind === expected.kind
      && event.blockNumber === expected.blockNumber
      && event.transactionHash.toLowerCase() === expected.id.split(":")[0],
    );
  });
}

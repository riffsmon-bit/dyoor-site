import assert from "node:assert/strict";
import test from "node:test";
import { parseWalletRoster, SEASON_2_COLLECTION } from "../lib/droid-os/roster.mjs";
const wallet = "0x1111111111111111111111111111111111111111";
const payload = ids => ({ ok: true, wallet, contractAddress: SEASON_2_COLLECTION, tokenIds: ids, count: ids.length });

test("wallet roster retains every token, not just four sample characters", () => {
  const ids = Array.from({ length: 43 }, (_, index) => String(43 - index));
  const actual = parseWalletRoster(payload(ids), wallet);
  assert.equal(actual.length, 43); assert.equal(actual[0], "1"); assert.equal(actual[42], "43");
});
test("zero holdings is empty, not a sample fallback", () => assert.deepEqual(parseWalletRoster(payload([]), wallet), []));
test("rejects stale wallet, wrong collection, partial and duplicate responses", () => {
  for (const bad of [{ ...payload(["16"]), wallet: "0x2222222222222222222222222222222222222222" }, { ...payload(["16"]), contractAddress: wallet }, { ...payload(["16"]), count: 43 }, payload(["16", "16"]), { ...payload(["16"]), ok: false }]) assert.throws(() => parseWalletRoster(bad, wallet));
});
test("bounds identity parsing without truncating valid large rosters", () => {
  for (const id of ["0", "3334", "-1", "1.1", "1e2", "001", "../16"]) assert.throws(() => parseWalletRoster(payload([id]), wallet));
  assert.equal(parseWalletRoster(payload(["3333"]), wallet)[0], "3333");
});

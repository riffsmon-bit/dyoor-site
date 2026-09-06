import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { parseLiveArtwork, readLiveArtwork, METADATA_ORIGIN } from "../lib/droid-os/live-artwork.mjs";

const sample = (id = "16", version = "6") => ({ token_id: Number(id), image: `https://dyoor.fun/api/s2/trait-lab/render/${id}-v${version}-trait-assets-v6-abc123`, attributes: [{ trait_type: "Metadata Version", value: version }] });

test("uses production accepted image and version, never a preview render store", () => {
  const art = parseLiveArtwork(sample(), "16");
  assert.equal(art.version, "6");
  assert.equal(art.imageUrl, `${METADATA_ORIGIN}/api/s2/trait-lab/render/16-v6-trait-assets-v6-abc123`);
});
test("rejects wrong token, missing version, mismatched image version and unsupported IDs", () => {
  for (const metadata of [{ ...sample(), token_id: 11 }, { ...sample(), attributes: [] }, { ...sample(), image: sample("16", "1").image }]) assert.throws(() => parseLiveArtwork(metadata, "16"));
  assert.throws(() => parseLiveArtwork(sample("3334"), "3334"));
});
test("rejects script, credential, preview, remote host and arbitrary production paths", () => {
  for (const image of ["javascript:alert(1)", "https://evil.test/x.png", "http://127.0.0.1/x", "https://deploy-preview-29--dyoor.netlify.app/api/s2/trait-lab/render/16-v6-x", "https://user:password@dyoor.fun/api/s2/trait-lab/render/16-v6-x", "https://dyoor.fun/api/admin", `${sample().image}?redirect=elsewhere`]) assert.throws(() => parseLiveArtwork({ ...sample(), image }, "16"));
});
test("original IPFS metadata is supported only when actually returned by production", () => {
  const cid = "bafybeigzwmixppsb5hff7hioos3j427l7esli742p6p6hvyoxz3jfv7oiu";
  assert.equal(parseLiveArtwork({ ...sample(), image: `ipfs://${cid}/16.png` }, "16").imageUrl, `https://ipfs.dyoor.fun/ipfs/${cid}/16.png`);
});
test("public fetch is bounded, read-only, uncached, credential-free and no redirects", async () => {
  const art = await readLiveArtwork("16", async (url, init) => {
    assert.equal(url, `${METADATA_ORIGIN}/api/metadata/16`);
    assert.equal(init.method, "GET"); assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error");
    assert.deepEqual(init.headers, { Accept: "application/json" });
    return Response.json(sample());
  });
  assert.equal(art.version, "6"); assert.ok(art.checkedAt);
});
test("upstream errors and oversized/malformed responses never fall back to base artwork", async () => {
  for (const response of [new Response("offline", { status: 503 }), new Response("x".repeat(262145)), new Response("not json")]) await assert.rejects(readLiveArtwork("16", async () => response));
  await assert.rejects(readLiveArtwork("3334", () => { throw Error("must not fetch"); }));
  const component = fs.readFileSync("components/droid-os/DroidCharacter.tsx", "utf8");
  assert.doesNotMatch(component, /src=\{`\/droid-os\/droid-/);
  assert.match(component, /NO ORIGINAL FALLBACK/);
});

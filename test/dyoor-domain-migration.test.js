import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { dyoorWorldRequestAudience } from "../lib/dyoor-world-origin.ts";

function postRequest(url, origin) {
  return new Request(url, {
    method: "POST",
    headers: origin ? { origin } : {},
  });
}

test("holder authentication accepts the canonical production origin and rejects retired domains", () => {
  assert.equal(
    dyoorWorldRequestAudience(postRequest("https://dyoor.fun/api/dyoor-world/challenge", "https://dyoor.fun"), {}),
    "dyoor.fun",
  );
  assert.equal(
    dyoorWorldRequestAudience(postRequest("https://internal.example/api/dyoor-world/challenge", "https://dyoor.netlify.app"), {}),
    null,
  );
  assert.equal(
    dyoorWorldRequestAudience(postRequest("https://internal.example/api/dyoor-world/challenge", "https://dyoor.xyz"), {}),
    null,
  );
});

test("holder authentication rejects absent, malformed, and lookalike origins", () => {
  assert.equal(dyoorWorldRequestAudience(postRequest("https://dyoor.fun/api", ""), {}), null);
  assert.equal(dyoorWorldRequestAudience(postRequest("https://dyoor.fun/api", "null"), {}), null);
  assert.equal(
    dyoorWorldRequestAudience(postRequest("https://dyoor.fun/api", "https://dyoor.fun.evil.example"), {}),
    null,
  );
  assert.equal(
    dyoorWorldRequestAudience(postRequest("https://dyoor.fun/api", "https://random--dyoor.netlify.app"), {}),
    null,
  );
});

test("only an exact configured nonstandard preview origin is trusted", () => {
  const environment = { DEPLOY_PRIME_URL: "https://review.dyoor.example" };
  assert.equal(
    dyoorWorldRequestAudience(
      postRequest("https://internal.example/api", "https://review.dyoor.example"),
      environment,
    ),
    "review.dyoor.example",
  );
  assert.equal(
    dyoorWorldRequestAudience(
      postRequest("https://internal.example/api", "https://other.dyoor.example"),
      environment,
    ),
    null,
  );
});

test("immutable deploy URLs for this Netlify site are trusted without opening a wildcard", () => {
  assert.equal(
    dyoorWorldRequestAudience(
      postRequest(
        "https://internal.example/api",
        "https://6a83cc5aa1de53d6e1e27181--dyoor.netlify.app",
      ),
      {},
    ),
    "6a83cc5aa1de53d6e1e27181--dyoor.netlify.app",
  );
  assert.equal(
    dyoorWorldRequestAudience(
      postRequest(
        "https://internal.example/api",
        "https://6a83cc5aa1de53d6e1e27181--attacker.netlify.app",
      ),
      {},
    ),
    null,
  );
});

test("canonical metadata and image fallbacks use dyoor.fun", () => {
  const ownedTokens = fs.readFileSync("app/api/s2/owned-tokens/route.ts", "utf8");
  const metadata = fs.readFileSync("app/api/metadata/[tokenId]/route.ts", "utf8");
  const renderer = fs.readFileSync("lib/s2-trait-lab-render.ts", "utf8");
  assert.match(ownedTokens, /https:\/\/dyoor\.fun\/api\/metadata\//);
  assert.match(metadata, /return "https:\/\/dyoor\.fun"/);
  assert.match(renderer, /DEFAULT_SITE_URL = "https:\/\/dyoor\.fun"/);
});

test("secure Netlify build refuses a bundle without Sharp's Linux runtime", () => {
  const buildScript = fs.readFileSync("scripts/netlify-build-production-secure.sh", "utf8");
  assert.match(buildScript, /--os=linux/);
  assert.match(buildScript, /--cpu=x64/);
  assert.match(buildScript, /--libc=glibc/);
  assert.match(buildScript, /sharp-linux-x64\\\.node/);
  assert.match(buildScript, /sharp-libvips-linux-x64\/lib\/libvips-cpp\\\.so/);
});

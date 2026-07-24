import { readFileSync } from "node:fs";
import { NetlifyAPI } from "@netlify/api";
import { getAPIToken } from "@netlify/dev-utils";
import { parse } from "dotenv";

const SITE_ID = "e2a951cd-7e5b-49ac-a39a-391f68b69964";
const FUNCTIONS_FILE = "netlify-dyoor-world-functions.env";
const BUILDS_FILE = "netlify-dyoor-world-builds.env";
const SECRET_KEYS = new Set([
  "DYOOR_WORLD_SESSION_SECRET",
  "DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY",
  "DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET",
]);
const FUNCTIONS_KEYS = [
  "DYOOR_WORLD_SESSION_SECRET",
  "DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY",
  "DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET",
  "DYOOR_TRAIT_LAB_ENABLE_BOUNTIES",
];
const BUILDS_KEYS = [
  "NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT",
  "NEXT_PUBLIC_DYOOR_TRAIT_BOUNTIES_CONTRACT",
  "NEXT_PUBLIC_DYOOR_TRAIT_LAB_ENABLE_LEADERBOARD",
];

if (process.env.APPLY_DYOOR_WORLD_NETLIFY_PREVIEW !== "1") {
  throw new Error(
    "Refusing to modify Netlify. Set APPLY_DYOOR_WORLD_NETLIFY_PREVIEW=1 explicitly.",
  );
}

function loadAllowlisted(filePath, keys) {
  const values = parse(readFileSync(filePath, "utf8"));
  for (const key of keys) {
    if (!String(values[key] || "").trim()) {
      throw new Error(`${key} is missing from ${filePath}.`);
    }
  }
  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}

function publicValue(value) {
  return {
    context: value.context,
    ...(value.context_parameter
      ? { context_parameter: value.context_parameter }
      : {}),
    value: value.value,
  };
}

function isGranularScopePlanError(error) {
  return (
    error?.status === 403
      && String(error?.json?.message || error?.message || "").includes(
        "Upgrade your Netlify account to set specific scopes",
      )
  );
}

async function setVariable({
  accountId,
  api,
  existingVariables,
  key,
  scope,
  value,
}) {
  const existing = existingVariables.find((entry) => entry.key === key);
  const shouldBeSecret = SECRET_KEYS.has(key);

  if (!existing) {
    let granularScopeApplied = true;
    try {
      await api.createEnvVars({
        accountId,
        siteId: SITE_ID,
        body: [{
          key,
          is_secret: shouldBeSecret,
          scopes: [scope],
          values: [{ context: "deploy-preview", value }],
        }],
      });
    } catch (error) {
      if (!isGranularScopePlanError(error)) throw error;
      granularScopeApplied = false;
      await api.createEnvVars({
        accountId,
        siteId: SITE_ID,
        body: [{
          key,
          is_secret: shouldBeSecret,
          ...(shouldBeSecret
            ? { scopes: ["builds", "functions", "runtime"] }
            : {}),
          values: [{ context: "deploy-preview", value }],
        }],
      });
    }
    console.log(
      `Created ${key} (${granularScopeApplied ? scope : "all scopes (site plan)"}, deploy-preview${shouldBeSecret ? ", secret" : ""}).`,
    );
    return;
  }

  if (existing.is_secret && !shouldBeSecret) {
    throw new Error(
      `${key} already exists as a secret. Refusing to downgrade it automatically.`,
    );
  }

  await api.setEnvVarValue({
    accountId,
    siteId: SITE_ID,
    key,
    body: { context: "deploy-preview", value },
  });

  const scopes = new Set(existing.scopes || []);
  if (
    ((existing.scopes || []).length > 0 && !scopes.has(scope))
      || existing.is_secret !== shouldBeSecret
  ) {
    if (existing.is_secret) {
      throw new Error(
        `${key} needs a scope or secrecy change, but it already has protected values. Refusing to replace those values automatically.`,
      );
    }
    scopes.add(scope);
    const values = (existing.values || [])
      .filter((entry) => entry.context !== "deploy-preview")
      .map(publicValue);
    values.push({ context: "deploy-preview", value });
    const body = {
      key,
      is_secret: shouldBeSecret,
      scopes: [...scopes],
      values,
    };
    try {
      await api.updateEnvVar({
        accountId,
        siteId: SITE_ID,
        key,
        body,
      });
    } catch (error) {
      if (!isGranularScopePlanError(error)) throw error;
      delete body.scopes;
      await api.updateEnvVar({
        accountId,
        siteId: SITE_ID,
        key,
        body,
      });
    }
  }

  console.log(
    `Updated ${key} (deploy-preview${shouldBeSecret ? ", secret" : ""}; existing contexts preserved).`,
  );
}

const functionsValues = loadAllowlisted(FUNCTIONS_FILE, FUNCTIONS_KEYS);
const buildsValues = loadAllowlisted(BUILDS_FILE, BUILDS_KEYS);
const token = await getAPIToken();
if (!token) {
  throw new Error("No authenticated Netlify API token is available.");
}
const api = new NetlifyAPI(token);
const site = await api.getSite({ siteId: SITE_ID });
if (site.id !== SITE_ID) {
  throw new Error(`Linked Netlify site does not match ${SITE_ID}.`);
}
const accountId = site.account_slug;
if (!accountId) {
  throw new Error("The Netlify site has no account identifier.");
}
const existingVariables = await api.getEnvVars({ accountId, siteId: SITE_ID });

for (const [key, value] of Object.entries(functionsValues)) {
  await setVariable({
    accountId,
    api,
    existingVariables,
    key,
    value,
    scope: "functions",
  });
}
for (const [key, value] of Object.entries(buildsValues)) {
  await setVariable({
    accountId,
    api,
    existingVariables,
    key,
    value,
    scope: "builds",
  });
}

const expected = new Map([
  ...Object.entries(functionsValues).map(([key, value]) => [
    key,
    { scope: "functions", value },
  ]),
  ...Object.entries(buildsValues).map(([key, value]) => [
    key,
    { scope: "builds", value },
  ]),
]);
const verifiedVariables = await api.getEnvVars({
  accountId,
  siteId: SITE_ID,
  contextName: "deploy-preview",
});
for (const [key, expectation] of expected) {
  const variable = verifiedVariables.find((entry) => entry.key === key);
  if (!variable) {
    throw new Error(`${key} was not returned by Netlify after the update.`);
  }
  if (
    (variable.scopes || []).length > 0
      && !(variable.scopes || []).includes(expectation.scope)
  ) {
    throw new Error(`${key} is missing the ${expectation.scope} scope.`);
  }
  if (Boolean(variable.is_secret) !== SECRET_KEYS.has(key)) {
    throw new Error(`${key} has an unexpected secret classification.`);
  }
  const previewValue = (variable.values || []).find(
    (entry) => entry.context === "deploy-preview",
  );
  if (!previewValue) {
    throw new Error(`${key} is missing its deploy-preview value.`);
  }
  if (!SECRET_KEYS.has(key) && previewValue.value !== expectation.value) {
    throw new Error(`${key} did not retain the expected deploy-preview value.`);
  }
}

console.log(JSON.stringify({
  ok: true,
  siteId: SITE_ID,
  siteName: site.name,
  context: "deploy-preview",
  functionsVariables: FUNCTIONS_KEYS,
  buildsVariables: BUILDS_KEYS,
  secretsPrinted: false,
}, null, 2));

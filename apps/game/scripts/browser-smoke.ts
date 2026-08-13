import fs from "node:fs/promises";
import path from "node:path";

type CdpResponse = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

const cdpPort = Number(process.env.DYOOR_CDP_PORT || 9225);
const smokeMode = process.env.DYOOR_SMOKE_MODE === "holder" ? "holder" : "guest";
const configuredGameUrl = process.env.DYOOR_GAME_URL || "http://127.0.0.1:5173/";
const gameUrl = new URL(configuredGameUrl);
if (smokeMode === "holder") gameUrl.searchParams.set("mock-wallet", "1");
const outputRoot = path.resolve(process.env.DYOOR_SMOKE_OUTPUT || "/private/tmp/dyoor-game-smoke");

const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then((response) => response.json()) as Array<{
  type: string;
  webSocketDebuggerUrl?: string;
}>;
const target = targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
if (!target?.webSocketDebuggerUrl) {
  throw new Error(`No debuggable page found on Chrome DevTools port ${cdpPort}.`);
}

await fs.mkdir(outputRoot, { recursive: true });

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map<number, {
  resolve: (value: CdpResponse) => void;
  reject: (reason: Error) => void;
}>();
const browserErrors: string[] = [];
let commandId = 0;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as CdpResponse;
  if (message.id && pending.has(message.id)) {
    const handler = pending.get(message.id);
    pending.delete(message.id);
    if (message.error?.message) handler?.reject(new Error(message.error.message));
    else handler?.resolve(message);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    browserErrors.push(JSON.stringify(message.params));
  }
  if (message.method === "Log.entryAdded") {
    const entry = (message.params as { entry?: { level?: string; text?: string } } | undefined)?.entry;
    if (entry?.level === "error") browserErrors.push(entry.text || "Unknown browser log error");
  }
});

await new Promise<void>((resolve, reject) => {
  socket.addEventListener("open", () => resolve(), { once: true });
  socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools.")), {
    once: true,
  });
});

function call(method: string, params: Record<string, unknown> = {}) {
  const id = ++commandId;
  const result = new Promise<CdpResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return result;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForGameReady(timeoutMilliseconds = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMilliseconds) {
    try {
      const response = await call("Runtime.evaluate", {
        expression: `Boolean(
          document.querySelector("canvas")
          && window.__DYOOR_GAME_DEV__
          && window.__DYOOR_GAME_DEV__.scene?.getScenes(true)?.length
        )`,
        returnByValue: true,
      });
      const ready = (response.result?.result as { value?: boolean } | undefined)?.value;
      if (ready) return;
    } catch {
      // Navigation can replace the execution context between polling calls.
    }
    await delay(250);
  }
  throw new Error(`Game canvas did not become ready within ${timeoutMilliseconds}ms.`);
}

async function click(x: number, y: number) {
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

async function touch(x: number, y: number) {
  await call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }],
  });
  await delay(80);
  await call("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function screenshot(name: string) {
  const response = await call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const data = String(response.result?.data || "");
  if (!data) throw new Error(`Chrome did not return screenshot data for ${name}.`);
  const outputPath = path.join(outputRoot, `${name}.png`);
  await fs.writeFile(outputPath, Buffer.from(data, "base64"));
  return outputPath;
}

await call("Page.enable");
await call("Runtime.enable");
await call("Log.enable");
await call("Network.enable");
await call("Network.setCacheDisabled", { cacheDisabled: true });
await call("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
  screenWidth: 390,
  screenHeight: 844,
});
await call("Emulation.setTouchEmulationEnabled", {
  enabled: true,
  maxTouchPoints: 5,
});
await call("Page.navigate", { url: "about:blank" });
await delay(250);
await call("Storage.clearDataForOrigin", {
  origin: gameUrl.origin,
  storageTypes: "local_storage",
});
await call("Page.navigate", { url: gameUrl.toString() });
await delay(300);
await waitForGameReady();

const metrics = await call("Runtime.evaluate", {
  expression: `JSON.stringify({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    canvas: (() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        backingWidth: canvas.width,
        backingHeight: canvas.height
      };
    })()
  })`,
  returnByValue: true,
});
const title = await screenshot("01-title-mobile");

await touch(195, smokeMode === "holder" ? 352 : 292);
await delay(900);
const characterSelect = await screenshot("02-character-select-mobile");

await click(195, 782);
await delay(700);
const identity = await screenshot("03-identity-mobile");

await touch(195, 786);
await delay(1_400);
const laboratory = await screenshot("04-laboratory-mobile");

await call("Runtime.evaluate", {
  expression: `(() => {
    const scene = window.__DYOOR_GAME_DEV__?.scene?.getScene("LaboratoryScene");
    scene?.controls?.virtual?.queueParty?.();
  })()`,
});
await delay(300);
const party = await screenshot("05-party-mobile");
let partyReserve: string | null = null;
if (smokeMode === "holder") {
  await touch(195, 432);
  await delay(350);
  partyReserve = await screenshot("05b-party-reserve-active-mobile");
}
const partySwitchState = await call("Runtime.evaluate", {
  expression: `JSON.stringify(JSON.parse(
    localStorage.getItem("dyoor-game-save-v1") || "{}"
  ).party || {})`,
  returnByValue: true,
});
if (smokeMode === "holder") {
  // Activating a reserve promotes it to the first row; the original active
  // Droid therefore moves to the second row for the switch-back check.
  await touch(195, 432);
  await delay(250);
}
await call("Runtime.evaluate", {
  expression: `(() => {
    const scene = window.__DYOOR_GAME_DEV__?.scene?.getScene("LaboratoryScene");
    scene?.controls?.virtual?.queueParty?.();
  })()`,
});
await delay(200);

const interactiveState = await call("Runtime.evaluate", {
  expression: `JSON.stringify((() => {
    const game = window.__DYOOR_GAME_DEV__;
    const scene = game?.scene?.getScene("LaboratoryScene");
    window.__DYOOR_SMOKE_INPUT__ = [];
    scene?.input?.on("pointerdown", (pointer, over) => {
      window.__DYOOR_SMOKE_INPUT__.push({
        event: "pointerdown",
        x: pointer.x,
        y: pointer.y,
        over: over.map((entry) => entry.type)
      });
    });
    scene?.input?.on("gameobjectdown", (pointer, entry) => {
      window.__DYOOR_SMOKE_INPUT__.push({
        event: "gameobjectdown",
        x: pointer.x,
        y: pointer.y,
        type: entry.type
      });
    });
    return (scene?.input?._list || []).map((entry) => ({
      type: entry.type,
      x: entry.x,
      y: entry.y,
      displayWidth: entry.displayWidth,
      displayHeight: entry.displayHeight,
      visible: entry.visible,
      active: entry.active,
      inputEnabled: entry.input?.enabled,
      parentX: entry.parentContainer?.x || 0,
      parentY: entry.parentContainer?.y || 0,
      grandparentX: entry.parentContainer?.parentContainer?.x || 0,
      grandparentY: entry.parentContainer?.parentContainer?.y || 0,
      worldX: entry.getWorldTransformMatrix?.().tx,
      worldY: entry.getWorldTransformMatrix?.().ty,
      scrollFactorX: entry.scrollFactorX,
      scrollFactorY: entry.scrollFactorY
    }));
  })())`,
  returnByValue: true,
});
await touch(318, 758);
await delay(500);
const dialogue = await screenshot("06-dialogue-mobile");
await touch(195, 716);
await delay(180);
await touch(195, 716);
await delay(300);

const questState = await call("Runtime.evaluate", {
  expression: `JSON.stringify(JSON.parse(
    localStorage.getItem("dyoor-game-save-v1") || "{}"
  ).quest || {})`,
  returnByValue: true,
});

const initialEmissionState = await call("Runtime.evaluate", {
  expression: `JSON.stringify(JSON.parse(
    localStorage.getItem("dyoor-game-save-v1") || "{}"
  ).coreEmission || {})`,
  returnByValue: true,
});
await call("Runtime.evaluate", {
  expression: `(() => {
    window.__DYOOR_REAL_NOW__ = Date.now;
    const base = Date.now();
    Date.now = () => base + 3_600_000;
    const scene = window.__DYOOR_GAME_DEV__?.scene?.getScene("LaboratoryScene");
    scene?.persistLocation?.();
    Date.now = window.__DYOOR_REAL_NOW__;
    delete window.__DYOOR_REAL_NOW__;
  })()`,
});
await delay(300);
const passiveEmission = await screenshot("07-passive-emission-mobile");
const accruedEmissionState = await call("Runtime.evaluate", {
  expression: `JSON.stringify(JSON.parse(
    localStorage.getItem("dyoor-game-save-v1") || "{}"
  ).coreEmission || {})`,
  returnByValue: true,
});
await call("Runtime.evaluate", {
  expression: `(() => {
    const scene = window.__DYOOR_GAME_DEV__?.scene?.getScene("LaboratoryScene");
    scene?.player?.setPosition(11 * 32, 11 * 32);
    scene?.handleAction?.();
  })()`,
});
await delay(350);
const emissionDialogue = await screenshot("08-emission-dialogue-mobile");

await call("Runtime.evaluate", {
  expression: `(() => {
    const laboratory = window.__DYOOR_GAME_DEV__?.scene?.getScene("LaboratoryScene");
    laboratory?.scene?.start("BattleScene", {
      returnScene: "IndustrialWastesScene"
    });
  })()`,
});
await delay(900);
const battle = await screenshot("09-battle-mobile");
const battleInteractiveState = await call("Runtime.evaluate", {
  expression: `JSON.stringify((() => {
    const scene = window.__DYOOR_GAME_DEV__?.scene?.getScene("BattleScene");
    scene?.input?.on("gameobjectdown", (pointer, entry) => {
      window.__DYOOR_SMOKE_INPUT__.push({
        event: "battle-gameobjectdown",
        x: pointer.x,
        y: pointer.y,
        type: entry.type
      });
    });
    return (scene?.input?._list || []).map((entry) => ({
      type: entry.type,
      x: entry.x,
      y: entry.y,
      displayWidth: entry.displayWidth,
      displayHeight: entry.displayHeight,
      visible: entry.visible,
      active: entry.active,
      inputEnabled: entry.input?.enabled,
      worldX: entry.getWorldTransformMatrix?.().tx,
      worldY: entry.getWorldTransformMatrix?.().ty
    }));
  })())`,
  returnByValue: true,
});
await call("Runtime.evaluate", {
  expression: `(() => {
    const scene = window.__DYOOR_GAME_DEV__?.scene?.getScene("BattleScene");
    const strikeButton = scene?.buttons?.[0];
    strikeButton?.emit("pointerdown");
    strikeButton?.emit("pointerup");
  })()`,
});
await delay(450);
const battleAction = await screenshot("10-battle-action-mobile");
const battleState = await call("Runtime.evaluate", {
  expression: `JSON.stringify(
    window.__DYOOR_GAME_DEV__?.scene?.getScene("BattleScene")?.state || {}
  )`,
  returnByValue: true,
});

const inputTrace = await call("Runtime.evaluate", {
  expression: "JSON.stringify(window.__DYOOR_SMOKE_INPUT__ || [])",
  returnByValue: true,
});
const savedState = await call("Runtime.evaluate", {
  expression: `JSON.stringify({
    keys: Object.keys(localStorage),
    values: Object.fromEntries(Object.entries(localStorage))
  })`,
  returnByValue: true,
});
const parsedQuestState = JSON.parse(String(
  (questState.result?.result as { value?: string } | undefined)?.value || "{}",
)) as { coreRecovery?: string };
const parsedInitialEmission = JSON.parse(String(
  (initialEmissionState.result?.result as { value?: string } | undefined)?.value || "{}",
)) as { tier?: string; energyPerHour?: number; bankedEnergy?: number };
const parsedAccruedEmission = JSON.parse(String(
  (accruedEmissionState.result?.result as { value?: string } | undefined)?.value || "{}",
)) as {
  tier?: string;
  energyPerHour?: number;
  bankedEnergy?: number;
};
const parsedBattleState = JSON.parse(String(
  (battleState.result?.result as { value?: string } | undefined)?.value || "{}",
)) as { turn?: number };
const parsedInputTrace = JSON.parse(String(
  (inputTrace.result?.result as { value?: string } | undefined)?.value || "[]",
)) as Array<{ event?: string; type?: string }>;
const parsedSavedState = JSON.parse(String(
  (savedState.result?.result as { value?: string } | undefined)?.value || "{}",
)) as { values?: Record<string, string> };
const savedGame = JSON.parse(parsedSavedState.values?.["dyoor-game-save-v1"] || "{}") as {
  mode?: string;
  identity?: { callsign?: string; protocol?: string };
  party?: { members?: unknown[] };
};
const parsedPartySwitch = JSON.parse(String(
  (partySwitchState.result?.result as { value?: string } | undefined)?.value || "{}",
)) as { activeDroidId?: string };
const expectedEmission = smokeMode === "holder"
  ? { label: "Token #16", tier: "rare", energyPerHour: 25 }
  : { label: "Guest Training Droid", tier: "common", energyPerHour: 10 };
const assertionFailures: string[] = [];
if (parsedQuestState.coreRecovery !== "active") assertionFailures.push("Quest dialogue did not start Core Recovery.");
if (
  parsedInitialEmission.tier !== expectedEmission.tier
  || parsedInitialEmission.energyPerHour !== expectedEmission.energyPerHour
) {
  assertionFailures.push(
    `${expectedEmission.label} did not derive the expected `
    + `${expectedEmission.tier} ${expectedEmission.energyPerHour} Energy/hour emission.`,
  );
}
if (
  (parsedAccruedEmission.bankedEnergy || 0) - (parsedInitialEmission.bankedEnergy || 0)
    < expectedEmission.energyPerHour - 0.1
) {
  assertionFailures.push("Passive Core Emission did not accrue during the simulated quest hour.");
}
if (parsedBattleState.turn !== 2) assertionFailures.push("Battle action did not advance to turn 2.");
if (!parsedInputTrace.some((event) => event.event === "gameobjectdown" && event.type === "Arc")) {
  assertionFailures.push("Mobile ACT hitbox did not receive the phone-sized tap.");
}
if (savedGame.mode !== (smokeMode === "holder" ? "wallet" : "guest")) {
  assertionFailures.push(`Expected a ${smokeMode} save but found ${savedGame.mode || "none"}.`);
}
if (!savedGame.identity?.callsign || savedGame.identity.protocol !== "prospector") {
  assertionFailures.push("Field identity was not initialized with a valid callsign and protocol.");
}
const expectedPartySize = smokeMode === "holder" ? 2 : 1;
if (savedGame.party?.members?.length !== expectedPartySize) {
  assertionFailures.push(
    `Expected ${expectedPartySize} admitted party member(s), found `
    + `${savedGame.party?.members?.length ?? "none"}.`,
  );
}
if (
  parsedPartySwitch.activeDroidId
    !== (smokeMode === "holder" ? "mock-s2-132" : "training-unit-01")
) {
  assertionFailures.push("Party reserve activation did not update the active field Droid.");
}
if (browserErrors.length) assertionFailures.push("Browser console or network errors were recorded.");

const report = {
  generatedAt: new Date().toISOString(),
  gameUrl: gameUrl.toString(),
  smokeMode,
  metrics: JSON.parse(String(
    (metrics.result?.result as { value?: string } | undefined)?.value || "{}",
  )),
  screenshots: [
    title,
    characterSelect,
    identity,
    laboratory,
    party,
    ...(partyReserve ? [partyReserve] : []),
    dialogue,
    passiveEmission,
    emissionDialogue,
    battle,
    battleAction,
  ],
  battleInteractiveState: JSON.parse(String(
    (battleInteractiveState.result?.result as { value?: string } | undefined)?.value || "[]",
  )),
  interactiveState: JSON.parse(String(
    (interactiveState.result?.result as { value?: string } | undefined)?.value || "[]",
  )),
  inputTrace: parsedInputTrace,
  questState: parsedQuestState,
  initialEmissionState: parsedInitialEmission,
  accruedEmissionState: parsedAccruedEmission,
  battleState: parsedBattleState,
  savedState: parsedSavedState,
  partySwitchState: parsedPartySwitch,
  browserErrors,
  assertionFailures,
};
await fs.writeFile(
  path.join(outputRoot, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(report, null, 2));
socket.close();

if (assertionFailures.length) process.exitCode = 1;

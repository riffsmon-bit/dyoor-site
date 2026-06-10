import { DYOOR_BUILDER_LAYER_ORDER, DYOOR_BUILDER_RANDOMIZER, DYOOR_BUILDER_TRAITS } from "/src/config/dyoorBuilderTraits.js";
import { DYOOR_BUILDER_RULES } from "/src/config/dyoorBuilderRules.js";
import {
  ASCENSION_BLUEPRINT_LAUNCH_ISO,
  ASCENSION_BLUEPRINT_LIMIT,
  ascensionBlueprintSignMessage,
  normalizeBlueprintTraits,
  normalizeWalletAddress
} from "/src/ascensionBlueprintHelpers.js";

const CANVAS_SIZE = 1024;
const LAYER_BASE_PATH = "/dyoor-builder/layers";
const DOWNLOAD_NAME = "dyoor-droid-pfp.png";
const BLUEPRINT_SHARE_PATH = "/blueprint-share";
const BLUEPRINT_SHARE_IMAGE_PATH = "/blueprint-share-image.png";
const PUBLIC_SITE_ORIGIN = "https://dyoor.netlify.app";

const state = {
  selected: {},
  activeCategory: ""
};

const canvas = document.getElementById("droidCanvas");
const ctx = canvas?.getContext("2d");
const tabsEl = document.getElementById("builderTabs");
const optionsEl = document.getElementById("traitOptions");
const activeTitleEl = document.getElementById("activeTraitTitle");
const warningEl = document.getElementById("builderWarning");
const statusEl = document.getElementById("builderStatus");
const randomizeBtn = document.getElementById("randomizeDroidBtn");
const resetBtn = document.getElementById("resetDroidBtn");
const downloadBtn = document.getElementById("downloadDroidBtn");
const copyBtn = document.getElementById("copyDroidBtn");
const shareBlueprintBtn = document.getElementById("shareBlueprintBtn");
const saveBlueprintBtn = document.getElementById("saveBlueprintBtn");
const shareSavedBlueprintBtn = document.getElementById("shareSavedBlueprintBtn");
const blueprintStatusEl = document.getElementById("blueprintStatus");
const blueprintCounterEl = document.getElementById("blueprintCounter");
const badgeMetaEl = document.getElementById("ascensionBadgeMeta");
const countdownEls = {
  days: document.getElementById("countdownDays"),
  hours: document.getElementById("countdownHours"),
  minutes: document.getElementById("countdownMinutes"),
  seconds: document.getElementById("countdownSeconds")
};

const campaignState = {
  wallet: "",
  launchOpen: false,
  remaining: ASCENSION_BLUEPRINT_LIMIT,
  full: false,
  registration: null,
  saving: false
};

function traitPath(category, file) {
  return `${LAYER_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(file)}`;
}

function fileLabel(file) {
  return String(file || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function selectedBlueprintTraits() {
  const traits = {};
  for (const category of DYOOR_BUILDER_LAYER_ORDER) {
    traits[category.toLowerCase()] = state.selected[category] ? fileLabel(state.selected[category]) : "";
  }
  return normalizeBlueprintTraits(traits);
}

function buildParamsFromSelection(selection = state.selected) {
  const params = new URLSearchParams();
  for (const category of DYOOR_BUILDER_LAYER_ORDER) {
    if (selection[category]) params.set(category, selection[category]);
  }
  return params;
}

function buildUrlFromSelection(selection = state.selected) {
  const params = buildParamsFromSelection(selection);
  return `${window.location.origin}${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
}

function currentBuildUrl() {
  return buildUrlFromSelection(state.selected);
}

function shareOrigin() {
  const fromMeta = document.querySelector('meta[property="og:url"]')?.content
    || document.querySelector('link[rel="canonical"]')?.href
    || "";
  if (fromMeta) {
    try {
      return new URL(fromMeta).origin.replace(/\/$/, "");
    } catch {
      // fall through
    }
  }

  if (window.DYOOR_SITE_ORIGIN && String(window.DYOOR_SITE_ORIGIN).trim()) {
    return String(window.DYOOR_SITE_ORIGIN).trim().replace(/\/$/, "");
  }
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return PUBLIC_SITE_ORIGIN;
  }
  return window.location.origin;
}

function blueprintShareParams(selection = state.selected, saved = false) {
  const params = buildParamsFromSelection(selection);
  if (saved && campaignState.registration) {
    if (campaignState.registration.blueprintId) {
      params.set("blueprintId", campaignState.registration.blueprintId);
    }
    if (campaignState.registration.rank) {
      params.set("rank", String(campaignState.registration.rank));
    }
    params.set("saved", "1");
  }
  return params;
}

function blueprintShareUrl({ saved = false, selection = state.selected } = {}) {
  const params = blueprintShareParams(selection, saved);
  return `${shareOrigin()}${BLUEPRINT_SHARE_PATH}${params.toString() ? `?${params}` : ""}`;
}

function hasSelectedBlueprint() {
  return DYOOR_BUILDER_LAYER_ORDER.some((category) => Boolean(state.selected[category]));
}

function shareTextForBlueprint({ saved = false } = {}) {
  const savedMeta = campaignState.registration
    ? {
        blueprintId: campaignState.registration.blueprintId || "",
        rank: Number(campaignState.registration.rank || 0)
      }
    : null;

  const header = saved && savedMeta
    ? `I just secured ${savedMeta.blueprintId} (Rank #${savedMeta.rank}) in the DYOOR Ascension Blueprint.`
    : "My DYOOR Ascension Blueprint build.";

  return `${header} #DYOOR #Monad`;
}

function openXShare({ saved = false, selection = state.selected } = {}) {
  const text = encodeURIComponent(shareTextForBlueprint({ saved, selection }));
  const url = encodeURIComponent(blueprintShareUrl({ saved, selection }));
  const intentUrl = `https://x.com/intent/tweet?text=${text}&url=${url}`;
  window.open(intentUrl, "_blank", "noopener,noreferrer");
}

function availableCategories() {
  return DYOOR_BUILDER_LAYER_ORDER.filter((category) => {
    const traits = DYOOR_BUILDER_TRAITS[category];
    return Array.isArray(traits) && traits.length > 0;
  });
}

function sameTrait(a, b) {
  return a?.category === b?.category && a?.file === b?.file;
}

function isSelected(trait) {
  return state.selected[trait.category] === trait.file;
}

function selectedCategoriesForRule(rule) {
  const traits = [];
  if (rule?.with) traits.push(rule.with);
  if (rule?.requires) traits.push(rule.requires);
  if (Array.isArray(rule?.allowedWith)) traits.push(...rule.allowedWith);
  if (Array.isArray(rule?.allowedEmptyCategories)) {
    traits.push(...rule.allowedEmptyCategories.map((category) => ({ category })));
  }
  return [...new Set(traits.map((trait) => trait?.category).filter(Boolean))];
}

function onlyWithRuleSatisfied(rule, selected) {
  const allowed = Array.isArray(rule.allowedWith) ? rule.allowedWith : [];
  const allowedEmpty = Array.isArray(rule.allowedEmptyCategories) ? rule.allowedEmptyCategories : [];

  for (const category of selectedCategoriesForRule(rule)) {
    const selectedFile = selected[category] || "";
    if (!selectedFile && allowedEmpty.includes(category)) continue;
    if (allowed.some((item) => item.category === category && item.file === selectedFile)) continue;
    return false;
  }

  return true;
}

function selectedTrait(category) {
  const file = state.selected[category];
  return file ? { category, file } : null;
}

function ruleConflict(candidate) {
  const nextSelected = { ...state.selected, [candidate.category]: candidate.file };

  for (const rule of DYOOR_BUILDER_RULES) {
    if (rule?.type === "disabled" && sameTrait(rule.trait, candidate)) {
      return rule.message || "This trait is disabled for the public builder.";
    }

    if (!rule || !sameTrait(rule.trait, candidate)) continue;

    if (rule.type === "incompatible" && nextSelected[rule.with?.category] === rule.with?.file) {
      return rule.message || "This trait is incompatible with the current build.";
    }

    if (rule.type === "requires" && nextSelected[rule.requires?.category] !== rule.requires?.file) {
      return rule.message || "This trait requires another trait first.";
    }

    if (rule.type === "onlyWith") {
      if (!onlyWithRuleSatisfied(rule, nextSelected)) {
        return rule.message || "This trait only works with selected matching traits.";
      }
    }
  }

  for (const rule of DYOOR_BUILDER_RULES) {
    if (!rule || !rule.trait) continue;
    const selectedFile = nextSelected[rule.trait.category];
    if (selectedFile !== rule.trait.file) continue;

    if (rule.type === "incompatible" && sameTrait(rule.with, candidate)) {
      return rule.message || "This trait is incompatible with the current build.";
    }

    if (
      rule.type === "requires" &&
      candidate.category === rule.requires?.category &&
      candidate.file !== rule.requires?.file
    ) {
      return rule.message || "The current build requires a different trait here.";
    }

    if (rule.type === "onlyWith") {
      if (!onlyWithRuleSatisfied(rule, nextSelected)) {
        return rule.message || "The current build only works with selected matching traits.";
      }
    }
  }

  return "";
}

function validOption(category, file) {
  return !ruleConflict({ category, file });
}

function clearCanvas() {
  if (!ctx) return;
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const gradient = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  gradient.addColorStop(0, "#13091f");
  gradient.addColorStop(0.5, "#061314");
  gradient.addColorStop(1, "#201018");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.strokeStyle = "rgba(66,241,200,.35)";
  ctx.lineWidth = 8;
  ctx.strokeRect(28, 28, CANVAS_SIZE - 56, CANVAS_SIZE - 56);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn("DYOOR builder layer missing or failed to load:", src);
      resolve(null);
    };
    img.src = src;
  });
}

async function renderPreview() {
  clearCanvas();
  const selectedLayers = DYOOR_BUILDER_LAYER_ORDER
    .map((category) => selectedTrait(category))
    .filter(Boolean);

  if (!selectedLayers.length) {
    drawEmptyState();
    setStatus("Add layer assets and allowlist traits to start building.");
    return;
  }

  let loadedCount = 0;
  for (const layer of selectedLayers) {
    const img = await loadImage(traitPath(layer.category, layer.file));
    if (!img) continue;
    ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    loadedCount += 1;
  }

  setStatus(loadedCount ? `${loadedCount} layer${loadedCount === 1 ? "" : "s"} rendered.` : "Selected layers could not be loaded.");
}

function drawEmptyState() {
  if (!ctx) return;
  ctx.fillStyle = "rgba(255,255,255,.86)";
  ctx.font = "800 48px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("D.Y.O.O.R", CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 16);
  ctx.font = "600 24px Inter, Arial, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.62)";
  ctx.fillText("Drop layers into /dyoor-builder/layers", CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 36);
}

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function setBlueprintStatus(message) {
  if (blueprintStatusEl) blueprintStatusEl.textContent = message;
}

function setWarning(message) {
  if (!warningEl) return;
  warningEl.textContent = message || "";
  warningEl.hidden = !message;
}

function renderTabs() {
  const categories = availableCategories();
  tabsEl.innerHTML = "";

  if (!categories.length) {
    state.activeCategory = "";
    tabsEl.innerHTML = '<div class="builderEmpty">No public traits are allowlisted yet.</div>';
    return;
  }

  if (!state.activeCategory || !categories.includes(state.activeCategory)) {
    state.activeCategory = categories[0];
  }

  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `builderTab${category === state.activeCategory ? " is-active" : ""}`;
    button.textContent = category;
    button.addEventListener("click", () => {
      state.activeCategory = category;
      render();
    });
    tabsEl.appendChild(button);
  }
}

function renderOptions() {
  optionsEl.innerHTML = "";
  setWarning("");

  if (!state.activeCategory) {
    activeTitleEl.textContent = "Trait Options";
    optionsEl.innerHTML = '<div class="builderEmpty">Add filenames to the public allowlist config to enable this builder.</div>';
    return;
  }

  const category = state.activeCategory;
  const traits = DYOOR_BUILDER_TRAITS[category] || [];
  activeTitleEl.textContent = category;

  for (const file of traits) {
    const candidate = { category, file };
    const conflict = ruleConflict(candidate);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `traitOption${isSelected(candidate) ? " is-selected" : ""}`;
    button.disabled = Boolean(conflict) && !isSelected(candidate);
    button.title = conflict || fileLabel(file);
    button.innerHTML = `
      <span class="traitOption__name">${fileLabel(file)}</span>
      <span class="traitOption__file">${file}</span>
    `;
    button.addEventListener("click", () => {
      if (button.disabled) {
        setWarning(conflict);
        return;
      }
      state.selected[category] = state.selected[category] === file ? "" : file;
      render();
      renderPreview();
    });
    optionsEl.appendChild(button);
  }
}

function renderSelectedSummary() {
  const summaryEl = document.getElementById("builderSelected");
  if (!summaryEl) return;
  const parts = DYOOR_BUILDER_LAYER_ORDER
    .map((category) => selectedTrait(category))
    .filter(Boolean)
    .map((trait) => `${trait.category}: ${fileLabel(trait.file)}`);

  summaryEl.textContent = parts.length ? parts.join(" / ") : "No traits selected";
}

function renderBlueprintCampaign() {
  const remaining = Math.max(0, Number(campaignState.remaining || 0));
  if (blueprintCounterEl) {
    blueprintCounterEl.textContent = `Ascension Blueprint spots remaining: ${remaining} / ${ASCENSION_BLUEPRINT_LIMIT}`;
  }

  if (campaignState.registration) {
    const rank = Number(campaignState.registration.rank || 0);
    const blueprintId = campaignState.registration.blueprintId || "";
    if (saveBlueprintBtn) {
      saveBlueprintBtn.disabled = true;
      saveBlueprintBtn.textContent = "Ascension Blueprint Secured";
    }
    if (shareSavedBlueprintBtn) {
      shareSavedBlueprintBtn.disabled = false;
    }
    if (badgeMetaEl) badgeMetaEl.textContent = `${blueprintId} / Rank #${rank}`;
    setBlueprintStatus(`Blueprint ID: ${blueprintId} | Rank: #${rank}`);
    return;
  }

  if (badgeMetaEl) badgeMetaEl.textContent = "Blueprint ID / Rank pending";
  if (shareSavedBlueprintBtn) {
    shareSavedBlueprintBtn.disabled = true;
  }

  if (campaignState.full) {
    if (saveBlueprintBtn) {
      saveBlueprintBtn.disabled = true;
      saveBlueprintBtn.textContent = "Ascension Blueprint campaign complete";
    }
    setBlueprintStatus("Wallets after 500 can still build and download PNGs, but do not receive badge eligibility.");
    return;
  }

  if (!campaignState.launchOpen) {
    if (saveBlueprintBtn) {
      saveBlueprintBtn.disabled = true;
      saveBlueprintBtn.textContent = "Save Ascension Blueprint";
    }
    setBlueprintStatus("Save unlocks at launch. Preview and PNG download remain available.");
    return;
  }

  if (saveBlueprintBtn) {
    saveBlueprintBtn.disabled = campaignState.saving;
    saveBlueprintBtn.textContent = campaignState.saving ? "Saving Blueprint..." : "Save Ascension Blueprint";
  }
  if (shareSavedBlueprintBtn) {
    shareSavedBlueprintBtn.disabled = true;
  }
  setBlueprintStatus(campaignState.wallet ? "Connected wallet can save one Ascension Blueprint." : "Connect wallet to save one Ascension Blueprint.");
}

function renderCountdown() {
  const launchMs = Date.parse(ASCENSION_BLUEPRINT_LAUNCH_ISO);
  const remainingMs = launchMs - Date.now();
  campaignState.launchOpen = remainingMs <= 0;

  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (countdownEls.days) countdownEls.days.textContent = String(days).padStart(2, "0");
  if (countdownEls.hours) countdownEls.hours.textContent = String(hours).padStart(2, "0");
  if (countdownEls.minutes) countdownEls.minutes.textContent = String(minutes).padStart(2, "0");
  if (countdownEls.seconds) countdownEls.seconds.textContent = String(seconds).padStart(2, "0");

  renderBlueprintCampaign();
}

async function loadBlueprintStatus() {
  if (!saveBlueprintBtn) return;
  const walletQuery = campaignState.wallet ? `?wallet=${encodeURIComponent(campaignState.wallet)}` : "";
  try {
    const response = await fetch(`/.netlify/functions/ascension-blueprints${walletQuery}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Status unavailable.");
    const data = await response.json();
    campaignState.remaining = data.remaining ?? ASCENSION_BLUEPRINT_LIMIT;
    campaignState.full = Boolean(data.full);
    campaignState.registration = data.registration || null;
  } catch (err) {
    console.warn("Ascension Blueprint status failed", err);
    campaignState.remaining = ASCENSION_BLUEPRINT_LIMIT;
    campaignState.full = false;
  }
  renderBlueprintCampaign();
}

function render() {
  renderTabs();
  renderOptions();
  renderSelectedSummary();
  if (shareBlueprintBtn) {
    shareBlueprintBtn.disabled = !hasSelectedBlueprint();
  }
}

function resetBuild() {
  state.selected = {};
  render();
  renderPreview();
}

function randomizeBuild() {
  const next = {};
  const required = new Set(DYOOR_BUILDER_RANDOMIZER?.requiredCategories || []);
  const chances = DYOOR_BUILDER_RANDOMIZER?.optionalCategoryChances || {};

  for (const category of availableCategories()) {
    const isRequired = required.has(category);
    const chance = Number.isFinite(chances[category]) ? chances[category] : 0.5;
    if (!isRequired && Math.random() > chance) continue;

    const traits = DYOOR_BUILDER_TRAITS[category] || [];
    const options = traits.filter((file) => {
      const previous = state.selected;
      state.selected = next;
      const allowed = validOption(category, file);
      state.selected = previous;
      return allowed;
    });
    if (!options.length) continue;
    next[category] = options[Math.floor(Math.random() * options.length)];
  }
  state.selected = next;
  render();
  renderPreview();
}

function downloadBuild() {
  renderPreview().then(() => {
    const link = document.createElement("a");
    link.download = DOWNLOAD_NAME;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
}

function shareCurrentBlueprint() {
  if (!hasSelectedBlueprint()) {
    setStatus("Select at least one trait before sharing.");
    return;
  }

  openXShare({ saved: false, selection: state.selected });
  setStatus("X share opened.");
}

function shareSavedBlueprint() {
  if (!campaignState.registration) {
    setBlueprintStatus("Save your Blueprint first.");
    return;
  }

  openXShare({
    saved: true,
    selection: campaignState.registration.build || state.selected
  });
  setBlueprintStatus("X share opened.");
}

async function copyBuild() {
  const url = currentBuildUrl();
  try {
    await navigator.clipboard.writeText(url);
    setStatus("Build link copied.");
  } catch (err) {
    console.warn("copy build failed", err);
    setStatus("Copy unavailable in this browser.");
  }
}

async function saveBlueprint() {
  if (!campaignState.launchOpen || campaignState.full || campaignState.registration || campaignState.saving) {
    renderBlueprintCampaign();
    return;
  }

  const wallet = normalizeWalletAddress(window.userAddress || "");
  const signer = window.signer;
  if (!wallet || !signer?.signMessage) {
    setBlueprintStatus("Connect wallet first.");
    document.getElementById("homeWalletBtn")?.click();
    return;
  }

  const traits = selectedBlueprintTraits();
  const build = { ...state.selected };
  campaignState.saving = true;
  renderBlueprintCampaign();

  try {
    const message = await ascensionBlueprintSignMessage(wallet, traits);
    const signature = await signer.signMessage(message);
    const response = await fetch("/.netlify/functions/ascension-blueprints", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, traits, build, message, signature })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "Blueprint save failed.");

    campaignState.remaining = data.remaining ?? campaignState.remaining;
    campaignState.full = Boolean(data.full);
    campaignState.registration = data.registration || null;
    setBlueprintStatus(campaignState.registration ? "Ascension Blueprint Secured" : "Blueprint status updated.");
  } catch (err) {
    console.warn("save blueprint failed", err);
    setBlueprintStatus(err?.message || "Could not save Ascension Blueprint.");
  } finally {
    campaignState.saving = false;
    renderBlueprintCampaign();
  }
}

function loadBuildFromUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const category of DYOOR_BUILDER_LAYER_ORDER) {
    const file = params.get(category);
    if ((DYOOR_BUILDER_TRAITS[category] || []).includes(file)) {
      state.selected[category] = file;
    }
  }
}

function init() {
  if (!canvas || !ctx || !tabsEl || !optionsEl) return;
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  loadBuildFromUrl();
  render();
  renderPreview();
  randomizeBtn?.addEventListener("click", randomizeBuild);
  resetBtn?.addEventListener("click", resetBuild);
  downloadBtn?.addEventListener("click", downloadBuild);
  copyBtn?.addEventListener("click", copyBuild);
  shareBlueprintBtn?.addEventListener("click", shareCurrentBlueprint);
  saveBlueprintBtn?.addEventListener("click", saveBlueprint);
  shareSavedBlueprintBtn?.addEventListener("click", shareSavedBlueprint);
  window.addEventListener("dyoor:wallet", (event) => {
    campaignState.wallet = normalizeWalletAddress(event?.detail?.userAddress || window.userAddress || "");
    loadBlueprintStatus();
  });
  renderCountdown();
  setInterval(renderCountdown, 1000);
  loadBlueprintStatus();
}

init();

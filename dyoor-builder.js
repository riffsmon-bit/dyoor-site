import { DYOOR_BUILDER_LAYER_ORDER, DYOOR_BUILDER_TRAITS } from "/src/config/dyoorBuilderTraits.js";
import { DYOOR_BUILDER_RULES } from "/src/config/dyoorBuilderRules.js";

const CANVAS_SIZE = 1024;
const LAYER_BASE_PATH = "/dyoor-builder/layers";
const DOWNLOAD_NAME = "dyoor-droid-pfp.png";

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

function render() {
  renderTabs();
  renderOptions();
  renderSelectedSummary();
}

function resetBuild() {
  state.selected = {};
  render();
  renderPreview();
}

function randomizeBuild() {
  const next = {};
  for (const category of availableCategories()) {
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

async function copyBuild() {
  const params = new URLSearchParams();
  for (const category of DYOOR_BUILDER_LAYER_ORDER) {
    if (state.selected[category]) params.set(category, state.selected[category]);
  }
  const url = `${window.location.origin}${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
  try {
    await navigator.clipboard.writeText(url);
    setStatus("Build link copied.");
  } catch (err) {
    console.warn("copy build failed", err);
    setStatus("Copy unavailable in this browser.");
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
}

init();

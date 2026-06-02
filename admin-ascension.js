const tokenInput = document.getElementById("adminTokenInput");
const blueprintsBtn = document.getElementById("exportBlueprintsBtn");
const walletsBtn = document.getElementById("exportWalletsBtn");
const statusEl = document.getElementById("adminExportStatus");
const previewEl = document.getElementById("adminJsonPreview");

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadExport() {
  const token = String(tokenInput?.value || "").trim();
  if (!token) throw new Error("Enter admin token first.");

  const response = await fetch("/.netlify/functions/ascension-blueprint-export", {
    headers: {
      "x-ascension-admin-token": token
    },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "Export failed.");
  return data;
}

async function exportData(type) {
  try {
    setStatus("Loading live Netlify Blob export...");
    const data = await loadExport();
    const value = type === "wallets" ? data.wallets : data.blueprints;
    const filename = type === "wallets"
      ? "ascension-blueprint-wallets.json"
      : "ascension-blueprints.json";
    downloadJson(filename, value);
    if (previewEl) previewEl.textContent = JSON.stringify(value, null, 2);
    setStatus(`Exported ${Array.isArray(value) ? value.length : 0} record(s) as ${filename}.`);
  } catch (err) {
    setStatus(err?.message || "Export failed.");
  }
}

blueprintsBtn?.addEventListener("click", () => exportData("blueprints"));
walletsBtn?.addEventListener("click", () => exportData("wallets"));

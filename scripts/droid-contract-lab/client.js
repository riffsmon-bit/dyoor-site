const run = document.querySelector("#run");
const status = document.querySelector("#status");
run.addEventListener("click", async () => {
  run.disabled = true;
  document.querySelector("#results").hidden = true;
  status.textContent = "Running a fresh isolated chain… No wallet request will appear.";
  try {
    const response = await fetch("/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(65000) });
    const report = await response.json();
    if (!response.ok || report.status !== "PASS") throw Error(report.error || "Run did not pass");
    document.querySelector("#run-info").textContent = `Completed ${new Date(report.completedAt).toLocaleString()} · chain ${report.chainId} · local node shut down after testing`;
    for (const [selector, items] of [["#checks", report.verified], ["#receipts", report.receipts.map(item => `${item.label} — ${item.hash} · ${item.gasUsed} gas`)]]) {
      const list = document.querySelector(selector); list.replaceChildren();
      for (const text of items) { const item = document.createElement("li"); item.textContent = text; list.append(item); }
    }
    document.querySelector("#results").hidden = false;
    status.textContent = "Passed. Local custody, mint and authority checks completed.";
  } catch (error) { status.textContent = error instanceof Error ? error.message : "Run failed. No success assumed."; }
  finally { run.disabled = false; }
});

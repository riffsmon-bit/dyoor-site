(function () {
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const state = {
    wallet: localStorage.getItem("dyoorQuestWallet") || "",
    signature: localStorage.getItem("dyoorQuestSignature") || "",
    message: localStorage.getItem("dyoorQuestMessage") || "",
    user: null,
    quests: [],
    completions: [],
    leaderboard: [],
    rank: null,
    filter: "all",
    admin: false,
  };

  function shortAddr(address) {
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";
  }

  function normalizeAddress(address) {
    const value = String(address || "").trim();
    return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : "";
  }

  function setStatus(text, isError = false) {
    const el = qs("#questStatus");
    if (!el) return;
    el.textContent = text;
    el.style.borderColor = isError ? "rgba(255,83,216,.42)" : "rgba(157,104,255,.24)";
  }

  function authPayload(extra = {}) {
    return {
      wallet_address: state.wallet,
      signature: state.signature,
      message: state.message,
      ...extra,
    };
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok || body.ok === false) throw new Error(body.error || `Request failed: ${res.status}`);
    return body;
  }

  async function connectWallet() {
    if (!window.DyoorWalletChooser?.connect) throw new Error("Wallet chooser is unavailable.");
    const connected = await window.DyoorWalletChooser.connect({
      title: "Connect Quest Wallet",
      copy: "Sign a quest login message after connecting. No transaction is sent.",
    });
    const wallet = normalizeAddress(connected.account);
    const messageRes = await api(`/.netlify/functions/quest-session?wallet=${encodeURIComponent(wallet)}`);
    const signature = await connected.signer.signMessage(messageRes.message);
    const session = await api("/.netlify/functions/quest-session", {
      method: "POST",
      body: JSON.stringify({ wallet_address: wallet, message: messageRes.message, signature }),
    });
    state.wallet = wallet;
    state.message = messageRes.message;
    state.signature = signature;
    state.user = session.user;
    state.admin = !!session.admin;
    localStorage.setItem("dyoorQuestWallet", wallet);
    localStorage.setItem("dyoorQuestMessage", state.message);
    localStorage.setItem("dyoorQuestSignature", signature);
    renderWallet();
    await loadState();
    if (qs("#adminRoot")) await loadAdmin();
    setStatus("Wallet signature verified. Quest terminal online.");
  }

  function completionFor(questId) {
    return state.completions.find((entry) => entry.quest_id === questId);
  }

  function badgesFor(row) {
    const badges = [];
    const userCompletions = state.completions.filter((entry) => entry.status === "verified");
    const has = (id) => userCompletions.some((entry) => entry.quest_id === id);
    if (row?.m3sh_connected || has("m3sh-connect")) badges.push("M3SH Connected");
    if (has("hold-s1")) badges.push("S1 Holder");
    if (has("ascended-s1")) badges.push("Ascended");
    if (has("blueprint-architect")) badges.push("Blueprint Architect");
    return badges;
  }

  async function loadState() {
    const suffix = state.wallet ? `?wallet=${encodeURIComponent(state.wallet)}` : "";
    const data = await api(`/.netlify/functions/quest-state${suffix}`);
    state.user = data.user;
    state.quests = data.quests || [];
    state.completions = data.completions || [];
    state.leaderboard = data.leaderboard || [];
    state.rank = data.rank;
    render();
  }

  async function loadLeaderboardOnly() {
    const data = await api("/.netlify/functions/quest-leaderboard");
    state.leaderboard = data.leaderboard || [];
    renderLeaderboard();
  }

  function renderWallet() {
    qsa("[data-wallet-label]").forEach((el) => {
      el.textContent = state.wallet ? `Connected: ${shortAddr(state.wallet)}` : "Connect Wallet";
    });
  }

  function renderStats() {
    const verified = state.completions.filter((entry) => entry.status === "verified").length;
    const pending = state.completions.filter((entry) => entry.status === "pending").length;
    const total = Number(state.user?.total_points || 0);
    const stats = {
      points: total.toLocaleString(),
      completed: verified,
      pending,
      rank: state.rank ? `#${state.rank}` : "-",
    };
    Object.entries(stats).forEach(([key, value]) => {
      const el = qs(`[data-stat="${key}"]`);
      if (el) el.textContent = value;
    });
  }

  function questActionLabel(quest, status) {
    if (status === "verified") return "Verified";
    if (status === "pending") return "Pending Review";
    if (quest.quest_type === "ascension_tutorial") return "Verify Ascended";
    return "Verify";
  }

  function renderQuests() {
    const root = qs("#questGrid");
    if (!root) return;
    const quests = state.quests.filter((quest) => {
      const status = completionFor(quest.id)?.status || "open";
      if (state.filter === "all") return true;
      if (state.filter === "completed") return status === "verified";
      if (state.filter === "pending") return status === "pending";
      return status === "open" || status === "rejected";
    });

    root.innerHTML = quests.map((quest) => {
      const completion = completionFor(quest.id);
      const status = completion?.status || "open";
      const proofPlaceholder = quest.quest_type === "swap"
        ? "Paste tx hash"
        : quest.quest_type.startsWith("x_") || quest.quest_type === "social_follow"
          ? "Paste X profile/post proof"
          : "Optional proof link or note";
      const startButton = quest.quest_type === "ascension_tutorial"
        ? `<a class="btn btn--ghost" href="${quest.external_url || "/stake.html"}">Start Ascension</a>`
        : quest.external_url
          ? `<a class="btn btn--ghost" href="${quest.external_url}" target="${quest.external_url.startsWith("http") ? "_blank" : "_self"}" rel="noreferrer">Open</a>`
          : "";
      return `
        <article class="questCard" data-status="${status}">
          <div class="questCard__top">
            <span class="questType">${quest.quest_type.replace(/_/g, " ")}</span>
            <span class="questPoints">+${Number(quest.points || 0).toLocaleString()} pts</span>
          </div>
          <h2>${quest.title}</h2>
          <p>${quest.description}</p>
          <div class="questProgress" aria-hidden="true"><span></span></div>
          <div class="proofBox">
            <input class="proofInput" data-proof="${quest.id}" type="text" placeholder="${proofPlaceholder}" value="${completion?.proof_url || completion?.proof_text || completion?.tx_hash || ""}">
            <div class="questCard__actions">
              ${startButton}
              <button class="btn btn--primary" type="button" data-verify="${quest.id}" ${status === "verified" ? "disabled" : ""}>${questActionLabel(quest, status)}</button>
            </div>
            <span class="adminMeta">${status === "open" ? "Not started" : status}</span>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderLeaderboard() {
    const root = qs("#leaderboardRows");
    if (!root) return;
    root.innerHTML = state.leaderboard.map((row) => {
      const rowBadges = [
        row.m3sh_connected ? "M3SH Connected" : "",
        Number(row.completed_quest_count || 0) >= 1 ? "Quest Active" : "",
      ].filter(Boolean);
      return `
        <tr>
          <td>#${row.rank || "-"}</td>
          <td>${shortAddr(row.wallet_address)}</td>
          <td>${row.x_username || "-"}</td>
          <td>${row.discord_username || "-"}</td>
          <td>${Number(row.total_points || 0).toLocaleString()}</td>
          <td>${Number(row.completed_quest_count || 0)}</td>
          <td>${rowBadges.map((badge) => `<span class="badge">${badge}</span>`).join(" ") || "-"}</td>
        </tr>
      `;
    }).join("");
  }

  function renderBadges() {
    const root = qs("#questBadges");
    if (!root) return;
    const badges = badgesFor(state.user);
    root.innerHTML = badges.length ? badges.map((badge) => `<span class="badge">${badge}</span>`).join("") : `<span class="badge">No badges yet</span>`;
  }

  function render() {
    renderWallet();
    renderStats();
    renderQuests();
    renderLeaderboard();
    renderBadges();
  }

  async function verifyQuest(questId) {
    if (!state.wallet || !state.signature) {
      await connectWallet();
    }
    const input = qs(`[data-proof="${questId}"]`);
    const proof = input?.value?.trim() || "";
    setStatus("Verifying quest...");
    const data = await api("/.netlify/functions/quest-verify", {
      method: "POST",
      body: JSON.stringify(authPayload({
        quest_id: questId,
        proof_text: proof,
        proof_url: /^https?:\/\//i.test(proof) ? proof : "",
        tx_hash: /^0x[a-fA-F0-9]{64}$/.test(proof) ? proof : "",
      })),
    });
    await loadState();
    setStatus(data.status === "verified" ? "Quest verified. Points updated." : "Proof submitted. Admin review pending.");
  }

  async function adminRequest(action, extra = {}) {
    return api("/.netlify/functions/quest-admin", {
      method: "POST",
      body: JSON.stringify(authPayload({ action, ...extra })),
    });
  }

  async function loadAdmin() {
    const root = qs("#adminRoot");
    if (!root) return;
    if (!state.wallet || !state.signature) {
      root.innerHTML = `<div class="adminPanel"><h2>Admin wallet required</h2><p class="muted">Connect an address listed in ADMIN_WALLETS to manage quests.</p></div>`;
      return;
    }
    try {
      const data = await adminRequest("dashboard");
      renderAdmin(data);
    } catch (err) {
      root.innerHTML = `<div class="adminPanel"><h2>Admin locked</h2><p class="muted">${err.message}</p></div>`;
      setStatus(err.message, true);
    }
  }

  function renderAdmin(data) {
    const root = qs("#adminRoot");
    if (!root) return;
    root.innerHTML = `
      <div class="adminGrid">
        <section class="adminPanel">
          <h2>Create / Edit Quest</h2>
          <form class="adminForm" id="questForm">
            <input class="adminInput" name="id" placeholder="quest-id" required>
            <input class="adminInput" name="title" placeholder="Title" required>
            <input class="adminInput" name="description" placeholder="Description" required>
            <input class="adminInput" name="quest_type" placeholder="quest_type" required>
            <input class="adminInput" name="verification_method" placeholder="verification_method" required>
            <input class="adminInput" name="external_url" placeholder="External URL">
            <input class="adminInput" name="points" type="number" placeholder="Points" required>
            <input class="adminInput" name="sort_order" type="number" placeholder="Sort order">
            <label class="adminMeta"><input name="active" type="checkbox" checked> Active</label>
            <button class="btn btn--primary" type="submit">Save Quest</button>
          </form>
          <div class="questActions">
            <button class="btn btn--ghost" type="button" id="exportCsvBtn">Export CSV</button>
            <input class="adminInput" id="winnerCount" type="number" min="1" max="100" value="3" aria-label="Winner count">
            <button class="btn btn--primary" type="button" id="pickWinnersBtn">Pick Winners</button>
          </div>
          <div id="winnerOutput" class="questStatus"></div>
        </section>
        <section class="adminPanel">
          <h2>Pending Approvals</h2>
          <div class="adminRows">
            ${(data.completions || []).filter((entry) => entry.status === "pending").map((entry) => `
              <div class="adminRow">
                <strong>${entry.quest_id}</strong>
                <div class="adminMeta">User: ${entry.user_id}<br>Proof: ${entry.proof_url || entry.proof_text || entry.tx_hash || "none"}</div>
                <div class="questActions">
                  <button class="btn btn--primary" type="button" data-approve="${entry.id}">Approve</button>
                  <button class="btn btn--ghost" type="button" data-reject="${entry.id}">Reject</button>
                </div>
              </div>
            `).join("") || `<p class="muted">No pending approvals.</p>`}
          </div>
        </section>
        <section class="adminPanel">
          <h2>Quests</h2>
          <div class="adminRows">
            ${(data.quests || []).map((quest) => `
              <div class="adminRow">
                <strong>${quest.title}</strong>
                <div class="adminMeta">${quest.id} | ${quest.quest_type} | ${quest.points} pts | ${quest.active ? "active" : "inactive"}</div>
              </div>
            `).join("")}
          </div>
        </section>
        <section class="adminPanel">
          <h2>Suspicious Users</h2>
          <div class="adminRows">
            ${(data.suspicious || []).map((entry) => `
              <div class="adminRow">
                <strong>${entry.wallet_address || entry.user_id || "Unknown"}</strong>
                <div class="adminMeta">${entry.reason}<br>${entry.status}</div>
              </div>
            `).join("") || `<p class="muted">No suspicious users logged.</p>`}
          </div>
        </section>
      </div>
    `;
  }

  function bindEvents() {
    qsa("[data-connect-quest]").forEach((button) => button.addEventListener("click", async () => {
      try { await connectWallet(); } catch (err) { setStatus(err.message, true); }
    }));

    qsa(".questTab").forEach((button) => button.addEventListener("click", () => {
      state.filter = button.dataset.filter || "all";
      qsa(".questTab").forEach((tab) => tab.classList.toggle("is-active", tab === button));
      renderQuests();
    }));

    document.addEventListener("click", async (event) => {
      const verifyBtn = event.target.closest("[data-verify]");
      if (verifyBtn) {
        try { await verifyQuest(verifyBtn.dataset.verify); } catch (err) { setStatus(err.message, true); }
      }

      const approveBtn = event.target.closest("[data-approve]");
      if (approveBtn) {
        await adminRequest("approve_completion", { completion_id: approveBtn.dataset.approve });
        await loadAdmin();
      }

      const rejectBtn = event.target.closest("[data-reject]");
      if (rejectBtn) {
        await adminRequest("reject_completion", { completion_id: rejectBtn.dataset.reject });
        await loadAdmin();
      }

      if (event.target.closest("#pickWinnersBtn")) {
        const count = Number(qs("#winnerCount")?.value || 1);
        const data = await adminRequest("pick_winners", { count });
        qs("#winnerOutput").textContent = data.winners.map((winner) => `${shortAddr(winner.wallet_address)} (${winner.total_points} pts)`).join(" | ");
      }

      if (event.target.closest("#exportCsvBtn")) {
        const res = await fetch("/.netlify/functions/quest-export", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(authPayload()),
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "dyoor-quest-wallets.csv";
        a.click();
        URL.revokeObjectURL(url);
      }
    });

    document.addEventListener("submit", async (event) => {
      if (event.target.id !== "questForm") return;
      event.preventDefault();
      const fd = new FormData(event.target);
      const quest = Object.fromEntries(fd.entries());
      quest.active = fd.get("active") === "on";
      quest.points = Number(quest.points || 0);
      quest.sort_order = Number(quest.sort_order || 0);
      await adminRequest("save_quest", { quest });
      await loadAdmin();
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    renderWallet();
    try {
      if (qs("#questGrid")) await loadState();
      if (qs("#leaderboardRows") && !qs("#questGrid")) await loadLeaderboardOnly();
      if (qs("#adminRoot")) await loadAdmin();
    } catch (err) {
      setStatus(err.message, true);
    }
  });
})();

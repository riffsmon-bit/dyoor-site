(function () {
  const root = document.getElementById("kuruSwap");
  if (!root) return;

  const CHAIN_ID_DEC = 143;
  const CHAIN_ID_HEX = "0x8f";
  const MONAD_RPC = "https://rpc.monad.xyz";
  const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
  const LOCAL_TOKENS = "/tokenlist.monad.json";
  const COMMUNITY_TOKENS = "https://raw.githubusercontent.com/monad-crypto/token-list/main/tokenlist.json";
  const TOKEN_CACHE_KEY = "dyoor_kuru_tokens_v4";
  let supportFeeBps = Number(root.dataset.feeBps || "20");
  let treasury = root.dataset.treasury || "";

  const els = {
    account: document.getElementById("swapAccountLine"),
    fromTokenBtn: document.getElementById("fromTokenBtn"),
    toTokenBtn: document.getElementById("toTokenBtn"),
    fromLogo: document.getElementById("fromLogo"),
    toLogo: document.getElementById("toLogo"),
    fromLabel: document.getElementById("fromTokenLabel"),
    toLabel: document.getElementById("toTokenLabel"),
    fromName: document.getElementById("fromTokenName"),
    toName: document.getElementById("toTokenName"),
    fromBal: document.getElementById("fromBal"),
    toBal: document.getElementById("toBal"),
    fromAmt: document.getElementById("fromAmt"),
    toAmt: document.getElementById("toAmt"),
    max: document.getElementById("maxBtn"),
    flip: document.getElementById("flipBtn"),
    status: document.getElementById("statusBox"),
    route: document.getElementById("routeLine"),
    priceImpact: document.getElementById("priceImpactLine"),
    approval: document.getElementById("approvalLine"),
    quoteDebug: document.getElementById("quoteDebugLine"),
    slippage: document.getElementById("slippageInput"),
    supportHint: document.getElementById("supportHint"),
    swap: document.getElementById("swapBtn"),
    tokenModal: document.getElementById("tokenModal"),
    tokenSearch: document.getElementById("tokenSearch"),
    tokenList: document.getElementById("tokenList"),
    tokenQuick: document.getElementById("tokenQuickRow"),
    tabPopular: document.getElementById("tabPopular"),
    tabAll: document.getElementById("tabAll"),
  };

  const baseTokens = [
    { symbol: "MON", name: "Monad", address: NATIVE, decimals: 18, logoURI: "https://raw.githubusercontent.com/monad-crypto/token-list/main/mainnet/MON/logo.svg" },
    { symbol: "WMON", name: "Wrapped MON", address: WMON, decimals: 18, chainId: 143, logoURI: "https://raw.githubusercontent.com/monad-crypto/token-list/main/mainnet/WMON/logo.svg" },
    { symbol: "USDC", name: "USD Coin", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6, chainId: 143, logoURI: "https://raw.githubusercontent.com/monad-crypto/token-list/main/mainnet/USDC/logo.svg" },
    { symbol: "BOB", name: "BOB", address: "0x21E325B059Cd83d4037C82F0F5998Ba2dF3d7777", decimals: 18, chainId: 143, logoURI: "/assets/tokens/bob.png", popular: true },
    { symbol: "PamPam", name: "PamPam", address: "0x44812436147d162CE0A6b573DBCC7492eF117777", decimals: 18, chainId: 143, logoURI: "/tokens/pampam-token.png", popular: true },
  ];

  let tokens = baseTokens.slice();
  let provider = null;
  let account = null;
  let fromToken = baseTokens[0];
  let toToken = baseTokens[2];
  let tokenTarget = "from";
  let tokenTab = "popular";
  let quoteTimer = null;
  let quoteInFlight = false;
  let quotePending = false;
  let quoteSeq = 0;
  let lastQuote = null;
  let fromBalanceRaw = null;
  let action = "connect";

  function isAddr(value) {
    return /^0x[a-fA-F0-9]{40}$/.test(value || "");
  }

  function shortAddr(value) {
    return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "";
  }

  function isNative(token) {
    return String(token?.address || "").toLowerCase() === NATIVE;
  }

  function normalizeLogo(uri) {
    if (!uri) return "";
    if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
    return uri;
  }

  function badge(symbol) {
    const label = String(symbol || "TOK").slice(0, 3).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#9d68ff"/><stop offset="100%" stop-color="#42f1c8"/></linearGradient></defs><circle cx="48" cy="48" r="48" fill="url(#g)"/><text x="48" y="58" text-anchor="middle" font-family="Arial" font-size="26" font-weight="800" fill="white">${label}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function setLogo(img, token) {
    if (!img) return;
    const fallback = badge(token?.symbol);
    img.onerror = () => {
      img.onerror = null;
      img.src = fallback;
    };
    img.src = normalizeLogo(token?.logoURI) || fallback;
  }

  function appendLogo(parent, token) {
    if (!parent) return;
    const img = document.createElement("img");
    img.className = "tokenRow__logo";
    img.alt = "";
    setLogo(img, token);
    parent.appendChild(img);
  }

  function setStatus(text, kind = "") {
    if (!els.status) return;
    els.status.className = `swapStatusBox ${kind}`.trim();
    els.status.textContent = text;
  }

  function setRoute(text) {
    if (els.route) els.route.textContent = text || "Route: -";
  }

  function setQuoteDebug(text) {
    if (els.quoteDebug) els.quoteDebug.textContent = text || "Quote API: waiting";
  }

  function parseUnits(value, decimals) {
    const raw = String(value || "").trim();
    if (!raw || !/^\d*\.?\d*$/.test(raw)) return null;
    const [wholeRaw, fracRaw = ""] = raw.split(".");
    const whole = BigInt(wholeRaw || "0");
    const frac = BigInt((fracRaw + "0".repeat(decimals)).slice(0, decimals) || "0");
    return whole * (10n ** BigInt(decimals)) + frac;
  }

  function formatUnits(value, decimals, maxFrac = 6) {
    try {
      const amount = BigInt(value);
      const base = 10n ** BigInt(decimals);
      const whole = amount / base;
      let frac = (amount % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
      return frac ? `${whole}.${frac}` : whole.toString();
    } catch (_err) {
      return "-";
    }
  }

  function pad32(value) {
    return String(value).toLowerCase().replace(/^0x/, "").padStart(64, "0");
  }

  function hexAmount(value) {
    return BigInt(value).toString(16).padStart(64, "0");
  }

  async function call(to, data) {
    return provider.request({ method: "eth_call", params: [{ to, data }, "latest"] });
  }

  async function readERC20(token, selector, args = "") {
    const res = await call(token, selector + args);
    return BigInt(res || "0x0");
  }

  async function readBalance(token, owner) {
    if (isNative(token)) {
      const res = await provider.request({ method: "eth_getBalance", params: [owner, "latest"] });
      return BigInt(res);
    }
    return readERC20(token.address, "0x70a08231", pad32(owner));
  }

  async function readAllowance(token, owner, spender) {
    return readERC20(token.address, "0xdd62ed3e", pad32(owner) + pad32(spender));
  }

  async function sendTx(tx) {
    const req = { from: account, to: tx.to, data: tx.data || "0x" };
    if (tx.value && BigInt(tx.value) > 0n) req.value = "0x" + BigInt(tx.value).toString(16);
    return provider.request({ method: "eth_sendTransaction", params: [req] });
  }

  async function waitReceipt(hash) {
    const started = Date.now();
    while (Date.now() - started < 120000) {
      const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null);
      if (receipt?.blockNumber) return receipt;
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
    throw new Error("RPC failure: timed out waiting for confirmation");
  }

  async function ensureChain() {
    if (!provider?.request) return false;
    const id = await provider.request({ method: "eth_chainId" }).catch(() => "");
    if (String(id).toLowerCase() === CHAIN_ID_HEX) return true;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
      return true;
    } catch (_switchErr) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CHAIN_ID_HEX,
            chainName: "Monad",
            rpcUrls: [MONAD_RPC],
            nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
            blockExplorerUrls: ["https://monadscan.com"],
          }],
        });
        return true;
      } catch (_addErr) {
        setStatus("Wrong network. Switch to Monad to swap.", "err");
        return false;
      }
    }
  }

  async function connect() {
    try {
      if (window.DyoorWalletChooser?.connect) {
        const connected = await window.DyoorWalletChooser.connect({
          title: "Connect Wallet",
          copy: "Connect on Monad to quote, approve, and swap through Kuru Flow.",
        });
        provider = connected.provider;
        account = connected.account;
      } else {
        provider = window.ethereum;
        if (!provider?.request) throw new Error("No wallet detected. Use WalletConnect to stay in Safari.");
        await ensureChain();
        const accounts = await provider.request({ method: "eth_requestAccounts" });
        account = accounts?.[0] || null;
      }
      if (!account) throw new Error("Wallet did not return an account.");
      bindProviderEvents();
      updateWallet();
      await refreshBalances();
      setStatus("Connected. Enter an amount for a Kuru Flow route.", "ok");
      scheduleQuote();
    } catch (err) {
      setStatus(err?.message || "Wallet connection rejected.", "err");
    }
  }

  function syncFromSharedWallet() {
    const nextProvider = window.__activeEvmProvider || null;
    const nextAccount = window.userAddress || null;
    const changed = nextProvider !== provider || String(nextAccount || "").toLowerCase() !== String(account || "").toLowerCase();
    provider = nextProvider;
    account = nextAccount;
    if (changed) {
      bindProviderEvents();
      updateWallet();
      refreshBalances();
      scheduleQuote();
    }
    return !!provider && !!account;
  }

  function bindProviderEvents() {
    if (!provider?.on || provider.__dyoorSwapBound) return;
    provider.__dyoorSwapBound = true;
    provider.on("accountsChanged", (accounts) => {
      account = accounts?.[0] || null;
      updateWallet();
      refreshBalances();
      scheduleQuote();
    });
    provider.on("chainChanged", () => {
      setStatus("Network changed. Verify Monad before swapping.", "warn");
      updateCTA();
    });
  }

  async function trySilentConnect() {
    const injected = window.ethereum || window.okxwallet?.ethereum || window.phantom?.ethereum;
    if (!injected?.request) return;
    try {
      const accounts = await injected.request({ method: "eth_accounts" });
      if (!accounts?.[0]) return;
      provider = injected;
      account = accounts[0];
      bindProviderEvents();
      updateWallet();
      await refreshBalances();
      scheduleQuote();
    } catch (_err) {}
  }

  function updateWallet() {
    const label = account ? shortAddr(account) : "Not connected";
    if (els.account) els.account.textContent = account ? `Monad - ${label}` : "Not connected";
    updateCTA();
  }

  function updateTokenUI() {
    setLogo(els.fromLogo, fromToken);
    setLogo(els.toLogo, toToken);
    if (els.fromLabel) els.fromLabel.textContent = fromToken.symbol;
    if (els.toLabel) els.toLabel.textContent = toToken.symbol;
    if (els.fromName) els.fromName.textContent = fromToken.name;
    if (els.toName) els.toName.textContent = toToken.name;
  }

  async function refreshBalances() {
    if (!account || !provider) {
      if (els.fromBal) els.fromBal.textContent = "Balance: -";
      if (els.toBal) els.toBal.textContent = "Balance: -";
      return;
    }
    try {
      fromBalanceRaw = await readBalance(fromToken, account);
      const toBalance = await readBalance(toToken, account);
      if (els.fromBal) els.fromBal.textContent = `Balance: ${formatUnits(fromBalanceRaw, fromToken.decimals)} ${fromToken.symbol}`;
      if (els.toBal) els.toBal.textContent = `Balance: ${formatUnits(toBalance, toToken.decimals)} ${toToken.symbol}`;
    } catch (_err) {
      if (els.fromBal) els.fromBal.textContent = "Balance: -";
      if (els.toBal) els.toBal.textContent = "Balance: -";
    }
  }

  function mergeTokenLists(lists) {
    const map = new Map();
    for (const token of baseTokens) map.set(token.address.toLowerCase(), { ...token, logoURI: normalizeLogo(token.logoURI) });
    for (const list of lists) {
      for (const token of list || []) {
        if (!token?.address || token.chainId !== CHAIN_ID_DEC) continue;
        const key = token.address.toLowerCase();
        map.set(key, {
          ...map.get(key),
          symbol: token.symbol || map.get(key)?.symbol || "TOKEN",
          name: token.name || map.get(key)?.name || "Token",
          address: token.address,
          decimals: Number(token.decimals ?? map.get(key)?.decimals ?? 18),
          chainId: CHAIN_ID_DEC,
          logoURI: normalizeLogo(token.logoURI || map.get(key)?.logoURI || ""),
          popular: Boolean(token.popular ?? map.get(key)?.popular),
        });
      }
    }
    const priority = new Map([
      ["MON", 0],
      ["WMON", 1],
      ["USDC", 2],
      ["BOB", 3],
      ["PamPam", 4],
      ["CHOG", 5],
      ["emo", 6],
      ["AUSD", 7],
      ["WETH", 8],
      ["sMON", 9],
      ["gMON", 10],
      ["shMON", 11],
      ["CETES", 12],
    ]);
    return Array.from(map.values()).sort((a, b) => {
      const pa = priority.get(a.symbol) ?? 99;
      const pb = priority.get(b.symbol) ?? 99;
      return pa === pb ? String(a.symbol).localeCompare(String(b.symbol)) : pa - pb;
    });
  }

  async function fetchJson(url, timeout = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadTokens() {
    try {
      const cached = JSON.parse(localStorage.getItem(TOKEN_CACHE_KEY) || "null");
      if (cached?.ts && Date.now() - cached.ts < 86400000 && Array.isArray(cached.tokens)) {
        tokens = mergeTokenLists([cached.tokens]);
        return;
      }
    } catch (_err) {}
    const lists = [];
    for (const url of [LOCAL_TOKENS, COMMUNITY_TOKENS]) {
      try {
        const data = await fetchJson(url);
        lists.push(Array.isArray(data) ? data : data.tokens);
      } catch (_err) {}
    }
    tokens = mergeTokenLists(lists);
    try {
      localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ ts: Date.now(), tokens }));
    } catch (_err) {}
  }

  async function loadCustomToken(address) {
    if (!provider?.request || !isAddr(address)) return null;
    const existing = tokens.find((token) => token.address.toLowerCase() === address.toLowerCase());
    if (existing) return existing;
    try {
      const [decRaw, symbolRaw, nameRaw] = await Promise.all([
        call(address, "0x313ce567"),
        call(address, "0x95d89b41"),
        call(address, "0x06fdde03"),
      ]);
      const token = {
        symbol: decodeString(symbolRaw) || "CUSTOM",
        name: decodeString(nameRaw) || "Custom token",
        address,
        decimals: Number(BigInt(decRaw || "0x12")),
        chainId: CHAIN_ID_DEC,
        logoURI: "",
      };
      tokens = mergeTokenLists([tokens, [token]]);
      return token;
    } catch (_err) {
      setStatus("Custom token lookup failed. Verify the Monad token address.", "err");
      return null;
    }
  }

  function decodeString(hex) {
    try {
      const clean = String(hex || "").replace(/^0x/, "");
      if (!clean) return "";
      const offset = Number(BigInt("0x" + clean.slice(0, 64))) * 2;
      const len = Number(BigInt("0x" + clean.slice(offset, offset + 64))) * 2;
      const body = clean.slice(offset + 64, offset + 64 + len);
      return decodeURIComponent(body.match(/.{1,2}/g).map((byte) => `%${byte}`).join("")).replace(/\0/g, "");
    } catch (_err) {
      try {
        return String.fromCharCode(...String(hex || "").replace(/^0x/, "").match(/.{1,2}/g).map((byte) => parseInt(byte, 16))).replace(/\0/g, "").trim();
      } catch (_err2) {
        return "";
      }
    }
  }

  function visibleTokens() {
    if (tokenTab === "all") return tokens;
    const priority = ["MON", "WMON", "USDC", "BOB", "PamPam", "CHOG", "emo", "AUSD", "WETH", "sMON", "gMON", "shMON", "CETES", "USDT0", "WBTC"];
    const picked = priority.map((symbol) => tokens.find((token) => token.symbol === symbol)).filter(Boolean);
    for (const token of tokens) {
      if (picked.length >= 18) break;
      if (!picked.some((item) => item.address.toLowerCase() === token.address.toLowerCase())) picked.push(token);
    }
    return picked;
  }

  function renderQuickTokens() {
    if (!els.tokenQuick) return;
    els.tokenQuick.innerHTML = "";
    for (const symbol of ["MON", "WMON", "USDC", "BOB", "PamPam", "CHOG", "emo", "AUSD", "WETH", "sMON", "gMON", "shMON"]) {
      const token = tokens.find((item) => item.symbol === symbol);
      if (!token) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tokenQuick";
      btn.textContent = symbol;
      btn.addEventListener("click", () => selectToken(token));
      els.tokenQuick.appendChild(btn);
    }
  }

  function renderTokenList() {
    if (!els.tokenList) return;
    const query = String(els.tokenSearch?.value || "").trim().toLowerCase();
    els.tokenList.innerHTML = "";

    if (isAddr(query)) {
      const custom = document.createElement("button");
      custom.type = "button";
      custom.className = "tokenRow";
      custom.innerHTML = `<div class="tokenRow__icon tokenRow__icon--fallback"></div><div class="tokenRow__meta"><div class="tokenRow__sym">Import token</div><div class="tokenRow__name">Use custom Monad token address</div></div><div class="tokenRow__addr">${shortAddr(query)}</div>`;
      custom.addEventListener("click", async () => {
        const token = await loadCustomToken(query);
        if (token) selectToken(token);
      });
      els.tokenList.appendChild(custom);
    }

    const list = visibleTokens().filter((token) => {
      if (!query || isAddr(query)) return true;
      return [token.symbol, token.name, token.address].some((part) => String(part || "").toLowerCase().includes(query));
    });

    for (const token of list) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tokenRow";
      row.innerHTML = `<div class="tokenRow__icon"></div><div class="tokenRow__meta"><div class="tokenRow__sym">${token.symbol}</div><div class="tokenRow__name">${token.name}</div></div><div class="tokenRow__addr">${shortAddr(token.address)}</div>`;
      appendLogo(row.querySelector(".tokenRow__icon"), token);
      row.addEventListener("click", () => selectToken(token));
      els.tokenList.appendChild(row);
    }

    if (!els.tokenList.children.length) {
      const empty = document.createElement("div");
      empty.className = "tokenEmpty";
      empty.textContent = "No token found.";
      els.tokenList.appendChild(empty);
    }
  }

  function openTokenModal(target) {
    tokenTarget = target;
    els.tokenModal?.classList.add("isOpen");
    els.tokenModal?.setAttribute("aria-hidden", "false");
    if (els.tokenSearch) els.tokenSearch.value = "";
    renderQuickTokens();
    renderTokenList();
    setTimeout(() => els.tokenSearch?.focus(), 30);
  }

  function closeTokenModal() {
    els.tokenModal?.classList.remove("isOpen");
    els.tokenModal?.setAttribute("aria-hidden", "true");
  }

  function selectToken(token) {
    if (tokenTarget === "from") fromToken = token;
    else toToken = token;
    if (fromToken.address.toLowerCase() === toToken.address.toLowerCase()) {
      if (tokenTarget === "from") toToken = tokens.find((item) => item.symbol === "USDC") || baseTokens[2];
      else fromToken = baseTokens[0];
    }
    lastQuote = null;
    if (els.toAmt) els.toAmt.textContent = "-";
    updateTokenUI();
    refreshBalances();
    closeTokenModal();
    scheduleQuote();
  }

  function slippageBps() {
    const pct = Math.max(0.01, Math.min(50, Number(els.slippage?.value || "0.5")));
    return Math.floor(pct * 100);
  }

  function supportEnabled() {
    return isAddr(treasury) && supportFeeBps > 0;
  }

  function updateSupportCopy() {
    if (els.supportHint) {
      const status = supportEnabled() ? "included" : "not configured";
      els.supportHint.textContent = `Fee: ${(supportFeeBps / 100).toFixed(2)}% ${status} | Treasury: ${treasury ? shortAddr(treasury) : "not configured"}`;
    }
  }

  function scheduleQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(getQuote, 900);
  }

  async function getQuote() {
    if (quoteInFlight) {
      quotePending = true;
      return;
    }
    const seq = ++quoteSeq;
    quoteInFlight = true;
    lastQuote = null;
    syncFromSharedWallet();
    updateCTA();
    if (!account) {
      setStatus("Connect wallet from the header to fetch Kuru Flow routes.", "warn");
      setQuoteDebug("Quote API: waiting for wallet");
      quoteInFlight = false;
      return;
    }
    if (!await ensureChain()) {
      quoteInFlight = false;
      return;
    }

    const amount = parseUnits(els.fromAmt?.value, fromToken.decimals);
    if (!amount || amount <= 0n) {
      if (els.toAmt) els.toAmt.textContent = "-";
      setRoute("Route: -");
      setQuoteDebug("Quote API: waiting for amount");
      setStatus("Enter an amount. Quotes update automatically.", "");
      quoteInFlight = false;
      return;
    }

    await refreshBalances();
    if (fromBalanceRaw != null && amount > fromBalanceRaw) {
      setStatus("Insufficient balance.", "err");
      setQuoteDebug("Quote API: blocked by balance check");
      quoteInFlight = false;
      return;
    }

    setStatus("Fetching Kuru Flow quote...", "");
    setQuoteDebug("Quote API: requesting local function");
    const params = new URLSearchParams({
      sellToken: fromToken.address,
      buyToken: toToken.address,
      sellAmount: amount.toString(),
      chainId: String(CHAIN_ID_DEC),
      slippageBps: String(slippageBps()),
      taker: account,
      support: supportEnabled() ? "1" : "0",
    });

    try {
      const endpoint = `/.netlify/functions/quote?${params.toString()}`;
      const res = await fetch(endpoint, { cache: "no-cache" });
      const text = await res.text();
      if (seq !== quoteSeq) return;
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_err) {
        throw new Error(`Quote endpoint returned non-JSON HTTP ${res.status}: ${text.slice(0, 120)}`);
      }
      if (!res.ok) {
        const err = new Error(data?.error || `Quote endpoint HTTP ${res.status}.`);
        err.status = res.status;
        throw err;
      }
      if (!data?.transaction) throw new Error(data?.error || "No executable route returned by Kuru Flow.");

      lastQuote = data;
      if (data.fee?.bps != null) supportFeeBps = Number(data.fee.bps);
      if (data.fee?.recipient) treasury = data.fee.recipient;
      updateSupportCopy();
      if (els.toAmt) els.toAmt.textContent = formatUnits(data.buyAmount, toToken.decimals);
      setRoute(`Route: ${data.route?.label || "Kuru Flow"}${Array.isArray(data.route?.path) && data.route.path.length ? ` - ${data.route.path.length} market hop${data.route.path.length === 1 ? "" : "s"}` : ""}`);
      const impact = Number(data.priceImpactBps);
      if (els.priceImpact) els.priceImpact.textContent = Number.isFinite(impact) ? `Price impact: ${(impact / 100).toFixed(2)}%` : "Price impact: unavailable";
      setQuoteDebug(`Quote API: ok (${data.source || "local"})`);
      setStatus(data.warnings?.length ? data.warnings.join(" | ") : "Quote loaded.", data.warnings?.length ? "warn" : "ok");
      await updateCTA();
    } catch (err) {
      if (els.toAmt) els.toAmt.textContent = "-";
      setRoute("Route: -");
      setQuoteDebug(`Quote API: ${String(err?.message || err).slice(0, 140)}`);
      setStatus(normalizeError(err), "err");
      updateCTA();
    } finally {
      quoteInFlight = false;
      if (quotePending) {
        quotePending = false;
        scheduleQuote();
      }
    }
  }

  function normalizeError(err) {
    const msg = String(err?.message || err || "");
    if (/no route/i.test(msg)) return "No route found on Kuru Flow.";
    if (/allowance/i.test(msg)) return "Insufficient allowance. Approve before swapping.";
    if (/slippage/i.test(msg)) return "Slippage exceeded. Increase slippage or retry.";
    if (/network|chain/i.test(msg)) return "Wrong network. Switch to Monad.";
    if (err?.status === 429 || /rate.?limit|rate_limited/i.test(msg)) return "Kuru Flow is rate limiting quotes. Wait a few seconds, then try again.";
    if (/user rejected|denied|rejected/i.test(msg)) return "Transaction rejected in wallet.";
    if (/fetch failed|network/i.test(msg)) return "Kuru API unavailable. Try again shortly.";
    return msg || "Swap quote failed.";
  }

  async function updateCTA() {
    if (!els.swap) return;
    syncFromSharedWallet();
    if (!account) {
      action = "locked";
      els.swap.textContent = "Connect wallet to swap";
      els.swap.disabled = true;
      if (els.approval) els.approval.textContent = "Approval: connect wallet";
      return;
    }
    if (!lastQuote) {
      action = "swap";
      els.swap.textContent = "Swap";
      els.swap.disabled = true;
      if (els.approval) els.approval.textContent = "Approval: waiting for quote";
      return;
    }
    if (isNative(fromToken)) {
      action = "swap";
      els.swap.textContent = "Swap";
      els.swap.disabled = false;
      if (els.approval) els.approval.textContent = "Approval: native MON does not need approval";
      return;
    }
    const spender = lastQuote?.issues?.allowance?.spender || lastQuote?.transaction?.to;
    try {
      const need = parseUnits(els.fromAmt?.value, fromToken.decimals) || 0n;
      const allowance = await readAllowance(fromToken, account, spender);
      if (allowance < need) {
        action = "approve";
        els.swap.textContent = `Approve ${fromToken.symbol}`;
        els.swap.disabled = false;
        if (els.approval) els.approval.textContent = "Approval: required";
        return;
      }
      if (els.approval) els.approval.textContent = "Approval: ready";
    } catch (_err) {
      action = "approve";
      els.swap.textContent = `Approve ${fromToken.symbol}`;
      els.swap.disabled = false;
      if (els.approval) els.approval.textContent = "Approval: required";
      return;
    }
    action = "swap";
    els.swap.textContent = "Swap";
    els.swap.disabled = false;
  }

  async function approve() {
    try {
      if (!lastQuote) return;
      if (!await ensureChain()) return;
      const spender = lastQuote?.issues?.allowance?.spender || lastQuote?.transaction?.to;
      if (!isAddr(spender)) throw new Error("Approval spender unavailable.");
      els.swap.disabled = true;
      setStatus(`Approving ${fromToken.symbol}...`, "warn");
      const data = "0x095ea7b3" + pad32(spender) + hexAmount((1n << 256n) - 1n);
      const hash = await sendTx({ to: fromToken.address, data, value: "0" });
      setStatus("Approval submitted. Waiting for confirmation...", "");
      await waitReceipt(hash);
      setStatus("Approval confirmed. Swap is ready.", "ok");
      await updateCTA();
    } catch (err) {
      setStatus(/rejected|denied/i.test(String(err?.message)) ? "User rejected approval." : "Approval failed.", "err");
    } finally {
      els.swap.disabled = false;
    }
  }

  async function swap() {
    try {
      if (!lastQuote) throw new Error("Quote not ready.");
      if (!await ensureChain()) return;
      els.swap.disabled = true;
      setStatus("Open wallet and confirm swap...", "");
      const hash = await sendTx(lastQuote.transaction);
      setStatus("Swap submitted. Waiting for confirmation...", "");
      await waitReceipt(hash);
      setStatus("Swap confirmed.", "ok");
      if (els.fromAmt) els.fromAmt.value = "";
      if (els.toAmt) els.toAmt.textContent = "-";
      lastQuote = null;
      setRoute("Route: -");
      await refreshBalances();
      updateCTA();
    } catch (err) {
      setStatus(/rejected|denied/i.test(String(err?.message)) ? "User rejected swap." : normalizeError(err), "err");
      updateCTA();
    } finally {
      els.swap.disabled = false;
    }
  }

  function flipTokens() {
    const oldFrom = fromToken;
    fromToken = toToken;
    toToken = oldFrom;
    lastQuote = null;
    if (els.toAmt) els.toAmt.textContent = "-";
    updateTokenUI();
    refreshBalances();
    scheduleQuote();
  }

  function bindEvents() {
    els.connect?.addEventListener("click", connect);
    els.fromTokenBtn?.addEventListener("click", () => openTokenModal("from"));
    els.toTokenBtn?.addEventListener("click", () => openTokenModal("to"));
    els.flip?.addEventListener("click", flipTokens);
    els.max?.addEventListener("click", () => {
      if (fromBalanceRaw == null) return;
      let amount = fromBalanceRaw;
      if (isNative(fromToken)) {
        const buffer = 5n * 10n ** 16n;
        amount = amount > buffer ? amount - buffer : 0n;
      }
      els.fromAmt.value = formatUnits(amount, fromToken.decimals, 8);
      scheduleQuote();
    });
    els.fromAmt?.addEventListener("input", () => {
      if (els.toAmt) els.toAmt.textContent = "-";
      lastQuote = null;
      scheduleQuote();
    });
    els.slippage?.addEventListener("input", scheduleQuote);
    els.swap?.addEventListener("click", () => {
      syncFromSharedWallet();
      if (action === "locked") return;
      if (action === "approve") return approve();
      return swap();
    });
    els.tokenModal?.addEventListener("click", (event) => {
      if (event.target.closest("[data-token-close='1']")) closeTokenModal();
    });
    els.tokenSearch?.addEventListener("input", renderTokenList);
    els.tabPopular?.addEventListener("click", () => {
      tokenTab = "popular";
      els.tabPopular.classList.add("isOn");
      els.tabAll?.classList.remove("isOn");
      renderTokenList();
    });
    els.tabAll?.addEventListener("click", () => {
      tokenTab = "all";
      els.tabAll.classList.add("isOn");
      els.tabPopular?.classList.remove("isOn");
      renderTokenList();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeTokenModal();
    });
  }

  async function init() {
    try {
      const configRes = await fetch("/.netlify/functions/quote", { cache: "no-cache" });
      const config = await configRes.json();
      if (config?.feeBps != null) supportFeeBps = Number(config.feeBps);
      if (config?.treasury) treasury = config.treasury;
    } catch (_err) {}
    updateSupportCopy();
    updateTokenUI();
    bindEvents();
    await loadTokens();
    fromToken = tokens.find((token) => token.symbol === "MON") || baseTokens[0];
    toToken = tokens.find((token) => token.symbol === "USDC") || baseTokens[2];
    updateTokenUI();
    renderQuickTokens();
    renderTokenList();
    syncFromSharedWallet();
    updateCTA();
    window.addEventListener("dyoor:wallet", syncFromSharedWallet);
  }

  init();
})();

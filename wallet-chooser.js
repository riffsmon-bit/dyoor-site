(function () {
  const PROJECT_ID = "515640b93fcb56906722f2d6b44d2e47";
  const PROJECT_ID_CONFIG_URL = "/.netlify/functions/wallet-config";
  const CHAIN_ID_DEC = 143;
  const CHAIN_ID_HEX = "0x8f";
  const RPC_URL = "https://rpc.monad.xyz";
  const EXPLORER_URL = "https://monadscan.com";
  const METAMASK_WALLET_ID = "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96";

  let wcProvider = null;
  let projectIdPromise = null;

  function isMobile() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  function isMobileSafari() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent)
      && /Safari/i.test(navigator.userAgent)
      && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
  }

  function appMetadata() {
    return {
      name: "DYOOR",
      description: "DYOOR Monad NFT community and Ascension Protocol",
      url: window.location.origin,
      icons: [`${window.location.origin}/assets/dyoor-logo.png`],
      redirect: {
        universal: window.location.href
      }
    };
  }

  function getInjectedProvider(type) {
    const eth = window.ethereum;
    if (!eth) return null;

    const providers = Array.isArray(eth.providers) ? eth.providers : [eth];
    const pick = (predicate) => providers.find((provider) => {
      try {
        return predicate(provider);
      } catch (_err) {
        return false;
      }
    });

    switch ((type || "").toLowerCase()) {
      case "backpack":
        return pick((provider) => provider.isBackpack);
      case "okx":
        return (window.okxwallet && (window.okxwallet.ethereum || window.okxwallet))
          || pick((provider) => provider.isOkxWallet || provider.isOKExWallet);
      case "phantom":
        return (window.phantom && window.phantom.ethereum)
          || pick((provider) => provider.isPhantom);
      case "metamask":
        return pick((provider) => provider.isMetaMask);
      case "tokenpocket":
        return pick((provider) => provider.isTokenPocket || provider.isTPWallet);
      case "rabby":
        return pick((provider) => provider.isRabby);
      case "injected":
      default:
        return eth;
    }
  }

  function walletLabel(type) {
    switch ((type || "").toLowerCase()) {
      case "backpack": return "Backpack";
      case "okx": return "OKX Wallet";
      case "phantom": return "Phantom";
      case "metamask": return "MetaMask";
      case "tokenpocket": return "TokenPocket";
      case "rabby": return "Rabby";
      case "walletconnect": return "WalletConnect";
      default: return "Injected Wallet";
    }
  }

  async function ensureChain(browserProvider, eip1193) {
    try {
      const network = await browserProvider.getNetwork();
      if (Number(network.chainId) === CHAIN_ID_DEC) return true;
    } catch (_err) {}

    if (!eip1193?.request) return false;

    try {
      await eip1193.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }]
      });
      return true;
    } catch (_switchErr) {
      try {
        await eip1193.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CHAIN_ID_HEX,
            chainName: "Monad",
            rpcUrls: [RPC_URL],
            nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
            blockExplorerUrls: [EXPLORER_URL]
          }]
        });
        await eip1193.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CHAIN_ID_HEX }]
        });
        return true;
      } catch (_addErr) {
        return false;
      }
    }
  }

  async function initWalletConnect(options = {}) {
    if (wcProvider) return wcProvider;
    if (!window.WalletConnectEthereumProvider) {
      throw new Error("WalletConnect library not loaded.");
    }

    const manualMobileLink = !!options.manualMobileLink;
    const projectId = await getWalletConnectProjectId();
    wcProvider = await window.WalletConnectEthereumProvider.init({
      projectId,
      metadata: appMetadata(),
      chains: [CHAIN_ID_DEC],
      optionalChains: [CHAIN_ID_DEC],
      rpcMap: {
        [CHAIN_ID_DEC]: RPC_URL
      },
      showQrModal: !manualMobileLink,
      qrModalOptions: {
        themeMode: "dark",
        explorerRecommendedWalletIds: "NONE",
        explorerExcludedWalletIds: [METAMASK_WALLET_ID],
        enableExplorer: false
      },
      methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4"],
      events: ["chainChanged", "accountsChanged", "disconnect"]
    });

    return wcProvider;
  }

  function onceProviderEvent(provider, eventName, timeoutMs = 12000) {
    return new Promise((resolve) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        try {
          provider?.off?.(eventName, handler);
          provider?.removeListener?.(eventName, handler);
        } catch (_err) {}
      };
      const handler = (value) => {
        cleanup();
        resolve(value);
      };

      provider?.on?.(eventName, handler);
      timer = setTimeout(() => {
        cleanup();
        resolve("");
      }, timeoutMs);
    });
  }

  function setWalletNote(content) {
    const note = document.querySelector("#walletModal .wallet-modal__note");
    if (!note) return null;
    note.innerHTML = "";
    if (typeof content === "string") {
      note.textContent = content;
      return note;
    }
    note.appendChild(content);
    return note;
  }

  function showMobileWalletConnectPrompt(uri) {
    const wrap = document.createElement("div");
    wrap.className = "wallet-mobile-wc";

    const title = document.createElement("strong");
    title.textContent = "Keep this Safari tab open.";

    const copy = document.createElement("p");
    copy.textContent = "Open MetaMask only to approve the WalletConnect request, then return to Safari.";

    const actions = document.createElement("div");
    actions.className = "wallet-mobile-wc__actions";

    const open = document.createElement("a");
    open.className = "wallet-deeplink";
    open.href = `metamask://wc?uri=${encodeURIComponent(uri)}`;
    open.textContent = "Open MetaMask Approval";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "wallet-deeplink";
    copyBtn.textContent = "Copy WalletConnect URI";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(uri);
        copyBtn.textContent = "Copied";
      } catch (_err) {
        copyBtn.textContent = "Copy failed";
      }
    });

    actions.appendChild(open);
    actions.appendChild(copyBtn);
    wrap.appendChild(title);
    wrap.appendChild(copy);
    wrap.appendChild(actions);
    setWalletNote(wrap);
  }

  async function enableWalletConnectMobileSafari() {
    const wc = await initWalletConnect({ manualMobileLink: true });
    const uriPromise = onceProviderEvent(wc, "display_uri");
    const enablePromise = wc.enable();
    const uri = await uriPromise;

    if (uri) {
      showMobileWalletConnectPrompt(uri);
    } else {
      setWalletNote("Waiting for WalletConnect approval. Return to Safari after approving in your wallet.");
    }

    await enablePromise;
    return wc;
  }

  async function getWalletConnectProjectId() {
    if (projectIdPromise) return projectIdPromise;

    projectIdPromise = (async () => {
      const globalProjectId = String(
        window.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
        window.WALLETCONNECT_PROJECT_ID ||
        ""
      ).trim();
      if (globalProjectId) return globalProjectId;

      try {
        const res = await fetch(PROJECT_ID_CONFIG_URL, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        const envProjectId = String(json?.projectId || "").trim();
        if (res.ok && envProjectId) return envProjectId;
      } catch (err) {
        console.warn("WalletConnect config endpoint unavailable; using fallback project id.", err);
      }

      return PROJECT_ID;
    })();

    return projectIdPromise;
  }

  function ensureModal(opts) {
    let root = document.getElementById("walletModal");
    if (root) {
      const title = root.querySelector(".wallet-modal__title");
      const note = root.querySelector(".wallet-modal__note");
      if (title && opts?.title) title.textContent = opts.title;
      if (note && opts?.copy) note.innerHTML = opts.copy;
      return root;
    }

    root = document.createElement("div");
    root.id = "walletModal";
    root.className = "wallet-modal";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <div class="wallet-modal__backdrop" data-close="1"></div>
      <div class="wallet-modal__panel" role="dialog" aria-modal="true" aria-label="Connect wallet">
        <div class="wallet-modal__header">
          <div class="wallet-modal__title">${opts?.title || "Connect Wallet"}</div>
          <button type="button" class="wallet-modal__close" data-close="1" aria-label="Close">✕</button>
        </div>
        <div class="wallet-modal__grid">
          <button type="button" class="wallet-option" data-wallet="backpack">Backpack</button>
          <button type="button" class="wallet-option" data-wallet="metamask">MetaMask</button>
          <button type="button" class="wallet-option" data-wallet="phantom">Phantom (EVM)</button>
          <button type="button" class="wallet-option" data-wallet="okx">OKX Wallet</button>
          <button type="button" class="wallet-option" data-wallet="tokenpocket">TokenPocket</button>
          <button type="button" class="wallet-option" data-wallet="injected">Other Injected</button>
          <button type="button" class="wallet-option wallet-option--wc" data-wallet="walletconnect">WalletConnect (QR)</button>
        </div>
        <div id="walletModalHint" class="wallet-modal__hint" style="display:none;">
          On mobile Safari, use <strong>WalletConnect</strong> to keep this site in Safari. Your wallet app opens only for approval.
        </div>
        <div id="walletDeepLinks" class="wallet-modal__deeplinks" style="display:none;">
          <a href="#" id="openInMetaMask" class="wallet-deeplink">Open in MetaMask</a>
          <a href="#" id="openInOKX" class="wallet-deeplink">Open in OKX</a>
          <a href="#" id="openInPhantom" class="wallet-deeplink">Open in Phantom</a>
        </div>
        <div class="wallet-modal__note">${opts?.copy || "Connect on Monad using an injected wallet or WalletConnect."}</div>
      </div>
    `;

    document.body.appendChild(root);
    return root;
  }

  function applyDeepLinks(root) {
    const dappUrl = encodeURIComponent(window.location.href);
    const metamask = root.querySelector("#openInMetaMask");
    const okx = root.querySelector("#openInOKX");
    const phantom = root.querySelector("#openInPhantom");

    if (metamask) metamask.href = `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}${window.location.search}`;
    if (okx) okx.href = `okx://wallet/dapp/url?dappUrl=${dappUrl}`;
    if (phantom) phantom.href = `https://phantom.app/ul/browse/${encodeURIComponent(window.location.href)}?ref=${encodeURIComponent(window.location.origin)}`;
  }

  function openModal(root) {
    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    const hint = root.querySelector("#walletModalHint");
    const links = root.querySelector("#walletDeepLinks");
    const hasInjected = !!window.ethereum
      || !!(window.okxwallet && (window.okxwallet.ethereum || window.okxwallet))
      || !!(window.phantom && window.phantom.ethereum);
    const mobileNoInjected = isMobile() && !hasInjected;

    if (hint) hint.style.display = mobileNoInjected ? "block" : "none";
    if (links) links.style.display = "none";

    root.querySelectorAll(".wallet-option[data-wallet]").forEach((btn) => {
      const type = (btn.getAttribute("data-wallet") || "").toLowerCase();
      const needsInjected = type !== "walletconnect";
      if (mobileNoInjected && needsInjected) {
        btn.setAttribute("disabled", "disabled");
        btn.classList.add("is-disabled");
      } else {
        btn.removeAttribute("disabled");
        btn.classList.remove("is-disabled");
      }
    });
  }

  function closeModal(root) {
    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  async function connectType(type) {
    let eip1193;
    if (type === "walletconnect") {
      const wc = isMobileSafari()
        ? await enableWalletConnectMobileSafari()
        : await initWalletConnect();
      if (!isMobileSafari()) await wc.enable();
      eip1193 = wc;
    } else {
      eip1193 = getInjectedProvider(type);
      if (!eip1193?.request) {
        throw new Error(`${walletLabel(type)} not detected in this browser.`);
      }
    }

    if (!window.ethers?.BrowserProvider) {
      throw new Error("Ethers failed to load.");
    }

    let accounts = await eip1193.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) {
      throw new Error("Wallet did not return an account.");
    }

    const browserProvider = new window.ethers.BrowserProvider(eip1193, "any");
    const okChain = await ensureChain(browserProvider, eip1193);
    if (!okChain) {
      throw new Error("Please switch to Monad in your wallet.");
    }

    const signer = await browserProvider.getSigner();
    const account = accounts[0];

    return {
      type,
      label: walletLabel(type),
      provider: eip1193,
      browserProvider,
      signer,
      account
    };
  }

  async function connect(opts = {}) {
    const root = ensureModal(opts);
    applyDeepLinks(root);
    openModal(root);

    return new Promise((resolve, reject) => {
      let done = false;

      const cleanup = () => {
        root.querySelectorAll("[data-close='1']").forEach((node) => node.removeEventListener("click", handleClose));
        root.querySelectorAll(".wallet-option[data-wallet]").forEach((node) => node.removeEventListener("click", handlePick));
        document.removeEventListener("keydown", handleKey);
      };

      const finish = (fn, value) => {
        if (done) return;
        done = true;
        cleanup();
        closeModal(root);
        fn(value);
      };

      const handleClose = () => finish(reject, new Error("Wallet connection canceled."));
      const handleKey = (event) => {
        if (event.key === "Escape") handleClose();
      };

      const handlePick = async (event) => {
        const button = event.currentTarget;
        const type = (button.getAttribute("data-wallet") || "").toLowerCase();
        try {
          button.setAttribute("disabled", "disabled");
          const result = await connectType(type);
          finish(resolve, result);
        } catch (err) {
          button.removeAttribute("disabled");
          const note = root.querySelector(".wallet-modal__note");
          if (note) note.innerHTML = err?.message || "Wallet connection failed.";
        }
      };

      root.querySelectorAll("[data-close='1']").forEach((node) => node.addEventListener("click", handleClose));
      root.querySelectorAll(".wallet-option[data-wallet]").forEach((node) => node.addEventListener("click", handlePick));
      document.addEventListener("keydown", handleKey);
    });
  }

  window.DyoorWalletChooser = {
    connect,
    connectType
  };
})();

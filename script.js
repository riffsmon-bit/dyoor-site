// ---------- Shared wallet helpers ----------
// WalletConnect v2 project id (public) – required for WalletConnect QR/deeplinks.
const WALLETCONNECT_PROJECT_ID = "515640b93fcb56906722f2d6b44d2e47";

// Active EIP-1193 provider (injected or WalletConnect)
let __activeEvmProvider = null;

function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function getInjectedProvider(type) {
  const eth = window.ethereum;
  if (!eth) return null;

  const providers = Array.isArray(eth.providers) ? eth.providers : [eth];
  const pick = (predicate) => providers.find(p => { try { return predicate(p); } catch (e) { return false; } });

  if (type === "metamask") return pick(p => p.isMetaMask);
  if (type === "okx") return (window.okxwallet && window.okxwallet.ethereum) ? window.okxwallet.ethereum : pick(p => p.isOkxWallet || p.isOKExWallet);
  if (type === "phantom") return (window.phantom && window.phantom.ethereum) ? window.phantom.ethereum : pick(p => p.isPhantom);
  if (type === "injected") return eth;

  return eth;
}

function detectOKXInjected(){
  try {
    return !!(window.okxwallet && (window.okxwallet.ethereum || window.okxwallet)) || !!(window.ethereum && (window.ethereum.isOkxWallet || window.ethereum.isOKExWallet));
  } catch (e) {
    return false;
  }
}

async function autoConnectOKX(){
  // Show connected state if OKX already granted the dapp access (no prompt).
  if(!detectOKXInjected()) return false;

  const prov = getInjectedProvider('okx') || (window.okxwallet && (window.okxwallet.ethereum || window.okxwallet)) || window.ethereum;
  if(!prov || !prov.request || !window.ethers || !window.ethers.BrowserProvider) return false;

  try {
    const accts = await prov.request({ method: 'eth_accounts' });
    if(accts && accts[0]){
      __activeEvmProvider = prov;
      provider = new window.ethers.BrowserProvider(prov, 'any');
      signer = await provider.getSigner();
      userAddress = accts[0];
      syncWalletGlobals();
      updateWalletUI();
      return true;
    }
  } catch(e){
    // ignore
  }
  return false;
}



let _wcProvider = null;
async function initWalletConnect() {
  if (_wcProvider) return _wcProvider;
  if (!window.WalletConnectEthereumProvider) {
    throw new Error('WalletConnect library not loaded');
  }
  _wcProvider = await window.WalletConnectEthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    // Monad (custom chain) needs an explicit RPC mapping for WalletConnect.
    chains: [CHAIN_ID_DEC],
    optionalChains: [CHAIN_ID_DEC],
    rpcMap: {
      [CHAIN_ID_DEC]: 'https://rpc.monad.xyz'
    },
    showQrModal: true,
    methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4'],
    events: ['chainChanged', 'accountsChanged', 'disconnect']
  });
  // enable() triggers the modal / deep link flow
  await _wcProvider.enable();
  return _wcProvider;
}

function openWalletModal() {
  const m = document.getElementById("walletModal");
  if (!m) return;
  m.classList.add("is-open");
  m.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  // Mobile Safari often has no injected providers; guide users.
  const hint = document.getElementById("walletModalHint");
  const links = document.getElementById("walletDeepLinks");
  const hasInjected = !!window.ethereum || (!!window.okxwallet && !!window.okxwallet.ethereum) || (!!window.phantom && !!window.phantom.ethereum);
  const mobileNoInjected = isMobile() && !hasInjected;
  if (hint) hint.style.display = mobileNoInjected ? "block" : "none";
  if (links) links.style.display = "none";
  // If no injected wallet, disable injected-only options to avoid "nothing happens".
  document.querySelectorAll(".wallet-option[data-wallet=\"metamask\"], .wallet-option[data-wallet=\"okx\"], .wallet-option[data-wallet=\"phantom\"], .wallet-option[data-wallet=\"injected\"]")
    .forEach(btn => { if (mobileNoInjected) { btn.setAttribute("disabled","disabled"); btn.classList.add("is-disabled"); } else { btn.removeAttribute("disabled"); btn.classList.remove("is-disabled"); } });
  const wcBtn = document.querySelector(".wallet-option--wc");
  if (wcBtn) {
    // WalletConnect requires its provider lib; keep enabled, but explain if missing.
    wcBtn.classList.toggle("is-disabled", false);
    wcBtn.removeAttribute("disabled");
  }
}

function closeWalletModal() {
  const m = document.getElementById("walletModal");
  if (!m) return;
  m.classList.remove("is-open");
  m.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

async function connectWithWallet(type) {
  try {
    // Close behavior should always work
    const t = (type || '').toLowerCase();

    if (window.DyoorWalletChooser?.connectType) {
      const connected = await window.DyoorWalletChooser.connectType(t);
      applyConnectedWallet(connected);
      return;
    }

    if (t === 'walletconnect') {
      const wc = await initWalletConnect();
      await connectWallet(wc);
      return;
    }

    // Injected wallets
    let injected = null;
    if (t === 'okx') {
      injected =
        (window.okxwallet && (window.okxwallet.ethereum || window.okxwallet)) ||
        (window.ethereum && (window.ethereum.isOkxWallet || window.ethereum.isOKExWallet) ? window.ethereum : null) ||
        window.ethereum;

      if (!injected || !injected.request) {
        // Try to open in OKX Wallet dApp browser via deep link
        try {
          const dappUrl = encodeURIComponent(window.location.href);
          window.location.href = "okx://wallet/dapp/url?dappUrl=" + dappUrl;
        } catch {}
        alert('OKX wallet provider not detected in this view. Open this site in OKX Wallet > Explore (browser) or use WalletConnect.');
        return;
      }

      try {
        await connectWallet(injected);
      } catch (e) {
        // If OKX blocks connection in a restricted webview, deep link to proper browser view
        try {
          const dappUrl = encodeURIComponent(window.location.href);
          window.location.href = "okx://wallet/dapp/url?dappUrl=" + dappUrl;
        } catch {}
        throw e;
      }
      return;
    }

    if (t === 'phantom') {
      injected = (window.phantom && window.phantom.ethereum) ? window.phantom.ethereum : window.ethereum;
      if (!injected) {
        alert('Phantom not detected. Open this page inside Phantom browser or use WalletConnect.');
        return;
      }
      await connectWallet(injected);
      return;
    }

    // MetaMask / Other injected
    if (t === 'metamask') injected = getInjectedProvider('metamask');
    else if (t === 'injected') injected = getInjectedProvider('injected');
    else injected = window.ethereum;
    if (!injected) {
      alert('No injected wallet detected. Use WalletConnect to stay in Safari.');
      return;
    }
    await connectWallet(injected);
  } catch (err) {
    console.error('connectWithWallet error:', err);
    alert('Could not start wallet connection. Try WalletConnect.');
  }
}

/* DYOOR site shared wallet state */
const CHAIN_ID_DEC = 143; // Monad
const CHAIN_ID_HEX = '0x' + CHAIN_ID_DEC.toString(16);

// Provider state
let provider = null;   // ethers BrowserProvider
let signer = null;     // ethers Signer
let userAddress = null;

// Expose wallet state for other standalone pages.
function syncWalletGlobals(){
  try {
    window.__activeEvmProvider = __activeEvmProvider;
    window.provider = provider;
    window.signer = signer;
    window.userAddress = userAddress;
    window.dispatchEvent(new CustomEvent('dyoor:wallet', {
      detail: { eip1193: __activeEvmProvider, provider, signer, userAddress }
    }));
  } catch (e) {}
}

function bindConnectedWalletEvents(eth) {
  if (!eth || typeof eth.on !== 'function' || eth.__dyoorMainWalletBound) return;
  eth.__dyoorMainWalletBound = true;

  eth.on('accountsChanged', (accts) => {
    userAddress = (accts && accts[0]) ? accts[0] : null;
    syncWalletGlobals();
    updateWalletUI();
  });
  eth.on('chainChanged', () => updateWalletUI());
  eth.on('disconnect', () => {
    provider = null;
    signer = null;
    userAddress = null;
    __activeEvmProvider = null;
    syncWalletGlobals();
    updateWalletUI();
  });
}

function applyConnectedWallet(connected) {
  if (!connected?.provider || !connected?.browserProvider || !connected?.signer || !connected?.account) {
    throw new Error('Wallet did not return a usable connection.');
  }

  __activeEvmProvider = connected.provider;
  provider = connected.browserProvider;
  signer = connected.signer;
  userAddress = connected.account;

  syncWalletGlobals();
  updateWalletUI();
  closeWalletModal();
  bindConnectedWalletEvents(connected.provider);
}
// ---------- Helpers ----------
function qs(sel){ return document.querySelector(sel); }
function shortAddr(a){ return a ? a.slice(0,6)+'…'+a.slice(-4) : ''; }

function hasEthereum(eth){
  const provider = eth || (typeof window !== 'undefined' ? window.ethereum : null);
  return typeof provider !== 'undefined' && provider !== null;
}

async function ensureChain(web3Provider, eip1193) {
  // Ensures the wallet is on Monad (chainId 143). If not, attempts to switch.
  try {
    const network = await web3Provider.getNetwork();
    const current = Number(network.chainId);
    if (current === CHAIN_ID_DEC) return true;

    const eth = eip1193;
    if (!eth || typeof eth.request !== 'function') return false;

    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
      return true;
    } catch (switchErr) {
      // If the chain hasn't been added to the wallet, try adding it.
      console.warn('Chain switch failed:', switchErr);
      try {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: CHAIN_ID_HEX,
            chainName: 'Monad',
            rpcUrls: ['https://rpc.monad.xyz'],
            nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
            blockExplorerUrls: ['https://monadscan.com']
          }]
        });
        // Now retry switch (some wallets require it even after add)
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
        return true;
      } catch (addErr) {
        console.warn('Chain add failed:', addErr);
        return false;
      }
    }
  } catch (err) {
    console.warn('ensureChain error:', err);
    return false;
  }
}

async function connectWallet(providerOverride, options = {}) {
  const silent = !!options.silent;
  try {
    if (!window.ethers || !window.ethers.BrowserProvider) {
      if(!silent) alert('Wallet libs failed to load. Hard refresh and try again.'); else console.warn('Wallet libs failed to load. Hard refresh and try again.');
      return;
    }

    const eth = providerOverride || (typeof window !== 'undefined' ? window.ethereum : null);
    if (!hasEthereum(eth)) {
      if(!silent) alert('No wallet detected. Use WalletConnect to stay in Safari.'); else console.warn('No wallet detected. Use WalletConnect to stay in Safari.');
      return;
    }

    // Request accounts (this triggers wallet prompt)
    let accounts = [];
    try {
      accounts = await eth.request({ method: 'eth_requestAccounts' });
    } catch (e) {
      // Some wallets require requesting permissions first
      try {
        await eth.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
        accounts = await eth.request({ method: 'eth_requestAccounts' });
      } catch {
        throw e;
      }
    }

    if (!accounts || accounts.length === 0) {
      if(!silent) alert('Wallet did not return any accounts. Try WalletConnect to stay in Safari.'); else console.warn('Wallet did not return any accounts. Try WalletConnect to stay in Safari.');
      return;
    }

    const web3Provider = new window.ethers.BrowserProvider(eth, 'any');
    const ok = await ensureChain(web3Provider, eth);
    if (!ok) {
      if(!silent) alert('Please switch to Monad (chainId 143) and retry.'); else console.warn('Please switch to Monad (chainId 143) and retry.');
      return;
    }

    __activeEvmProvider = eth;
    provider = web3Provider;
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    // Make wallet state accessible globally (stake page, etc.)
    syncWalletGlobals();

    // Update UI
    updateWalletUI();
    closeWalletModal();

    bindConnectedWalletEvents(eth);
  } catch (err) {
    console.error('Wallet connect error:', err);
    if(!silent) alert('Could not connect wallet. On iOS Safari, use WalletConnect to stay in Safari.'); else console.warn('Could not connect wallet. On iOS Safari, use WalletConnect to stay in Safari.');
  }
}

function updateWalletUI(){
  const addr = userAddress;
  const connectHome = qs('#homeWalletBtn');
  const connectSwapContext = qs('#swapContextWalletBtn');
  const connectVerifyContext = qs('#verifyContextWalletBtn');
  // Some pages have additional connect buttons; keep this function safe.
  const connectCasino = qs('#btnConnectCasino');
  const chainPill = qs('#chainPill');
  const verifyWalletValue = qs('#verifyWalletValue');
  const verifyWalletSub = qs('#verifyWalletSub');

  if (connectCasino) connectCasino.textContent = addr ? `Connected: ${shortAddr(addr)}` : 'Connect Wallet';
  if (connectHome) connectHome.textContent = addr ? shortAddr(addr) : 'Connect Wallet';
  if (connectSwapContext) connectSwapContext.textContent = addr ? `Connected: ${shortAddr(addr)}` : 'Connect Wallet to Swap';
  if (connectVerifyContext) connectVerifyContext.textContent = addr ? `Connected: ${shortAddr(addr)}` : 'Connect Wallet to Verify';
  if (chainPill) chainPill.textContent = addr ? `Monad • ${shortAddr(addr)}` : 'Monad';
  if (verifyWalletValue) verifyWalletValue.textContent = addr ? shortAddr(addr) : 'Not connected';
  if (verifyWalletSub) verifyWalletSub.textContent = addr
    ? 'Wallet connected on Monad. You can verify or refresh your Discord roles now.'
    : 'Connect the wallet that holds or has ascended your DYOORs.';

  // Keep globals synced for standalone pages that rely on window.* state.
  syncWalletGlobals();
}

// ---------- Scroll reveal ----------
(function initReveal(){
  const els = Array.from(document.querySelectorAll('.reveal'));
  if(!('IntersectionObserver' in window)){
    els.forEach(e=>e.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries)=>{
    for(const ent of entries){
      if(ent.isIntersecting) ent.target.classList.add('is-in');
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
  els.forEach(e=>io.observe(e));
})();

document.addEventListener('DOMContentLoaded', () => {
  const bindClick = (selector, handler) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.addEventListener('click', handler);
    });
  };

  const safeOpenWalletModal = (e) => {
    if (e) e.preventDefault();
    openWalletModal();
  };

  const safeCloseWalletModal = (e) => {
    if (e) e.preventDefault();
    closeWalletModal();
  };

  bindClick('[data-open-wallet]', safeOpenWalletModal);

  bindClick('#walletModal [data-close]', safeCloseWalletModal);
  bindClick('#walletModalBackdrop', safeCloseWalletModal);
  bindClick('.wallet-modal__backdrop', safeCloseWalletModal);
  bindClick('.wallet-modal__close', safeCloseWalletModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWalletModal();
  });

  document.querySelectorAll('#walletModal .wallet-option[data-wallet]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const walletType = (btn.getAttribute('data-wallet') || '').toLowerCase();
      await connectWithWallet(walletType);
    });
  });

  const openInMetaMask = document.getElementById('openInMetaMask');
  const openInOKX = document.getElementById('openInOKX');
  const openInPhantom = document.getElementById('openInPhantom');

  if (openInMetaMask) {
    openInMetaMask.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}${window.location.search}`;
    });
  }

  if (openInOKX) {
    openInOKX.addEventListener('click', (e) => {
      e.preventDefault();
      const dappUrl = encodeURIComponent(window.location.href);
      window.location.href = `okx://wallet/dapp/url?dappUrl=${dappUrl}`;
    });
  }

  if (openInPhantom) {
    openInPhantom.addEventListener('click', (e) => {
      e.preventDefault();
      const dappUrl = encodeURIComponent(window.location.href);
      window.location.href = `https://phantom.app/ul/browse/${dappUrl}?ref=${encodeURIComponent(window.location.origin)}`;
    });
  }

  const trySilent = async () => {
    try {
      await autoConnectOKX();
    } catch (e) {}
    updateWalletUI();
  };

  if (!window.DYOOR_DISABLE_AUTO_CONNECT) {
    trySilent();

    let tries = 0;
    const iv = setInterval(async () => {
      tries++;
      await trySilent();
      if ((typeof userAddress !== 'undefined' && userAddress) || tries >= 8) {
        clearInterval(iv);
      }
    }, 300);
  }

  updateWalletUI();

  setTimeout(updateWalletUI, 250);
  setTimeout(updateWalletUI, 1250);
});

/* DYOOR COPY-TO-CLIPBOARD */
(function(){
  function setStatus(el, msg){
    if(!el) return;
    el.textContent = msg;
    if(msg) setTimeout(function(){ el.textContent = ""; }, 2000);
  }

  async function copyText(text){
    try{
      if(navigator.clipboard && window.isSecureContext){
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch(e){}
    try{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly','');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }catch(e){
      return false;
    }
  }

  document.addEventListener('click', async function(e){
    const btn = e.target.closest('[data-copy-target]');
    if(!btn) return;
    const sel = btn.getAttribute('data-copy-target');
    const target = sel ? document.querySelector(sel) : null;
    const status = document.getElementById('copyStatus');
    if(!target) return setStatus(status, 'Not found');
    const text = (target.textContent || '').trim();
    const ok = await copyText(text);
    setStatus(status, ok ? 'Copied!' : 'Copy failed');
  });
})();

// ---------- Collection Preview (continuous scroll) ----------
// Monad-native preview (NO OpenSea, NO API key).
// We pull token metadata from your on-chain baseURI + IPFS, then build a seamless marquee.
//
// Your contract baseURI (from MonadScan):
// ipfs://QmcXRP7VV5Ne3NExitFH5SzvVtHdQwScY6Dz8W1H7RYYQD
const DYOOR_BASE_URI = "ipfs://QmcXRP7VV5Ne3NExitFH5SzvVtHdQwScY6Dz8W1H7RYYQD"; // no trailing slash on-chain
const DYOOR_TOTAL_SUPPLY = 1111;

// Choose a gateway (you can swap if you prefer).
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

// Convert ipfs://CID/path -> https://gateway/ipfs/CID/path
function ipfsToHttp(uri) {
  if (!uri) return null;
  const s = String(uri);
  if (s.startsWith("ipfs://")) {
    const rest = s.slice("ipfs://".length); // CID[/path]
    return IPFS_GATEWAY + rest.replace(/^\/+/, "");
  }
  return s;
}

function randInt(min, maxInclusive) {
  return Math.floor(Math.random() * (maxInclusive - min + 1)) + min;
}

function uniqueSampleIds(count, minId, maxId) {
  const set = new Set();
  const cap = Math.min(count, (maxId - minId + 1));
  while (set.size < cap) set.add(randInt(minId, maxId));
  return Array.from(set);
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "accept": "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

async function fetchTokenMetadata(tokenId) {
  // Your contract logic returns baseURI as-is if it doesn't end with "/".
  // Many projects still store per-token JSON at baseURI/<id> or baseURI/<id>.json.
  // So we try a few common patterns.
  const baseNoSlash = DYOOR_BASE_URI.replace(/\/+$/, "");
  const baseSlash = baseNoSlash + "/";

  const candidates = [
    ipfsToHttp(baseSlash + String(tokenId)),
    ipfsToHttp(baseSlash + String(tokenId) + ".json"),
    ipfsToHttp(baseNoSlash), // single metadata (unrevealed-style)
  ].filter(Boolean);

  let lastErr = null;
  for (const u of candidates) {
    try {
      return await fetchJson(u);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("metadata fetch failed");
}

function pickImageFromMetadata(meta) {
  // Common metadata keys: image, image_url
  return meta?.image || meta?.image_url || meta?.imageUrl || null;
}

async function initCollectionMarquee() {
  const track = document.getElementById("collectionMarquee");
  if (!track) return;

  try {
    // Sample across the supply so it feels like a real preview.
    // Keep this modest so mobile doesn't get hammered.
    const ids = uniqueSampleIds(28, 1, DYOOR_TOTAL_SUPPLY);

    const metas = await Promise.allSettled(ids.map(id => fetchTokenMetadata(id)));
    const imageUrls = metas
      .map(r => (r.status === "fulfilled" ? pickImageFromMetadata(r.value) : null))
      .filter(Boolean)
      .map(ipfsToHttp)
      .filter(Boolean);

    if (!imageUrls.length) {
      track.innerHTML = '<div class="muted" style="padding:10px 0;">Preview unavailable (no images returned).</div>';
      return;
    }

    const makeItem = (src) => {
      const div = document.createElement("div");
      div.className = "marquee__item";
      div.setAttribute("role", "listitem");
      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = "DYOOR preview";
      img.src = src;
      div.appendChild(img);
      return div;
    };

    // Build two identical sets for seamless loop.
    track.innerHTML = "";
    const frag = document.createDocumentFragment();
    imageUrls.forEach(u => frag.appendChild(makeItem(u)));
    imageUrls.forEach(u => frag.appendChild(makeItem(u)));
    track.appendChild(frag);
  } catch (err) {
    console.warn("Collection preview init failed", err);
    track.innerHTML = '<div class="muted" style="padding:10px 0;">Preview unavailable (metadata fetch failed).</div>';
  }
}

document.addEventListener("DOMContentLoaded", () => {
  try { initCollectionMarquee(); } catch (e) {}
  try { initHomepageVerifier(); } catch (e) { console.warn('Verifier init failed', e); }
});


// ---------- DISCORD VERIFIER ----------
const VERIFY_API = {
  status: '/.netlify/functions/discord-status',
  loginStart: '/.netlify/functions/discord-login-start',
  nonce: '/.netlify/functions/discord-verify-nonce',
  submit: '/.netlify/functions/discord-verify-submit',
  refresh: '/.netlify/functions/discord-refresh'
};

const __verifyState = {
  discordUser: null,
  wallet: null,
  snapshot: null,
  loading: false
};

function verifySetStatus(message, tone = 'idle'){
  const box = document.getElementById('verifyStatusBox');
  if(!box) return;
  box.textContent = message;
  box.classList.remove('is-good','is-bad','is-warn','is-busy');
  if(tone === 'good') box.classList.add('is-good');
  else if(tone === 'bad') box.classList.add('is-bad');
  else if(tone === 'warn') box.classList.add('is-warn');
  else if(tone === 'busy') box.classList.add('is-busy');
}

function verifyRoleList(snapshot){
  if(!snapshot) return 'Not synced';
  const roles = [];
  if(snapshot.isHolder) roles.push('Holder');
  if(snapshot.isAscended) roles.push('Ascended');
  if(snapshot.isTwentyPlus) roles.push('20+');
  if(snapshot.isFiftyPlus) roles.push('50+');
  return roles.length ? roles.join(' • ') : 'No active roles';
}

function verifyApplySnapshot(snapshot){
  __verifyState.snapshot = snapshot || null;
  const walletCount = document.getElementById('verifyWalletCount');
  const stakedCount = document.getElementById('verifyStakedCount');
  const totalCount = document.getElementById('verifyTotalCount');
  const rolesText = document.getElementById('verifyRolesText');

  if (walletCount) walletCount.textContent = snapshot?.walletBalance ?? '—';
  if (stakedCount) stakedCount.textContent = snapshot?.stakedBalance ?? '—';
  if (totalCount) totalCount.textContent = snapshot?.totalBalance ?? '—';
  if (rolesText) rolesText.textContent = verifyRoleList(snapshot);
}

function verifyApplyDiscordUser(user){
  __verifyState.discordUser = user || null;
  const userEl = document.getElementById('discordVerifyUser');
  const subEl = document.getElementById('discordVerifySub');
  const btn = document.getElementById('btnConnectDiscord');

  if(user){
    if(userEl) userEl.textContent = user.username ? `${user.username}${user.discriminator ? '#' + user.discriminator : ''}` : (user.global_name || 'Connected');
    if(subEl) subEl.textContent = 'Discord linked. This is the account that will receive your DYOOR roles.';
    if(btn) btn.textContent = 'Discord Connected';
  } else {
    if(userEl) userEl.textContent = 'Not connected';
    if(subEl) subEl.textContent = 'Login with Discord to link the exact account that should receive roles.';
    if(btn) btn.textContent = 'Connect Discord';
  }
}

async function verifyFetchJSON(url, options){
  const res = await fetch(url, options);
  let data = {};
  try { data = await res.json(); } catch(e) {}
  if(!res.ok){
    throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  }
  return data;
}

async function loadVerifyStatus(){
  try{
    const data = await verifyFetchJSON(VERIFY_API.status, { credentials: 'include' });
    verifyApplyDiscordUser(data?.discordUser || null);
    verifyApplySnapshot(data?.snapshot || null);

    if(data?.wallet){
      __verifyState.wallet = data.wallet;
      if(!userAddress && window.ethereum){
        // leave actual wallet connection state alone; status endpoint may know a linked wallet
      }
      const walletValue = document.getElementById('verifyWalletValue');
      const walletSub = document.getElementById('verifyWalletSub');
      if(walletValue) walletValue.textContent = shortAddr(data.wallet);
      if(walletSub) walletSub.textContent = 'Wallet linked. Use Refresh Roles anytime, or just let hourly sync handle it.';
    }

    if(data?.snapshot){
      verifySetStatus('Roles synced. Hourly auto-update is active.', 'good');
    }
  } catch(err){
    console.warn('verify status load failed', err);
    verifySetStatus('Verifier backend not reachable yet. Add the Netlify verifier functions, then reload.', 'warn');
  }
}

async function startDiscordLogin(){
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${VERIFY_API.loginStart}?returnTo=${returnTo}`;
}

async function verifyRolesFlow(mode = 'verify'){
  if(__verifyState.loading) return;
  if(!__verifyState.discordUser){
    verifySetStatus('Connect Discord first so the site knows which account should receive roles.', 'warn');
    return;
  }
  if(!userAddress || !signer){
    verifySetStatus('Connect your wallet first.', 'warn');
    openWalletModal();
    return;
  }

  __verifyState.loading = true;
  verifySetStatus(mode === 'refresh' ? 'Refreshing your roles…' : 'Preparing secure verification message…', 'busy');

  try {
    const wallet = await signer.getAddress();
    const nonceData = await verifyFetchJSON(VERIFY_API.nonce, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ wallet, mode })
    });

    const message = nonceData?.message;
    if(!message) throw new Error('Verifier did not return a signable message.');

    verifySetStatus(mode === 'refresh' ? 'Sign to refresh your role state…' : 'Sign the wallet message to verify…', 'busy');
    const signature = await signer.signMessage(message);

    const submitData = await verifyFetchJSON(VERIFY_API.submit, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ wallet, message, signature, mode })
    });

    verifyApplySnapshot(submitData?.snapshot || null);
    verifyApplyDiscordUser(submitData?.discordUser || __verifyState.discordUser);
    verifySetStatus(submitData?.message || 'Roles synced successfully.', 'good');
  } catch(err){
    console.error('verify flow failed', err);
    verifySetStatus(err?.message || 'Verification failed. Try again.', 'bad');
  } finally {
    __verifyState.loading = false;
  }
}

function initHomepageVerifier(){
  const verifierRoot = document.getElementById('discord-verify');
  const discordBtn = document.getElementById('btnConnectDiscord');
  const verifyBtn = document.getElementById('btnVerifyRoles');
  const refreshBtn = document.getElementById('btnRefreshRoles');

  if(!verifierRoot || !discordBtn || !verifyBtn || !refreshBtn) return;

  discordBtn.addEventListener('click', startDiscordLogin);
  verifyBtn.addEventListener('click', ()=>verifyRolesFlow('verify'));
  refreshBtn.addEventListener('click', ()=>verifyRolesFlow('refresh'));

  loadVerifyStatus();
}

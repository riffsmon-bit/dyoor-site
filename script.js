// Don't attach global wallet modal on swap page
if (location.pathname.startsWith("/swap")) {
  // allow swap page to manage its own wallet logic
  // (or remove this if swap relies on script.js)
}
// ---------- Wallet + WL Checker (works on desktop + iOS) ----------
// WalletConnect v2 project id (public) – required for WalletConnect QR/deeplinks.
const WALLETCONNECT_PROJECT_ID = "515640b93fcb56906722f2d6b44d2e47";

// Active EIP-1193 provider (injected or WalletConnect)
let __activeEvmProvider = null;

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}
function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function currentDappUrl() {
  return encodeURIComponent(window.location.href);
}
function openExternal(url) {
  // Use normal navigation for in-app browsers that block window.open.
  window.location.href = url;
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
  if (links) links.style.display = mobileNoInjected ? "block" : "none";
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
      alert('No injected wallet detected. Use WalletConnect or open in your wallet browser.');
      return;
    }
    await connectWallet(injected);
  } catch (err) {
    console.error('connectWithWallet error:', err);
    alert('Could not start wallet connection. Try WalletConnect.');
  }
}

/* DYOOR One-page rebuild: centering-safe, demo-safe */
const CHAIN_ID_DEC = 143; // Monad
const CHAIN_ID_HEX = '0x' + CHAIN_ID_DEC.toString(16);

const WL_COLLECTIONS = [
  '0xe217a5517105a97616B09C05c685a7e125e6E753',
  '0xCa2072Dd949B6cf0Ba38e97C30B43051fBD6B529',
  '0x8A95cd8A25FBb8339FB89ecCbf29b3b84Bc9b360',
];

// Minimal ERC-721 ABI
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
];

// Expose shared constants for other pages (eg. stake.js)
try { window.ERC721_ABI = ERC721_ABI; } catch (e) {}

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
  } catch (e) {}
}

let demoOn = true;

// ---------- Helpers ----------
function qs(sel){ return document.querySelector(sel); }
function setText(el, txt){ if(el) el.textContent = txt; }
function shortAddr(a){ return a ? a.slice(0,6)+'…'+a.slice(-4) : ''; }

function escapeHtml(s){
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

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
      if(!silent) alert('No wallet detected. Use WalletConnect or open this site inside your wallet browser.'); else console.warn('No wallet detected. Use WalletConnect or open this site inside your wallet browser.');
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
      if(!silent) alert('Wallet did not return any accounts. Try WalletConnect or open in your wallet browser.'); else console.warn('Wallet did not return any accounts. Try WalletConnect or open in your wallet browser.');
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

    // Keep UI in sync
    if (eth && typeof eth.on === 'function') {
      eth.on('accountsChanged', (accts) => {
        userAddress = (accts && accts[0]) ? accts[0] : null;
        syncWalletGlobals();
        updateWalletUI();
      });
      eth.on('chainChanged', () => updateWalletUI());
      eth.on('disconnect', () => {
        provider = null; signer = null; userAddress = null; __activeEvmProvider = null;
        syncWalletGlobals();
        updateWalletUI();
      });
    }
  } catch (err) {
    console.error('Wallet connect error:', err);
    if(!silent) alert('Could not connect wallet. On iOS Safari: use WalletConnect or open this site inside your wallet app browser.'); else console.warn('Could not connect wallet. On iOS Safari: use WalletConnect or open this site inside your wallet app browser.');
  }
}

function updateWalletUI(){
  const addr = userAddress;
  const connectWL = qs('#btnConnectWL');
  const connectSwap = qs('#swapConnectBtn');
  const connectVerify = qs('#btnVerifyConnectWallet');
  // Some pages have additional connect buttons; keep this function safe.
  const connectCasino = qs('#btnConnectCasino');
  const chainPill = qs('#chainPill');
  const wlResult = qs('#wlResult');
  const verifyWalletValue = qs('#verifyWalletValue');
  const verifyWalletSub = qs('#verifyWalletSub');

  if (connectWL) connectWL.textContent = addr ? `Connected: ${shortAddr(addr)}` : 'Connect Wallet';
  if (connectCasino) connectCasino.textContent = addr ? `Connected: ${shortAddr(addr)}` : 'Connect Wallet';
  if (connectSwap) connectSwap.textContent = addr ? `Connected: ${shortAddr(addr)}` : 'Connect wallet';
  if (connectVerify) connectVerify.textContent = addr ? `Connected: ${shortAddr(addr)}` : 'Connect Wallet';
  if (chainPill) chainPill.textContent = addr ? `Monad • ${shortAddr(addr)}` : 'Monad';
  if (wlResult && addr) wlResult.textContent = `Connected: ${shortAddr(addr)}. Tap “Check Eligibility”.`;
  if (verifyWalletValue) verifyWalletValue.textContent = addr ? shortAddr(addr) : 'Not connected';
  if (verifyWalletSub) verifyWalletSub.textContent = addr
    ? 'Wallet connected on Monad. You can verify or refresh your Discord roles now.'
    : 'Connect the wallet that holds or has ascended your DYOORs.';

  // Keep globals synced for standalone pages that rely on window.* state.
  syncWalletGlobals();
}

function loadScript(src){
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
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

// ---------- Demo toggle ----------
function updateDemoUI(){
  const btn = qs('#btnToggleDemo');
  if(!btn) return;
  btn.textContent = demoOn ? 'Demo: ON' : 'Demo: OFF';
}

qs('#btnToggleDemo')?.addEventListener('click', ()=>{
  demoOn = !demoOn;
  updateDemoUI();
});

// ---------- WL Checker ----------
async function checkWhitelist(){
  const box = qs('#wlResult');
  box.classList.remove('good','bad');

  if(!userAddress){
    box.textContent = 'Connect your wallet first.';
    return;
  }
  if(!provider || !window.ethers){
    box.textContent = 'Provider not ready. Try reconnecting.';
    return;
  }
  // Ensure chain
  const ok = await ensureChain(provider, __activeEvmProvider);
  if(!ok){
    box.textContent = 'Please switch your wallet to Monad (chainId 143), then retry.';
    box.classList.add('bad');
    return;
  }

  box.textContent = 'Checking holdings…';

  try{
    let held = [];
    for(const addr of WL_COLLECTIONS){
      const c = new window.ethers.Contract(addr, ERC721_ABI, provider);
      const bal = await c.balanceOf(userAddress);
      if(bal && bal > 0n){
        held.push(addr);
      }
    }
    if(held.length){
      box.innerHTML = `✅ <b>WHITELISTED</b><br/><span class="tiny">Wallet ${shortAddr(userAddress)} holds ${held.length} collection(s).</span><br/><span class="tiny muted">${held.map(shortAddr).join(', ')}</span>`;
      box.classList.add('good');
    }else{
      box.innerHTML = `❌ <b>NOT WHITELISTED</b><br/><span class="tiny">Wallet ${shortAddr(userAddress)} does not hold any WL collections.</span>`;
      box.classList.add('bad');
    }
  }catch(e){
    console.error(e);
    box.textContent = 'Error checking WL. Make sure you are on Monad and try again.';
    box.classList.add('bad');
  }
}

qs('#btnConnectWL')?.addEventListener('click', ()=>{
  // Always show wallet options (prevents "nothing happens" on iOS Safari)
  openWalletModal();
});

qs('#btnCheckWL')?.addEventListener('click', checkWhitelist);


// ---------- Swap (0x via Netlify Function) ----------
const NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// Embedded pinned token list (so the UI never depends on fetching /tokenlist.monad.json)
const __EMBEDDED_TOKENLIST = {"tokens":[{"symbol":"WMON","name":"Wrapped MON","address":"0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A","chainId":143,"decimals":18},{"symbol":"USDC","name":"USD Coin","address":"0x754704Bc059F8C67012fEd69BC8A327a5aafb603","chainId":143,"decimals":6},{"symbol":"USDT0","name":"Tether USD","address":"0xe7cd86e13AC4309349F30B3435a9d337750fC82D","chainId":143,"decimals":6},{"symbol":"AUSD","name":"Agora USD","address":"0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a","chainId":143,"decimals":6},{"symbol":"USD1","name":"USD1","address":"0x111111d2bf19e43C34263401e0CAd979eD1cdb61","chainId":143,"decimals":6},{"symbol":"WETH","name":"Wrapped Ether","address":"0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242","chainId":143,"decimals":18},{"symbol":"wstETH","name":"Lido Wrapped Staked ETH","address":"0x10Aeaf63194db8d453d4D85a06E5eFE1dd0b5417","chainId":143,"decimals":18},{"symbol":"WBTC","name":"Wrapped Bitcoin","address":"0x0555E30da8f98308EdB960aa94C0Db47230d2B9c","chainId":143,"decimals":8},{"symbol":"WSOL","name":"Wrapped SOL","address":"0xea17E5a9efEBf1477dB45082d67010E2245217f1","chainId":143,"decimals":18},{"symbol":"LBTC","name":"Lombard Staked Bitcoin","address":"0xecAc9C5F704e954931349Da37F60E39f515c11c1","chainId":143,"decimals":8},{"symbol":"BTC.b","name":"BTC.b","address":"0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072","chainId":143,"decimals":18},{"symbol":"weETH","name":"Wrapped EtherFi ETH","address":"0xA3D68b74bF0528fdD07263c60d6488749044914b","chainId":143,"decimals":18},{"symbol":"ezETH","name":"Renzo Restaked ETH","address":"0x2416092f143378750bb29b79eD961ab195CcEea5","chainId":143,"decimals":18},{"symbol":"thBILL","name":"Theo Short Duration UST Fund","address":"0xfDD22Ce6D1F66bc0Ec89b20BF16CcB6670F55A5a","chainId":143,"decimals":6},{"symbol":"yzUSD","name":"Yuzu USD","address":"0x9dcB0D17eDDE04D27F387c89fECb78654C373858","chainId":143,"decimals":6},{"symbol":"wsrUSD","name":"Wrapped srUSD","address":"0x4809010926aec940b550D34a46A52739f996D75D","chainId":143,"decimals":6}]};

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

let __tokenIndex = new Map();
let __tokensPinned = [];
let __tokensDynamic = [];

async function fetchJSON(url){
  const res = await fetch(url, { cache: 'no-store' });
  if(!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.json();
}

function tokenKey(t){
  return (t.address || '').toLowerCase();
}

function fmtAmt(raw, decimals, precision=6){
  try {
    const s = window.ethers.formatUnits(raw, decimals);
    const n = Number(s);
    if(!isFinite(n)) return s;
    return n.toLocaleString(undefined, { maximumFractionDigits: precision });
  } catch { return String(raw); }
}

function buildOption(t){
  const o = document.createElement('option');
  o.value = t.address;
  o.textContent = `${t.symbol} — ${t.name}`;
  return o;
}

function populateSelect(sel, tokens){
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '';
  for(const t of tokens){ sel.appendChild(buildOption(t)); }
  if(cur) sel.value = cur;
}


// --- PancakeSwap-like token picker (modal) ---
let __tokenPickerTarget = 'sell'; // 'sell' | 'buy'
let __tokenPickerTab = 'pinned';  // 'pinned' | 'top' | 'all'

function el(id){ return document.getElementById(id); }

function tokenDisplay(t){
  const sym = (t.symbol || 'TOKEN').toUpperCase();
  const nm = t.name || 'Token';
  return { sym, nm };
}

function setTokenBtn(kind, t){
  const iconEl = el(kind==='sell' ? 'sellTokenIcon' : 'buyTokenIcon');
  const labelEl = el(kind==='sell' ? 'sellTokenLabel' : 'buyTokenLabel');
  if(!labelEl || !iconEl) return;
  const { sym, nm } = tokenDisplay(t || {});
  labelEl.textContent = sym;
  // icon
  iconEl.innerHTML = '';
  iconEl.style.backgroundImage = '';
  iconEl.classList.remove('hasLogo');
  const logo = t?.logoURI;
  if(logo){
    iconEl.style.backgroundImage = `url("${logo}")`;
    iconEl.classList.add('hasLogo');
  } else {
    // initials fallback
    const span = document.createElement('span');
    span.textContent = sym.slice(0, 2);
    iconEl.appendChild(span);
  }
  iconEl.title = nm;
}

function openTokenModal(target){
  __tokenPickerTarget = target;
  const modal = el('tokenModal');
  if(!modal) return;
  modal.classList.add('isOpen');
  modal.setAttribute('aria-hidden','false');
  const s = el('tokenSearch');
  if(s){ s.value=''; setTimeout(()=>s.focus(), 50); }
  renderTokenList();
}

function closeTokenModal(){
  const modal = el('tokenModal');
  if(!modal) return;
  modal.classList.remove('isOpen');
  modal.setAttribute('aria-hidden','true');
}

function pickToken(addr){
  const sel = qs(__tokenPickerTarget==='sell' ? '#sellTokenSel' : '#buyTokenSel');
  if(!sel) return;
  sel.value = addr;
  sel.dispatchEvent(new Event('change'));
  closeTokenModal();
}

function getPickerTokens(){
  if(__tokenPickerTab === 'top') return __tokensDynamic.length ? __tokensDynamic : __tokensPinned;
  if(__tokenPickerTab === 'all') {
    // merge pinned + dynamic
    const map = new Map();
    for(const t of __tokensPinned) map.set(tokenKey(t), t);
    for(const t of __tokensDynamic) if(!map.has(tokenKey(t))) map.set(tokenKey(t), t);
    return Array.from(map.values());
  }
  return __tokensPinned;
}

function renderTokenList(){
  const listEl = el('tokenList');
  if(!listEl) return;
  const q = (el('tokenSearch')?.value || '').trim().toLowerCase();
  const tokens = getPickerTokens();
  listEl.innerHTML = '';
  const max = 250;
  let shown = 0;

  const isAddr = (s) => /^0x[a-f0-9]{40}$/.test(s);

  for(const t of tokens){
    if(shown >= max) break;
    const addr = String(t.address||'').toLowerCase();
    const { sym, nm } = tokenDisplay(t);
    if(q){
      if(isAddr(q)){
        if(addr !== q) continue;
      } else {
        const hay = `${sym} ${nm} ${addr}`.toLowerCase();
        if(!hay.includes(q)) continue;
      }
    }
    const row = document.createElement('button');
    row.type='button';
    row.className='tokenRow';
    row.addEventListener('click', ()=>pickToken(t.address));

    const ico = document.createElement('div');
    ico.className='tokenRow__icon';
    if(t.logoURI){
      ico.style.backgroundImage = `url("${t.logoURI}")`;
      ico.classList.add('hasLogo');
    } else {
      ico.textContent = sym.slice(0,2);
    }

    const meta = document.createElement('div');
    meta.className='tokenRow__meta';
    meta.innerHTML = `<div class="tokenRow__sym">${sym}</div><div class="tokenRow__name">${nm}</div>`;

    const a = document.createElement('div');
    a.className='tokenRow__addr';
    a.textContent = addr.slice(0,6)+'…'+addr.slice(-4);

    row.appendChild(ico);
    row.appendChild(meta);
    row.appendChild(a);
    listEl.appendChild(row);
    shown++;
  }

  if(shown === 0){
    const empty = document.createElement('div');
    empty.className='tokenEmpty';
    empty.textContent = q ? 'No matches. Paste a contract address to match exactly.' : 'No tokens available.';
    listEl.appendChild(empty);
  }
}

async function loadPinnedTokens(){
  const list = (__EMBEDDED_TOKENLIST && __EMBEDDED_TOKENLIST.tokens) ? __EMBEDDED_TOKENLIST : {tokens:[]};
  const tokens = list.tokens || [];
  // Ensure native MON exists for UI + 0x
  const native = { chainId: CHAIN_ID_DEC, address: NATIVE_TOKEN, symbol: 'MON', name: 'Monad', decimals: 18 };
  const all = [native, ...tokens.filter(t => Number(t.chainId) === CHAIN_ID_DEC)];
  __tokensPinned = all;
  __tokenIndex = new Map(all.map(t => [tokenKey(t), t]));
  return all;
}

async function loadTopTokensFromGecko(){
  // Best-effort: infer popular tokens from top pools on PancakeSwap (Monad) via GeckoTerminal.
  const endpoints = [
    'https://api.geckoterminal.com/api/v2/networks/monad/dexes/pancakeswap-v3-monad/pools?sort=-volume_usd_h24&page=1',
    'https://api.geckoterminal.com/api/v2/networks/monad/dexes/pancakeswap-v2-monad/pools?sort=-volume_usd_h24&page=1'
  ];
  const seen = new Set(__tokensPinned.map(t => tokenKey(t)));
  const addrs = [];
  for(const url of endpoints){
    try{
      const j = await fetchJSON(url);
      const pools = j?.data || [];
      for(const p of pools){
        const a = p?.attributes || {};
        const candidates = [a.base_token_address, a.quote_token_address].filter(Boolean);
        for(const c of candidates){
          const addr = String(c).toLowerCase();
          if(!/^0x[a-f0-9]{40}$/.test(addr)) continue;
          if(seen.has(addr)) continue;
          seen.add(addr);
          addrs.push(addr);
          if(addrs.length >= 20) break;
        }
        if(addrs.length >= 20) break;
      }
    }catch(e){ /* ignore */ }
    if(addrs.length >= 20) break;
  }

  const cacheKey = 'dyoor_gecko_token_meta_v1';
  let cache = {};
  try{ cache = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; }catch{ cache = {}; }

  const out = [];
  for(const addr of addrs){
    // use cached meta first
    const cached = cache[addr];
    if(cached && cached.symbol){
      out.push(cached);
      continue;
    }
    try{
      const tj = await fetchJSON(`https://api.geckoterminal.com/api/v2/networks/monad/tokens/${addr}`);
      const at = tj?.data?.attributes || {};
      const t = {
        chainId: CHAIN_ID_DEC,
        address: addr,
        symbol: at.symbol || addr.slice(0,6)+'…',
        name: at.name || 'Token',
        decimals: Number(at.decimals || 18),
        logoURI: at.image_url || undefined
      };
      cache[addr] = t;
      out.push(t);
    }catch(e){
      out.push({ chainId: CHAIN_ID_DEC, address: addr, symbol: addr.slice(0,6)+'…', name: 'Token', decimals: 18 });
    }
  }

  try{ localStorage.setItem(cacheKey, JSON.stringify(cache)); }catch{}
  return out;
}


async function updateBalancesUI(){
  const sellBalEl = qs('#sellBal');
  const buyBalEl = qs('#buyBal');
  const sellSel = qs('#sellTokenSel');
  const buySel = qs('#buyTokenSel');
  if(!sellBalEl || !buyBalEl || !sellSel || !buySel) return;
  if(!provider || !userAddress){
    sellBalEl.textContent = 'Balance: —';
    buyBalEl.textContent = 'Balance: —';
    return;
  }
  try{
    const sellT = __tokenIndex.get(String(sellSel.value).toLowerCase()) || { address: sellSel.value, decimals: 18 };
    const buyT  = __tokenIndex.get(String(buySel.value).toLowerCase())  || { address: buySel.value, decimals: 18 };
    const getBal = async (t) => {
      if(String(t.address).toLowerCase() === NATIVE_TOKEN){
        return await provider.getBalance(userAddress);
      }
      const c = new window.ethers.Contract(t.address, ERC20_ABI, provider);
      return await c.balanceOf(userAddress);
    };
    const [b1, b2] = await Promise.all([getBal(sellT), getBal(buyT)]);
    sellBalEl.textContent = `Balance: ${fmtAmt(b1, sellT.decimals, 6)}`;
    buyBalEl.textContent  = `Balance: ${fmtAmt(b2, buyT.decimals, 6)}`;
  }catch(e){
    sellBalEl.textContent = 'Balance: —';
    buyBalEl.textContent = 'Balance: —';
  }
}

async function initSwapUI(){
  const sellSel = qs('#sellTokenSel');
  const buySel  = qs('#buyTokenSel');
  const quoteBtn = qs('#quoteBtn');
  const swapBtn  = qs('#swapBtn');
  const statusEl = qs('#status');
  if(!sellSel || !buySel || !quoteBtn || !swapBtn) return; // no swap on this page

  // Style: make selects usable on mobile
  sellSel.classList.add('swapSelect');
  buySel.classList.add('swapSelect');

  const setStatus = (t) => { if(statusEl) statusEl.textContent = t || ''; };

  // Load token list
  const pinned = await loadPinnedTokens();
  populateSelect(sellSel, pinned);
  populateSelect(buySel, pinned);
  // Defaults
  sellSel.value = NATIVE_TOKEN;
  const usdc = pinned.find(t => (t.symbol||'').toUpperCase()==='USDC');
  buySel.value = usdc ? usdc.address : (pinned[1]?.address || NATIVE_TOKEN);

  
  // Flip tokens (PancakeSwap style)
  qs('#flipBtn')?.addEventListener('click', ()=>{
    const a = sellSel.value;
    sellSel.value = buySel.value;
    buySel.value = a;
    sellSel.dispatchEvent(new Event('change'));
    buySel.dispatchEvent(new Event('change'));
    // Clear quote/output
    const buyAmtEl = qs('#buyAmount'); if(buyAmtEl) buyAmtEl.value = '';
    swapBtn.disabled = true;
    setStatus('');
  });

// Sync PancakeSwap-like token picker buttons
  const sellBtn = qs('#sellTokenBtn');
  const buyBtn  = qs('#buyTokenBtn');
  if(sellBtn) sellBtn.addEventListener('click', ()=>openTokenModal('sell'));
  if(buyBtn)  buyBtn.addEventListener('click', ()=>openTokenModal('buy'));

  // Modal controls
  qs('#tokenModal')?.addEventListener('click', (e)=>{
    const t = e.target;
    if(t && t.closest && t.closest('[data-token-close="1"]')) closeTokenModal();
  });
  qs('#tokenSearch')?.addEventListener('input', ()=>renderTokenList());
  qs('#tabPinned')?.addEventListener('click', ()=>{ __tokenPickerTab='pinned'; renderTokenList(); });
  qs('#tabTop')?.addEventListener('click', ()=>{ __tokenPickerTab='top'; renderTokenList(); });
  qs('#tabAll')?.addEventListener('click', ()=>{ __tokenPickerTab='all'; renderTokenList(); });

  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeTokenModal(); });
// Homepage verifier connect wallet button
qs('#verifyConnectWalletBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  openWalletModal();
});

// Close wallet modal from X button
qs('#walletModalClose')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeWalletModal();
});

// Close wallet modal from backdrop click
qs('#walletModalBackdrop')?.addEventListener('click', () => {
  closeWalletModal();
});

// ESC closes modal too
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeWalletModal();
});

// Wallet option buttons inside modal
document.querySelectorAll('.wallet-option[data-wallet]').forEach((btn) => {
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const walletType = btn.getAttribute('data-wallet') || '';
    await connectWithWallet(walletType);
  });
});
  // Set initial button labels
  setTokenBtn('sell', __tokenIndex.get(String(sellSel.value).toLowerCase()));
  setTokenBtn('buy',  __tokenIndex.get(String(buySel.value).toLowerCase()));

  // Load dynamic/top tokens (best effort)
  try{
    __tokensDynamic = await loadTopTokensFromGecko();
    // Merge into index if token isn't known yet (so picker can show it)
    for(const t of __tokensDynamic){
      const k = tokenKey(t);
      if(k && !__tokenIndex.has(k)) __tokenIndex.set(k, t);
    }
  }catch(e){ __tokensDynamic = []; }

  const refreshTop = async () => {
    const listEl = qs('#topTokensList');
    if(!listEl) return;
    listEl.innerHTML = '';

    const renderPill = (t, cls='tokenPill') => {
      const b = document.createElement('button');
      b.type='button';
      b.className=cls;
      b.textContent = (t.symbol || 'TOKEN').toUpperCase();
      b.addEventListener('click', ()=>{ buySel.value = t.address; buySel.dispatchEvent(new Event('change')); });
      return b;
    };

    // Pinned first (stables + wrapped + native)
    for(const t of pinned.slice(0, 12)){
      listEl.appendChild(renderPill(t));
    }

    // Then dynamic/top (from GeckoTerminal pools)
    if(__tokensDynamic && __tokensDynamic.length){
      const hr = document.createElement('div');
      hr.className='mini';
      hr.style.marginTop='10px';
      hr.textContent='Top (auto):';
      listEl.appendChild(hr);
      for(const t of __tokensDynamic.slice(0, 16)){
        listEl.appendChild(renderPill(t, 'tokenPill tokenPill--ghost'));
      }
    }
  };

  qs('#topTokensRefresh')?.addEventListener('click', refreshTop);
  await refreshTop();

  // When token selection changes, refresh balances
  sellSel.addEventListener('change', ()=>{ setTokenBtn('sell', __tokenIndex.get(String(sellSel.value).toLowerCase()) || {address:sellSel.value,symbol:'TOKEN'}); updateBalancesUI(); });
  buySel.addEventListener('change', ()=>{ setTokenBtn('buy', __tokenIndex.get(String(buySel.value).toLowerCase()) || {address:buySel.value,symbol:'TOKEN'}); updateBalancesUI(); });

  qs('#maxBtn')?.addEventListener('click', async ()=>{
    if(!provider || !userAddress) return setStatus('Connect wallet to use Max.');
    const t = __tokenIndex.get(String(sellSel.value).toLowerCase()) || { address: sellSel.value, decimals: 18 };
    try{
      let bal;
      if(String(t.address).toLowerCase() === NATIVE_TOKEN) bal = await provider.getBalance(userAddress);
      else bal = await (new window.ethers.Contract(t.address, ERC20_ABI, provider)).balanceOf(userAddress);
      const amt = window.ethers.formatUnits(bal, t.decimals);
      qs('#sellAmount').value = amt;
    }catch{ setStatus('Could not fetch balance.'); }
  });

  let lastQuote = null;
  async function getQuote(){
    if(!provider || !signer || !userAddress) {
      setStatus('Connect wallet first.');
      return;
    }
    const sellT = __tokenIndex.get(String(sellSel.value).toLowerCase()) || { address: sellSel.value, decimals: 18, symbol:'TOKEN', name:'Token' };
    const buyT  = __tokenIndex.get(String(buySel.value).toLowerCase())  || { address: buySel.value, decimals: 18, symbol:'TOKEN', name:'Token' };
    const amtStr = String(qs('#sellAmount').value || '').trim();
    if(!amtStr || Number(amtStr) <= 0) { setStatus('Enter an amount.'); return; }
    const slippage = Number(qs('#slippage')?.value || '1');
    const slippageBps = Math.max(0, Math.min(1000, Math.round(slippage * 100)));
    const sellAmount = window.ethers.parseUnits(amtStr, sellT.decimals).toString();

    setStatus('Fetching quote…');
    swapBtn.disabled = true;
    lastQuote = null;
    const params = new URLSearchParams({
      chainId: String(CHAIN_ID_DEC),
      sellToken: sellT.address,
      buyToken: buyT.address,
      sellAmount,
      taker: userAddress,
      slippageBps: String(slippageBps),
      sellDecimals: String(sellT.decimals ?? 18),
      buyDecimals: String(buyT.decimals ?? 18)
    });
    const res = await fetch(`/.netlify/functions/quote?${params.toString()}`);
    const j = await res.json();
    if(!res.ok){
      const msg = j?.error || 'Quote failed.';
      // Friendly liquidity message for common failure case
      if(String(msg).toLowerCase().includes('no pancakeswap') || String(msg).toLowerCase().includes('no route') || String(msg).toLowerCase().includes('no liquidity')){
        setStatus('No liquidity found for this pair on PancakeSwap (V3/V2). Try swapping through a stable (USDC/USDT) or pick a more liquid token.');
      } else {
        setStatus(msg);
      }
      // clear quote fields
      const buyAmtEl = qs('#buyAmount'); if(buyAmtEl) buyAmtEl.value='';
      const meta = qs('#quoteMeta'); if(meta) meta.textContent = '—';
      const warnBox = qs('#warnBox'); if(warnBox){ warnBox.style.display='none'; warnBox.innerHTML=''; }
      return;
    }
    lastQuote = j;
    setStatus('Quote ready.');
    // Update UI (PancakeSwap-like): fill output amount + meta line
    const out = fmtAmt(BigInt(j.buyAmount || '0'), buyT.decimals, 6);
    const buyAmtEl = qs('#buyAmount');
    if(buyAmtEl) buyAmtEl.value = out;
    const meta = qs('#quoteMeta');
    if(meta){
      const gasStr = j.gas ? String(j.gas) : '—';
      const priceStr = j.price ? String(j.price) : '—';
      const pi = (j.priceImpactBps ?? null);
      const piStr = (pi===null || pi===undefined) ? '—' : (pi/100).toFixed(2)+'%';
      const routeLbl = j?.route?.fallback === 'v2' ? 'V2' : 'V3';
      meta.textContent = `Est: ${out} ${buyT.symbol} • Price: ${priceStr} • Impact: ${piStr} • Route: ${routeLbl} • Gas: ${gasStr}`;
    }

    // Warnings (price impact / low liquidity / fallback notes)
    const warnBox = qs('#warnBox');
    if(warnBox){
      const warns = [];
      if(j.warnings && Array.isArray(j.warnings)) warns.push(...j.warnings);
      const pi = j.priceImpactBps;
      if(typeof pi === 'number'){
        if(pi >= 500) warns.push('High price impact (≥5%). Consider a smaller trade or a more liquid pair.');
        else if(pi >= 200) warns.push('Moderate price impact (≥2%).');
      }
      if(j?.route?.fallback === 'v2') warns.push('Fallback used PancakeSwap V2 (pair-based). Prices may differ from V3.');
      if(warns.length){
        warnBox.style.display='block';
        warnBox.innerHTML = '<strong>Warnings:</strong><br/>' + warns.map(w=>`• ${escapeHtml(String(w))}`).join('<br/>');
      } else {
        warnBox.style.display='none';
        warnBox.innerHTML = '';
      }
    }
    swapBtn.disabled = false;

    // Handle allowance issue

    const issues = j.issues || {};
    const issuesBox = qs('#issuesBox');
    if(issuesBox){
      issuesBox.style.display='none';
      issuesBox.innerHTML='';
    }
    if(issues.allowance && String(sellT.address).toLowerCase() !== NATIVE_TOKEN){
      const spender = issues.allowance.spender;
      const need = issues.allowance.amount;
      if(issuesBox){
        issuesBox.style.display='block';
        issuesBox.innerHTML = `Allowance required. <button id="approveBtn" type="button" class="chip">Approve</button>`;
        setTimeout(()=>{
          qs('#approveBtn')?.addEventListener('click', async ()=>{
            try{
              setStatus('Approving…');
              const c = new window.ethers.Contract(sellT.address, ERC20_ABI, signer);
              const tx = await c.approve(spender, need);
              await tx.wait();
              setStatus('Approved. Get quote again.');
            }catch(e){ setStatus('Approve failed.'); }
          });
        }, 0);
      }
      swapBtn.disabled = true;
      return;
    }
    swapBtn.disabled = false;
  }

  quoteBtn.addEventListener('click', ()=>{ getQuote().catch(e=>{ console.error(e); setStatus('Quote failed.'); }); });

  swapBtn.addEventListener('click', async ()=>{
    if(!lastQuote) return setStatus('Get a quote first.');
    try{
      setStatus('Sending swap…');
      swapBtn.disabled = true;
      // Treasury support fee (separate tx) — quote already uses net input amount.
      if (lastQuote.fee && lastQuote.fee.amount) {
        const feeAmt = BigInt(lastQuote.fee.amount);
        if (feeAmt > 0n) {
          const feeToken = String(lastQuote.fee.token || '').toLowerCase();
          const treasury = String(lastQuote.fee.recipient || '').trim();
          setStatus('Supporting DYOOR treasury…');
          if (feeToken === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
            const feeTx = await signer.sendTransaction({ to: treasury, value: feeAmt });
            await feeTx.wait();
          } else {
            const erc20 = new window.ethers.Contract(feeToken, ['function transfer(address to,uint256 amount) returns (bool)'], signer);
            const feeTx = await erc20.transfer(treasury, feeAmt);
            await feeTx.wait();
          }
        }
      }

      setStatus('Sending swap…');
      const txObj = lastQuote.transaction || { to: lastQuote.to, data: lastQuote.data, value: lastQuote.value };
      const tx = await signer.sendTransaction({
        to: txObj.to,
        data: txObj.data,
        value: txObj.value ? BigInt(txObj.value) : 0n
      });
      await tx.wait();
      setStatus('Swap complete.');
      await updateBalancesUI();
    } catch (e) {
      console.error(e);
      setStatus('Swap failed or rejected.');
    } finally {
      swapBtn.disabled = false;
    }
  });


  // Tooltip for "Supports DYOOR" (mobile-friendly)
  document.querySelectorAll('.tip[data-tip]').forEach((el)=>{
    el.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation();
      const msg = el.getAttribute('data-tip') || '';
      let toast = document.getElementById('dyTipToast');
      if(!toast){
        toast = document.createElement('div');
        toast.id = 'dyTipToast';
        toast.style.position = 'fixed';
        toast.style.left = '50%';
        toast.style.bottom = '18px';
        toast.style.transform = 'translateX(-50%)';
        toast.style.zIndex = '99999';
        toast.style.maxWidth = '92vw';
        toast.style.padding = '10px 12px';
        toast.style.borderRadius = '12px';
        toast.style.background = 'rgba(0,0,0,.72)';
        toast.style.border = '1px solid rgba(255,255,255,.16)';
        toast.style.backdropFilter = 'blur(10px)';
        toast.style.webkitBackdropFilter = 'blur(10px)';
        toast.style.color = '#fff';
        toast.style.fontSize = '13px';
        toast.style.lineHeight = '1.25';
        toast.style.boxShadow = '0 12px 40px rgba(0,0,0,.35)';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.display = 'block';
      clearTimeout(window.__dyTipT);
      window.__dyTipT = setTimeout(()=>{ toast.style.display='none'; }, 2600);
    }, { passive: false });
  });
  await updateBalancesUI();
}

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

  qs('#swapConnectBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();

    const okxProv =
      getInjectedProvider('okx') ||
      (window.okxwallet && (window.okxwallet.ethereum || window.okxwallet)) ||
      window.ethereum;

    if (detectOKXInjected() && okxProv && okxProv.request) {
      try {
        await connectWallet(okxProv);
        return;
      } catch (err) {
        console.warn('Direct OKX connect failed, falling back to modal:', err);
      }
    }

    openWalletModal();
  });

  bindClick('#btnConnectWL', safeOpenWalletModal);
  bindClick('#verifyConnectWalletBtn', safeOpenWalletModal);
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

  trySilent();

  let tries = 0;
  const iv = setInterval(async () => {
    tries++;
    await trySilent();
    if ((typeof userAddress !== 'undefined' && userAddress) || tries >= 8) {
      clearInterval(iv);
    }
  }, 300);

  updateWalletUI();

  try {
    initSwapUI();
  } catch (e) {
    console.warn('Swap init failed', e);
  }

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


// ---------- HOMEPAGE DISCORD VERIFIER ----------
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
  const discordBtn = document.getElementById('btnConnectDiscord');
  const connectWalletBtn = document.getElementById('btnVerifyConnectWallet');
  const verifyBtn = document.getElementById('btnVerifyRoles');
  const refreshBtn = document.getElementById('btnRefreshRoles');

  if(!discordBtn || !connectWalletBtn || !verifyBtn || !refreshBtn) return;

  discordBtn.addEventListener('click', startDiscordLogin);
  connectWalletBtn.addEventListener('click', ()=>openWalletModal());
  verifyBtn.addEventListener('click', ()=>verifyRolesFlow('verify'));
  refreshBtn.addEventListener('click', ()=>verifyRolesFlow('refresh'));

  loadVerifyStatus();
}

// ---------- GLOBAL ASCENSION BATTERY ----------
async function loadAscensionBattery(){
  try {
    const res = await fetch("/.netlify/functions/ascension-stats");
    const data = await res.json();

    const el = document.getElementById("batteryCount");
    if(!el) return;

    if(data.totalStaked !== undefined){
      el.textContent = data.totalStaked.toLocaleString() + " NFTs";
    } else {
      el.textContent = "Unavailable";
    }
  } catch(e){
    console.error("Battery load failed:", e);
    const el = document.getElementById("batteryCount");
    if(el) el.textContent = "Offline";
  }
}

// load on page start
document.addEventListener("DOMContentLoaded", () => {
  loadAscensionBattery();

  // auto refresh every 30 sec
  setInterval(loadAscensionBattery, 30000);
});
/* ===== DYOOR verifier wallet modal fix ===== */
(function () {
  function bindVerifierWalletUi() {
    const modal = document.getElementById('walletModal');
    if (!modal) return;

    const closeEls = modal.querySelectorAll('[data-close], #walletModalClose, .wallet-modal__close');
    const walletButtons = modal.querySelectorAll('.wallet-option[data-wallet]');

    function safeOpenWalletModal(e) {
      if (e) e.preventDefault();
      if (typeof openWalletModal === 'function') openWalletModal();
    }

    function safeCloseWalletModal(e) {
      if (e) e.preventDefault();
      if (typeof closeWalletModal === 'function') closeWalletModal();
    }

    document.querySelectorAll(
      '#verifyConnectWalletBtn, #btnConnectWL, #swapConnectBtn, [data-open-wallet]'
    ).forEach((btn) => {
      btn.addEventListener('click', safeOpenWalletModal);
    });

    closeEls.forEach((el) => {
      el.addEventListener('click', safeCloseWalletModal);
    });

    const backdrop =
      document.getElementById('walletModalBackdrop') ||
      modal.querySelector('.wallet-modal__backdrop');

    if (backdrop) {
      backdrop.addEventListener('click', safeCloseWalletModal);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') safeCloseWalletModal();
    });

    walletButtons.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const walletType = btn.getAttribute('data-wallet') || '';
        if (typeof connectWithWallet === 'function') {
          await connectWithWallet(walletType);
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindVerifierWalletUi);
  } else {
    bindVerifierWalletUi();
  }
})();
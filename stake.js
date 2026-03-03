// DYOOR Soft Staking (client-side) — UI + live holdings read
// NOTE: This is "soft" staking (off-chain). This page stores staking state locally for now.
// If you want server-verified points + leaderboard, we can wire this to a Netlify Function + DB.

const DYOOR_S1_CONTRACT = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const MAX_RENDER = 60;               // cap NFT cards rendered for performance
const DAILY_RATE = 10;               // points per NFT per day (editable)
const STAKE_API = '/.netlify/functions/stake';

const KEY = {
  staked: "dyoor_softStake_staked",
  stakedAmount: "dyoor_softStake_amount",
  stakeStart: "dyoor_softStake_start",
  lastSync: "dyoor_softStake_lastSync",
  points: "dyoor_softStake_points",
  sig: "dyoor_softStake_sig",
  nonce: "dyoor_softStake_nonce",
};

function qs(sel){ return document.querySelector(sel); }
function setText(el, txt){ if(el) el.textContent = txt; }
function fmtInt(n){ try{ return Intl.NumberFormat().format(Number(n)); }catch(e){ return String(n); } }

function nowMs(){ return Date.now(); }
function daysBetween(msA, msB){ return Math.max(0, (msB-msA) / (1000*60*60*24)); }

function getLocalBool(k){ return localStorage.getItem(k)==="1"; }
function setLocalBool(k,v){ localStorage.setItem(k, v ? "1" : "0"); }

function getLocalNum(k, d=0){ const v = Number(localStorage.getItem(k)); return Number.isFinite(v) ? v : d; }
function setLocalNum(k,v){ localStorage.setItem(k, String(Math.floor(v))); }

function setStatus(msg){ setText(qs("#stakeStatus"), msg); }

function ensureEthers(){
  if(!window.ethers) throw new Error("ethers not loaded");
  if(!window.ethers.Contract) throw new Error("ethers Contract missing");
}

async function getHoldings(address){
  ensureEthers();
  // Reuse ERC721_ABI from script.js if present, otherwise define minimal
  const abi = window.ERC721_ABI || ['function balanceOf(address owner) view returns (uint256)'];
  if(!window.provider) throw new Error("Wallet provider not ready");
  const c = new window.ethers.Contract(DYOOR_S1_CONTRACT, abi, window.provider);
  const bal = await c.balanceOf(address);
  return Number(bal);
}

// --- NFT rendering helpers (best-effort, on-chain)
const ERC165_ABI = [
  'function supportsInterface(bytes4 interfaceId) view returns (bool)'
];

const ERC721_ENUMERABLE_ABI = [
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)'
];

// Common non-enumerable helper methods used by many ERC721 contracts
const ERC721_WALLETOFOWNER_ABI = [
  'function walletOfOwner(address owner) view returns (uint256[])',
  'function tokensOfOwner(address owner) view returns (uint256[])',
  'function getOwnedTokens(address owner) view returns (uint256[])'
];

const ERC721_TOKENURI_ABI = [
  'function tokenURI(uint256 tokenId) view returns (string)'
];

const ERC721_OWNEROF_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)'
];

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function padTopicAddress(addr){
  return '0x' + String(addr).toLowerCase().replace(/^0x/,'').padStart(64,'0');
}

function topicToBigInt(topic){
  try { return BigInt(topic); } catch(_e) { return 0n; }
}

function normalizeIpfs(uri){
  if(!uri) return uri;
  if(uri.startsWith('ipfs://ipfs/')) {
    return 'https://ipfs.io/ipfs/' + uri.replace('ipfs://ipfs/','');
  }
  if(uri.startsWith('ipfs://')) {
    return 'https://ipfs.io/ipfs/' + uri.replace('ipfs://','');
  }
  return uri;
}

function ipfsGateways(path){
  // `path` is the CID[/...]
  return [
    `https://ipfs.io/ipfs/${path}`,
    `https://cloudflare-ipfs.com/ipfs/${path}`,
    `https://nftstorage.link/ipfs/${path}`,
  ];
}

function normalizeIpfsWithFallbacks(uri){
  if(!uri) return { primary: uri, fallbacks: [] };
  if(uri.startsWith('ipfs://ipfs/')){
    const p = uri.replace('ipfs://ipfs/','');
    const g = ipfsGateways(p);
    return { primary: g[0], fallbacks: g.slice(1) };
  }
  if(uri.startsWith('ipfs://')){
    const p = uri.replace('ipfs://','');
    const g = ipfsGateways(p);
    return { primary: g[0], fallbacks: g.slice(1) };
  }
  return { primary: uri, fallbacks: [] };
}

async function fetchJson(uri){
  const { primary, fallbacks } = normalizeIpfsWithFallbacks(uri);
  const u = primary;
  if(!u) throw new Error('Missing tokenURI');

  // data:application/json;base64,...
  if(u.startsWith('data:')){
    const comma = u.indexOf(',');
    const header = u.slice(0, comma);
    const body = u.slice(comma+1);
    if(/;base64/i.test(header)){
      const jsonStr = atob(body);
      return JSON.parse(jsonStr);
    }
    return JSON.parse(decodeURIComponent(body));
  }

  // try primary + fallbacks
  const tries = [u, ...fallbacks].filter(Boolean);
  let lastErr = null;
  for(const t of tries){
    try{
      const res = await fetch(t, { cache: 'no-store' });
      if(!res.ok) throw new Error('metadata fetch failed');
      return await res.json();
    } catch(e){
      lastErr = e;
    }
  }
  throw lastErr || new Error('metadata fetch failed');
}

async function getNftData(address, balance){
  ensureEthers();
  if(!window.provider) throw new Error('Wallet provider not ready');
  const provider = window.provider;

  // Build a contract that *may* support enumerable + tokenURI. We'll try calls safely.
  const abi = Array.from(new Set([
    ...ERC165_ABI,
    ...ERC721_ENUMERABLE_ABI,
    ...ERC721_WALLETOFOWNER_ABI,
    ...ERC721_TOKENURI_ABI,
    ...ERC721_OWNEROF_ABI,
    'function balanceOf(address owner) view returns (uint256)'
  ]));

  const c = new window.ethers.Contract(DYOOR_S1_CONTRACT, abi, provider);

  const take = Math.min(balance, MAX_RENDER);
  if(take <= 0) return [];

  // Best-effort tokenId enumeration strategies.
  // 1) ERC721Enumerable (tokenOfOwnerByIndex)
  // 2) walletOfOwner / tokensOfOwner / getOwnedTokens (common in many collections)
  // 3) Recent Transfer log scan (heuristic): scan backwards in growing windows to find tokenIds, then ownerOf() verify.
  // If none work, we return [] (caller falls back to placeholders).

  let tokenIds = [];

  // Strategy 2: walletOfOwner-like helpers
  for(const fn of ['walletOfOwner','tokensOfOwner','getOwnedTokens']){
    try{
      if(typeof c[fn] !== 'function') continue;
      const res = await c[fn].staticCall(address);
      const arr = Array.isArray(res) ? res : (res?.length ? Array.from(res) : []);
      const ids = arr.map(x=> x.toString());
      if(ids.length){
        tokenIds = ids.slice(0, take);
        break;
      }
    } catch(_e){}
  }

  // Strategy 1: ERC721Enumerable
  if(tokenIds.length === 0){
    let enumerable = false;
    try { enumerable = await c.supportsInterface('0x780e9d63'); } catch(_e) { enumerable = false; }
    if(enumerable){
      for(let i=0;i<take;i++){
        try{
          const tid = await c.tokenOfOwnerByIndex(address, i);
          tokenIds.push(tid.toString());
        } catch(e){
          console.warn('tokenOfOwnerByIndex failed', e);
          break;
        }
      }
    }
  }

  // Strategy 3: heuristic log scan (works for non-enumerable contracts)
  // We scan backwards in expanding windows until we collect enough candidate tokenIds,
  // then verify ownership via ownerOf(). This avoids needing an external indexer.
  if(tokenIds.length === 0){
    try{
      const latest = await provider.getBlockNumber();
      const target = take;
      let span = 2_000_000; // start window
      const maxTries = 6;
      const addrTopic = padTopicAddress(address);
      const candidates = new Set();

      for(let t=0; t<maxTries && candidates.size < target; t++){
        const fromBlock = Math.max(0, latest - span);
        const toBlock = latest;

        // Incoming transfers (to = address)
        try{
          const logsIn = await provider.getLogs({
            address: DYOOR_S1_CONTRACT,
            fromBlock,
            toBlock,
            topics: [TRANSFER_TOPIC, null, addrTopic]
          });
          for(const lg of logsIn){
            if(lg?.topics?.[3]) candidates.add(topicToBigInt(lg.topics[3]).toString());
          }
        } catch(_e){}

        // Outgoing transfers (from = address)
        try{
          const logsOut = await provider.getLogs({
            address: DYOOR_S1_CONTRACT,
            fromBlock,
            toBlock,
            topics: [TRANSFER_TOPIC, addrTopic, null]
          });
          for(const lg of logsOut){
            if(lg?.topics?.[3]) candidates.add(topicToBigInt(lg.topics[3]).toString());
          }
        } catch(_e){}

        // Expand search window if we haven't found enough
        span = span * 2;
      }

      if(candidates.size){
        const ids = Array.from(candidates);
        // Verify current ownership
        const owned = [];
        const check = async (tid)=>{
          try{
            const o = await c.ownerOf(tid);
            if(String(o).toLowerCase() === String(address).toLowerCase()) owned.push(tid);
          } catch(_e){}
        };
        // cap verification work
        const verifyIds = ids.slice(0, Math.min(ids.length, 400));
        const conc = 10;
        let p = 0;
        const workers = Array.from({length: Math.min(conc, verifyIds.length)}, async ()=>{
          while(p < verifyIds.length){
            const my = p++;
            await check(verifyIds[my]);
          }
        });
        await Promise.all(workers);

        tokenIds = owned.slice(0, target);
      }
    } catch(e){
      console.warn('log-scan token enumeration failed', e);
    }
  }

  if(tokenIds.length === 0) return [];

  const out = [];
  const concurrency = 6;
  let idx = 0;

  async function worker(){
    while(idx < tokenIds.length){
      const my = idx++;
      const tokenId = tokenIds[my];
      try{
        const uri = await c.tokenURI(tokenId);
        const meta = await fetchJson(uri);
        const image = normalizeIpfs(meta?.image || meta?.image_url || meta?.imageURI);
        out.push({ tokenId, name: meta?.name || 'DYOOR S1', image, raw: meta });
      } catch(e){
        console.warn('metadata load failed for', tokenId, e);
        out.push({ tokenId, name: 'DYOOR S1', image: null, raw: null });
      }
    }
  }

  const workers = Array.from({length: Math.min(concurrency, tokenIds.length)}, ()=>worker());
  await Promise.all(workers);

  // preserve token order
  out.sort((a,b)=> Number(a.tokenId) - Number(b.tokenId));
  return out;
}

function renderSkeleton(n=8){
  const grid = qs("#nftGrid");
  if(!grid) return;
  grid.innerHTML = "";
  for(let i=0;i<n;i++) {
    const d = document.createElement("div");
    d.className = "nft-card nft-card--skeleton";
    d.innerHTML = `<div class="nft-thumb"></div><div class="nft-meta"><div class="line"></div><div class="line small"></div></div>`;
    grid.appendChild(d);
  }
}

function renderNfts(count){
  const grid = qs("#nftGrid");
  if(!grid) return;
  grid.innerHTML = "";

  const show = Math.min(count, MAX_RENDER);
  const img = "/assets/lore.jpeg"; // site-themed art placeholder (swap to your collection image anytime)
  for(let i=0;i<show;i++) {
    const card = document.createElement("div");
    card.className = "nft-card";
    card.innerHTML = `
      <div class="nft-thumb">
        <img src="${img}" alt="DYOOR NFT" loading="lazy"/>
      </div>
      <div class="nft-meta">
        <div class="name">DYOOR S1</div>
        <div class="sub">Holding #${i+1}</div>
      </div>
    `;
    grid.appendChild(card);
  }

  if(count > MAX_RENDER){
    const more = document.createElement("div");
    more.className = "nft-more";
    more.innerHTML = `<div>Showing ${MAX_RENDER} of ${count}. (Cap for performance)</div>`;
    grid.appendChild(more);
  }
}

function renderNftsFromData(items, totalCount){
  const grid = qs('#nftGrid');
  if(!grid) return;
  grid.innerHTML = '';

  if(!items || items.length === 0){
    renderNfts(totalCount);
    return;
  }

  for(const it of items){
    const card = document.createElement('div');
    card.className = 'nft-card';
    const imgSrc = it.image || '/assets/lore.jpeg';
    const name = it.name || 'DYOOR S1';
    card.innerHTML = `
      <div class="nft-thumb">
        <img src="${imgSrc}" alt="${name}" loading="lazy"/>
      </div>
      <div class="nft-meta">
        <div class="name">${name}</div>
        <div class="sub">Token #${it.tokenId}</div>
      </div>
    `;
    grid.appendChild(card);
  }

  if(totalCount > MAX_RENDER){
    const more = document.createElement('div');
    more.className = 'nft-more';
    more.innerHTML = `<div>Showing ${MAX_RENDER} of ${totalCount}. (Cap for performance)</div>`;
    grid.appendChild(more);
  }
}

function updateChart(held, staked){
  const heldEl = qs('#chartHeld');
  const stakedEl = qs('#chartStaked');
  const barHeld = qs('#barHeld');
  const barStaked = qs('#barStaked');
  if(heldEl) heldEl.textContent = fmtInt(held);
  if(stakedEl) stakedEl.textContent = fmtInt(staked);
  const max = Math.max(1, held, staked);
  const heldPct = Math.round((held / max) * 100);
  const stakedPct = Math.round((staked / max) * 100);
  if(barHeld) barHeld.style.width = `${heldPct}%`;
  if(barStaked) barStaked.style.width = `${stakedPct}%`;
}

function shortAddr(a){
  if(!a) return '';
  const s = String(a);
  return s.length > 12 ? `${s.slice(0,6)}…${s.slice(-4)}` : s;
}

function renderLeaderboard(rows){
  const el = qs('#leaderboard');
  if(!el) return;
  el.innerHTML = '';
  if(!rows || rows.length === 0){
    el.innerHTML = `<div class="muted">No leaderboard data yet.</div>`;
    return;
  }
  rows.forEach((r, i)=>{
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.innerHTML = `
      <div class="lb-rank">#${i+1}</div>
      <div class="lb-addr">${shortAddr(r.address)}</div>
      <div class="lb-pts">${fmtInt(r.points || 0)} pts</div>
    `;
    el.appendChild(row);
  });
}

async function apiGet(params){
  const u = new URL(STAKE_API, window.location.origin);
  Object.entries(params || {}).forEach(([k,v])=> u.searchParams.set(k, String(v)));
  const res = await fetch(u.toString(), { cache: 'no-store' });
  if(!res.ok) throw new Error('api failed');
  return await res.json();
}

async function apiPost(payload){
  const res = await fetch(STAKE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if(!res.ok) throw new Error('api failed');
  return await res.json();
}

async function pushStakeStateToServer({ staked, stakedAmount }){
  // Best effort: if the function isn't deployed, we silently continue local-only.
  if(!window.signer || !window.userAddress) return;
  const address = window.userAddress;
  const nonce = Number(localStorage.getItem(KEY.nonce) || 0);
  const sig = localStorage.getItem(KEY.sig) || '';
  const stakeStart = getLocalNum(KEY.stakeStart, 0);
  const lastSync = getLocalNum(KEY.lastSync, 0);
  const points = getLocalNum(KEY.points, 0);
  const amount = getLocalNum(KEY.stakedAmount, 0);
  try{
    await apiPost({
      action: 'upsert',
      address,
      staked,
      stakedAmount: Number.isFinite(Number(stakedAmount)) ? Number(stakedAmount) : amount,
      stakeStart,
      lastSync,
      points,
      nonce,
      sig,
      contract: DYOOR_S1_CONTRACT,
    });
  } catch(e){
    console.warn('stake api unavailable (local-only)', e);
  }
}

function calcPoints(balance){
  const staked = getLocalBool(KEY.staked);
  if(!staked) return getLocalNum(KEY.points, 0);

  const stakedAmount = Math.min(balance, getLocalNum(KEY.stakedAmount, 0));
  if(stakedAmount <= 0) return getLocalNum(KEY.points, 0);

  const lastSync = getLocalNum(KEY.lastSync, getLocalNum(KEY.stakeStart, nowMs()));
  const pts = getLocalNum(KEY.points, 0);

  const add = daysBetween(lastSync, nowMs()) * DAILY_RATE * stakedAmount;
  return Math.floor(pts + add);
}

function writePoints(balance){
  const staked = getLocalBool(KEY.staked);
  if(!staked) return;

  const stakedAmount = Math.min(balance, getLocalNum(KEY.stakedAmount, 0));
  if(stakedAmount <= 0) return;

  const lastSync = getLocalNum(KEY.lastSync, getLocalNum(KEY.stakeStart, nowMs()));
  const pts = getLocalNum(KEY.points, 0);
  const add = daysBetween(lastSync, nowMs()) * DAILY_RATE * stakedAmount;

  setLocalNum(KEY.points, Math.floor(pts + add));
  setLocalNum(KEY.lastSync, nowMs());
}

async function softStake(balance, amount){
  if(!window.signer || !window.userAddress) {
    openWalletModal(); // from script.js
    return;
  }

  const safeAmt = Math.max(0, Math.min(balance, Number(amount || 0)));
  if(safeAmt <= 0){
    setStatus('Choose an amount > 0 to stake.');
    return;
  }

  // If already staked, just sync points and update staked amount
  const already = getLocalBool(KEY.staked);
  if(already){
    writePoints(balance);
    setLocalNum(KEY.stakedAmount, safeAmt);
    setStatus(`Updated staked amount to ${safeAmt}.`);
    updateStakeUI(balance);
    await pushStakeStateToServer({ staked: true, stakedAmount: safeAmt });
    return;
  }

  const nonce = Math.floor(Math.random()*1e9);
  const msg = `DYOOR Soft Stake\n\nI am enabling soft staking for Season 2 loyalty points.\n\nAddress: ${window.userAddress}\nContract: ${DYOOR_S1_CONTRACT}\nNonce: ${nonce}\n\nThis does NOT move NFTs.`;

  try {
    setStatus("Signing message…");
    const sig = await window.signer.signMessage(msg);
    localStorage.setItem(KEY.sig, sig);
    localStorage.setItem(KEY.nonce, String(nonce));

    setLocalBool(KEY.staked, true);
    setLocalNum(KEY.stakedAmount, safeAmt);
    setLocalNum(KEY.stakeStart, nowMs());
    setLocalNum(KEY.lastSync, nowMs());
    setLocalNum(KEY.points, 0);

    setStatus("Soft staking enabled. Points now accruing.");
    updateStakeUI(balance);

    await pushStakeStateToServer({ staked: true, stakedAmount: safeAmt });
  } catch(e) {
    console.error(e);
    setStatus("Signature cancelled.");
  }
}

function softUnstake(balance, amount){
  const staked = getLocalBool(KEY.staked);
  if(!staked){
    setStatus('Nothing staked.');
    return;
  }

  const current = Math.min(balance, getLocalNum(KEY.stakedAmount, 0));
  const remove = Math.max(0, Math.min(current, Number(amount || 0)));
  if(remove <= 0){
    setStatus('Choose an amount > 0 to unstake.');
    return;
  }

  // Sync points up to now based on current staked amount
  writePoints(balance);

  const next = Math.max(0, current - remove);
  setLocalNum(KEY.stakedAmount, next);
  if(next === 0){
    setLocalBool(KEY.staked, false);
    setStatus('Soft staking disabled. Points paused.');
  } else {
    setStatus(`Unstaked ${remove}. Still staked: ${next}.`);
  }
  updateStakeUI(balance);

  // Best-effort server update
  pushStakeStateToServer({ staked: next > 0, stakedAmount: next });
}

function updateStakeUI(balance){
  const staked = getLocalBool(KEY.staked);
  const stakedAmount = Math.min(balance, getLocalNum(KEY.stakedAmount, 0));
  const pill = qs("#stakePill");
  const ptsEl = qs("#pointsValue");
  const balEl = qs("#holdingsValue");
  const stakedAmtEl = qs('#stakedValue');
  const amtInput = qs('#stakeAmount');
  const btnStake = qs("#btnStake");
  const btnStakeAll = qs("#btnStakeAll");
  const btnUnstake = qs("#btnUnstake");
  const btnUnstakeAll = qs("#btnUnstakeAll");
  const btnSync = qs("#btnSync");

  if (balEl) balEl.textContent = fmtInt(balance);
  if (stakedAmtEl) stakedAmtEl.textContent = fmtInt(stakedAmount);
  if (ptsEl) ptsEl.textContent = fmtInt(calcPoints(balance));

  if (pill) {
    pill.textContent = staked ? "Soft Staked" : "Not Staked";
    pill.classList.toggle("is-on", staked);
  }

  // keep amount input in sync with balance bounds
  if(amtInput){
    const max = Math.max(0, balance);
    amtInput.max = String(max);
    if(Number(amtInput.value) > max) amtInput.value = String(max);
  }

  if (btnStake) btnStake.disabled = !window.userAddress || balance <= 0;
  if (btnStakeAll) btnStakeAll.disabled = !window.userAddress || balance <= 0;
  if (btnUnstake) btnUnstake.disabled = !window.userAddress || !stakedAmount;
  if (btnUnstakeAll) btnUnstakeAll.disabled = !window.userAddress || !stakedAmount;
  if (btnSync) btnSync.disabled = !staked || !window.userAddress;

  // chart
  updateChart(balance, staked ? stakedAmount : 0);
}

async function refreshAll(){
  const addr = window.userAddress;
  if(!addr) {
    updateStakeUI(0);
    setStatus("Connect your wallet to load holdings.");
    return;
  }

  setStatus("Loading your DYOOR S1 holdings…");

  try {
    const balance = await getHoldings(addr);
    updateStakeUI(balance);
    setStatus(balance > 0 ? `Holdings loaded. You own ${balance} DYOOR S1.` : "Holdings loaded. No DYOOR S1 found in this wallet.");
  } catch(e) {
    console.error(e);
    setStatus("Could not load holdings. Make sure you’re connected to Monad.");
    updateStakeUI(0);
  }
}

async function downloadSnapshot(){
  // Prefer server snapshot; fallback to local state.
  try{
    const data = await apiGet({ action: 'snapshot' });
    if(data && data.csv){
      const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dyoor_softstake_snapshot_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
  } catch(_e){}

  const addr = window.userAddress || '';
  const staked = getLocalBool(KEY.staked);
  const held = Number(qs('#holdingsValue')?.textContent?.replace(/,/g,'') || 0);
  const pts = getLocalNum(KEY.points, 0);
  const amt = Math.min(held, getLocalNum(KEY.stakedAmount, 0));
  const csv = `address,held,soft_staked,points\n${addr},${held},${staked?amt:0},${pts}\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dyoor_softstake_local_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function loadLeaderboard(){
  try{
    const data = await apiGet({ action: 'leaderboard' });
    renderLeaderboard(data?.rows || []);
  } catch(e){
    // no server; show empty state
    renderLeaderboard([]);
  }
}

document.addEventListener("DOMContentLoaded", ()=>{
  // The shared site script (script.js) provides the wallet modal UI,
  // but its click bindings were historically done inline on certain pages.
  // Stake is a dedicated page, so we bind the wallet option buttons here.
  const closeModal = ()=>{ try{ window.closeWalletModal && window.closeWalletModal(); } catch(_e){} };

  // Close on backdrop/X
  document.querySelectorAll('[data-close="1"]').forEach(el=>{
    el.addEventListener('click', (e)=>{ e.preventDefault(); closeModal(); });
  });

  // Connect actions (MetaMask/OKX/Phantom/WalletConnect)
  document.querySelectorAll('.wallet-option[data-wallet]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const t = btn.getAttribute('data-wallet');
      if (typeof window.connectWithWallet === 'function') {
        await window.connectWithWallet(t);
        // connectWithWallet -> connectWallet updates window.userAddress/provider/signer
        setTimeout(()=>refreshAll().catch(()=>{}), 500);
      } else {
        // Fallback: use the same injected-provider approach as swap/index.js
        try {
          const eth = window.ethereum;
          if (!eth || !eth.request) throw new Error('No injected wallet');
          await eth.request({ method: 'eth_requestAccounts' });
          setTimeout(()=>refreshAll().catch(()=>{}), 500);
        } catch (e) {
          console.error(e);
          setStatus('Wallet connection failed. Try WalletConnect or open in your wallet browser.');
        }
      }
    });
  });

  // The main site script (script.js) handles wallet connect and keeps window.userAddress updated.
  // We hook into it by refreshing whenever the connect button is used.
  qs("#btnConnectWL")?.addEventListener("click", ()=> {
    // script.js will open modal / connect; we refresh after a short delay
    setTimeout(()=>refreshAll().catch(()=>{}), 1200);
  });

  qs("#btnRefresh")?.addEventListener("click", ()=> refreshAll().catch(()=>{}));

  qs('#stakeAmount')?.addEventListener('input', ()=>{
    const bal = Number(qs("#holdingsValue")?.textContent?.replace(/,/g,"") || 0);
    // Just re-render UI bounds / chart (does not change staking until user clicks)
    updateStakeUI(bal);
  });

  qs("#btnStake")?.addEventListener("click", async ()=>{
    const bal = Number(qs("#holdingsValue")?.textContent?.replace(/,/g,"") || 0);
    const amt = Number(qs('#stakeAmount')?.value || 0);
    await softStake(bal, amt);
  
  qs("#btnStakeAll")?.addEventListener("click", async ()=>{
    const bal = Number(qs("#holdingsValue")?.textContent?.replace(/,/g,"") || 0);
    const amtInput = qs('#stakeAmount');
    if(amtInput) amtInput.value = String(bal);
    await softStake(bal, bal);
  });

});

  qs("#btnUnstake")?.addEventListener("click", ()=>{
    const bal = Number(qs("#holdingsValue")?.textContent?.replace(/,/g,"") || 0);
    const amt = Number(qs('#stakeAmount')?.value || 0);
    softUnstake(bal, amt);
  
  qs("#btnUnstakeAll")?.addEventListener("click", ()=>{
    const bal = Number(qs("#holdingsValue")?.textContent?.replace(/,/g,"") || 0);
    // Unstake everything currently staked
    const current = Math.min(bal, getLocalNum(KEY.stakedAmount, 0));
    if(current <= 0){
      setStatus("Nothing staked.");
      return;
    }
    softUnstake(bal, current);
    const amtInput = qs('#stakeAmount');
    if(amtInput) amtInput.value = "0";
  });

});

  qs("#btnSync")?.addEventListener("click", ()=>{
    const bal = Number(qs("#holdingsValue")?.textContent?.replace(/,/g,"") || 0);
    writePoints(bal);
    updateStakeUI(bal);
    setStatus("Points synced.");
    const staked = getLocalBool(KEY.staked);
    const stakedAmount = getLocalNum(KEY.stakedAmount, 0);
    pushStakeStateToServer({ staked, stakedAmount }).catch(()=>{});
  });

  qs('#btnDownloadSnapshot')?.addEventListener('click', ()=> downloadSnapshot().catch(()=>{}));
  qs('#btnLoadLeaderboard')?.addEventListener('click', ()=> loadLeaderboard().catch(()=>{}));

  // Initial paint
  refreshAll().catch(()=>{});
  loadLeaderboard().catch(()=>{});

  // Also refresh when accounts change (if provider emits it via WalletConnect / injected)
  try {
    const p = window.__activeEvmProvider || window.ethereum;
    if(p && p.on) {
      p.on("accountsChanged", ()=> setTimeout(()=>refreshAll().catch(()=>{}), 400));
      p.on("chainChanged", ()=> setTimeout(()=>refreshAll().catch(()=>{}), 400));
    }
  } catch(e){}
});

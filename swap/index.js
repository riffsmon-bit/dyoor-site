// Don't attach global wallet modal on swap page
if (location.pathname.startsWith("/swap")) {
  // allow swap page to manage its own wallet logic
  // (or remove this if swap relies on script.js)
}
(() => {
  // Token sources (GitHub-backed)
  const PANCAKE_EXTENDED = 'https://tokens.pancakeswap.finance/pancakeswap-extended.json';
  const MONAD_COMMUNITY = 'https://raw.githubusercontent.com/monad-crypto/token-list/main/tokenlist.json';
  const LOCAL_FALLBACK = '/tokenlist.monad.json';
  const TOKEN_CACHE_KEY = 'dyoor_tokens_143_cache_v1';

  // Minimal always-present fallbacks (in case any list fetch fails)
  const BASE_TOKENS = [
    { symbol: 'MON', name: 'Monad', address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, logoURI: '' },
    { symbol: 'WMON', name: 'Wrapped MON', address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', chainId: 143, decimals: 18, logoURI: '' },
    { symbol: 'USDC', name: 'USD Coin', address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', chainId: 143, decimals: 6, logoURI: '' }
  ];

  // Tokens to hide from the UI (by contract address). Requested: remove CHOG.
  const TOKEN_BLACKLIST = new Set([
    '0x350035555e10d9afaf1566aaebfced5ba6c27777' // CHOG
  ]);

  let TOKENS = [...BASE_TOKENS];
  const CHAIN_ID_DEC = 143;
  const CHAIN_ID_HEX = "0x8f";
  const fromSel = document.getElementById('fromToken');
  const toSel = document.getElementById('toToken');
  const supportToggle = document.getElementById('supportToggle');
  const flipBtn = document.getElementById('flipBtn');
  const fromAmt = document.getElementById('fromAmt');
  const toAmt = document.getElementById('toAmt');
  const connectBtn = document.getElementById('connectBtn');
  const swapBtn = document.getElementById('swapBtn');
  const unwrapBtn = document.getElementById('unwrapBtn');
  const maxBtn = document.getElementById('maxBtn');
  const statusBox = document.getElementById('statusBox');
  const accountLine = document.getElementById('accountLine');
  const fromLogo = document.getElementById('fromLogo');
  const toLogo = document.getElementById('toLogo');
  const fromBal = document.getElementById('fromBal');
  const toBal = document.getElementById('toBal');
  const routeLine = document.getElementById('routeLine');

  // View toggle (Basic / Advanced)
  const modeBasic = document.getElementById('modeBasic');
  const modeAdv = document.getElementById('modeAdv');
  const advancedBox = document.getElementById('advancedBox');
  function setView(v){
    const isAdv = v === 'advanced';
    if (advancedBox) advancedBox.style.display = isAdv ? '' : 'none';
    if (modeAdv) modeAdv.classList.toggle('is-on', isAdv);
    if (modeBasic) modeBasic.classList.toggle('is-on', !isAdv);
    try{ localStorage.setItem('dyoor_swap_view', v); }catch(e){}
  }
  modeBasic && modeBasic.addEventListener('click', () => setView('basic'));
  modeAdv && modeAdv.addEventListener('click', () => setView('advanced'));
  try{
    const saved = localStorage.getItem('dyoor_swap_view');
    if(saved === 'basic' || saved === 'advanced') setView(saved);
    else setView('advanced');
  }catch(e){ setView('advanced'); }


  let provider = null;
  let account = null;
  let slip = 0.5;
  let lastQuote = null;
  let lastFromBalRaw = null;

  function setStatus(html, cls) {
    statusBox.className = cls ? cls : 'mini';
    statusBox.textContent = html;
  }

  function setRoute(text) {
    routeLine.textContent = text || 'Route: —';
  }

  function flipTokens() {
    const a = fromSel.value;
    const b = toSel.value;
    fromSel.value = b;
    toSel.value = a;

    // keep the typed amount, but clear derived output + force UI refresh
    toAmt.textContent = '—';
    lastQuote = null;
    swapBtn.disabled = true;
    setRoute('Route: —');
    updateTokenUI();
    setStatus('Enter an amount — quote updates automatically.', 'mini');

    refreshBalances().catch(() => {});
    scheduleQuote();
  }

  function normalizeLogoURI(uri) {
    if (!uri) return '';
    if (uri.startsWith('ipfs://')) {
      const path = uri.replace('ipfs://', '');
      return 'https://ipfs.io/ipfs/' + path;
    }
    return uri;
  }

  async function fetchJSON(url, timeoutMs=7000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function mergeTokenLists(lists) {
    const map = new Map();
    // seed with BASE_TOKENS
    for (const t of BASE_TOKENS) {
      map.set(t.address.toLowerCase(), { ...t, logoURI: normalizeLogoURI(t.logoURI) });
    }
    for (const list of lists) {
      for (const t of (list || [])) {
        if (!t || !t.address) continue;
        if (t.chainId !== CHAIN_ID_DEC) continue;
        const key = t.address.toLowerCase();
        const merged = {
          symbol: t.symbol || map.get(key)?.symbol || '',
          name: t.name || map.get(key)?.name || '',
          address: t.address,
          decimals: Number(t.decimals ?? map.get(key)?.decimals ?? 18),
          chainId: CHAIN_ID_DEC,
          logoURI: normalizeLogoURI(t.logoURI || map.get(key)?.logoURI || '')
        };
        // prefer entries with a logo
        const existing = map.get(key);
        if (!existing || (!existing.logoURI && merged.logoURI)) map.set(key, merged);
        else map.set(key, { ...existing, ...merged });
      }
    }
    // sort: keep MON/WMON/USDC first, then by symbol
    const arr = [...map.values()].filter(t => !TOKEN_BLACKLIST.has((t.address||'').toLowerCase()));
    const priority = new Map([['MON',0],['WMON',1],['USDC',2]]);
    arr.sort((a,b) => {
      const pa = priority.has(a.symbol) ? priority.get(a.symbol) : 99;
      const pb = priority.has(b.symbol) ? priority.get(b.symbol) : 99;
      if (pa !== pb) return pa - pb;
      return (a.symbol || '').localeCompare(b.symbol || '');
    });
    return arr;
  }

  async function loadTokens() {
    // Cache first (wallet webviews can be flaky)
    try {
      const cached = JSON.parse(localStorage.getItem(TOKEN_CACHE_KEY) || 'null');
      if (cached && Array.isArray(cached.tokens) && cached.tokens.length > 10 && (Date.now() - cached.ts) < 24*60*60*1000) {
        TOKENS = mergeTokenLists([cached.tokens]);
        return;
      }
    } catch(_) {}

    let pancakeTokens = null;
    let monadTokens = null;
    let localTokens = null;

    // Local fallback is fast + reliable
    try {
      const j = await fetchJSON(LOCAL_FALLBACK, 4000);
      localTokens = Array.isArray(j?.tokens) ? j.tokens : (Array.isArray(j) ? j : null);
    } catch(_) {}

    // Remote sources
    try {
      const pj = await fetchJSON(PANCAKE_EXTENDED, 7000);
      pancakeTokens = Array.isArray(pj?.tokens) ? pj.tokens : null;
    } catch(_) {}
    try {
      const mj = await fetchJSON(MONAD_COMMUNITY, 7000);
      monadTokens = Array.isArray(mj?.tokens) ? mj.tokens : null;
    } catch(_) {}

    TOKENS = mergeTokenLists([localTokens, pancakeTokens, monadTokens]);
    try {
      localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ ts: Date.now(), tokens: TOKENS }));
    } catch(_) {}
  }

  function populate() {
    fromSel.innerHTML = '';
    toSel.innerHTML = '';
    const opt = (t) => {
      const o = document.createElement('option');
      o.value = t.address;
      o.textContent = `${t.symbol}`;
      o.dataset.decimals = String(t.decimals);
      if (t.logoURI) o.dataset.logo = t.logoURI;
      return o;
    };
    TOKENS.forEach(t => fromSel.appendChild(opt(t)));
    TOKENS.forEach(t => toSel.appendChild(opt(t)));
    fromSel.value = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // MON
    toSel.value = TOKENS.find(t=>t.symbol==="USDC")?.address || TOKENS[1].address;
    updateTokenUI();
  }

  function getToken(addr) {
    return TOKENS.find(t => t.address.toLowerCase() === addr.toLowerCase());
  }

  function setLogo(imgEl, token) {
    const addr = (token?.address || '').toLowerCase();
    const local = addr && addr.startsWith('0x') ? (`/assets/tokens/${addr}.png`) : '';
    const remote = normalizeLogoURI(token?.logoURI || '');
    // Try local first (most reliable in wallet browsers), then fall back to remote list logoURI.
    if (local) {
      imgEl.onerror = () => {
        if (remote) {
          imgEl.onerror = null;
          imgEl.src = remote;
          imgEl.style.visibility = 'visible';
        } else {
          imgEl.style.visibility = 'hidden';
        }
      };
      imgEl.src = local;
      imgEl.style.visibility = 'visible';
      return;
    }
    if (remote) {
      imgEl.onerror = null;
      imgEl.src = remote;
      imgEl.style.visibility = 'visible';
    } else {
      imgEl.removeAttribute('src');
      imgEl.style.visibility = 'hidden';
    }
  }

  function updateTokenUI() {
    setLogo(fromLogo, getToken(fromSel.value));
    setLogo(toLogo, getToken(toSel.value));
    refreshBalances();
  }

  function updateSelectedLogos() {
    setLogo(fromLogo, getToken(fromSel.value));
    setLogo(toLogo, getToken(toSel.value));
  }

  function hexPad32(addr) {
    return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  }

  async function readERC20Balance(tokenAddr, userAddr) {
    // balanceOf(address): 0x70a08231 + 32-byte address
    const data = '0x70a08231' + hexPad32(userAddr);
    const res = await provider.request({ method: 'eth_call', params: [{ to: tokenAddr, data }, 'latest'] });
    return BigInt(res);
  }

  async function refreshBalances() {
    if (!provider || !account) {
      fromBal.textContent = 'Balance: —';
      toBal.textContent = 'Balance: —';
      return;
    }
    try {
      const ft = getToken(fromSel.value);
      const tt = getToken(toSel.value);

      // From balance
      if (ft && ft.symbol === 'MON') {
        const b = await provider.request({ method: 'eth_getBalance', params: [account, 'latest'] });
        fromBal.textContent = `Balance: ${formatUnits(BigInt(b), 18, 6)} MON`;
      } else if (ft) {
        const b = await readERC20Balance(ft.address, account);
        fromBal.textContent = `Balance: ${formatUnits(b, ft.decimals, 6)} ${ft.symbol}`;
      }

      // To balance (nice-to-have)
      if (tt && tt.symbol === 'MON') {
        const b = await provider.request({ method: 'eth_getBalance', params: [account, 'latest'] });
        toBal.textContent = `Balance: ${formatUnits(BigInt(b), 18, 6)} MON`;
      } else if (tt) {
        const b = await readERC20Balance(tt.address, account);
        toBal.textContent = `Balance: ${formatUnits(b, tt.decimals, 6)} ${tt.symbol}`;
      }
    } catch (e) {
      // don't hard-fail UI
    }
  }

  function parseUnits(val, decimals) {
    const s = String(val || '').trim();
    if (!s) return null;
    if (!/^[0-9]*\.?[0-9]*$/.test(s)) return null;
    const [a,b=''] = s.split('.');
    const frac = (b + '0'.repeat(decimals)).slice(0, decimals);
    const whole = a ? BigInt(a) : 0n;
    const f = frac ? BigInt(frac) : 0n;
    return whole * (10n ** BigInt(decimals)) + f;
  }

  function formatUnits(amount, decimals, maxFrac=6) {
    try {
      const n = BigInt(amount);
      const base = 10n ** BigInt(decimals);
      const whole = n / base;
      let frac = (n % base).toString().padStart(decimals, '0');
      frac = frac.slice(0, maxFrac).replace(/0+$/,'');
      return frac ? `${whole.toString()}.${frac}` : whole.toString();
    } catch(e) {
      return '—';
    }
  }

  function pad32(hex) {
    return hex.replace(/^0x/,'').padStart(64,'0');
  }

  // ERC20 balanceOf(address) selector: 0x70a08231
  async function getERC20Balance(tokenAddr, ownerAddr) {
    const data = '0x70a08231' + pad32(ownerAddr.toLowerCase());
    const res = await provider.request({ method: 'eth_call', params: [{ to: tokenAddr, data }, 'latest'] });
    return BigInt(res);
  }

  async function refreshBalances() {
    if (!provider || !account) {
      fromBal.textContent = 'Balance: —';
      toBal.textContent = 'Balance: —';
      return;
    }
    try {
      const fromT = getToken(fromSel.value);
      const toT = getToken(toSel.value);
      // native
      let b1;
      if (fromT?.symbol === 'MON' || fromT?.address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
        const wei = await provider.request({ method: 'eth_getBalance', params: [account, 'latest'] });
        b1 = BigInt(wei);
      } else {
        b1 = await getERC20Balance(fromT.address, account);
      }
      lastFromBalRaw = b1;
      fromBal.textContent = `Balance: ${formatUnits(b1, fromT?.decimals ?? 18, 6)} ${fromT?.symbol || ''}`;

      let b2;
      if (toT?.symbol === 'MON' || toT?.address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
        const wei = await provider.request({ method: 'eth_getBalance', params: [account, 'latest'] });
        b2 = BigInt(wei);
      } else {
        b2 = await getERC20Balance(toT.address, account);
      }
      toBal.textContent = `Balance: ${formatUnits(b2, toT?.decimals ?? 18, 6)} ${toT?.symbol || ''}`;
    } catch(e) {
      fromBal.textContent = 'Balance: —';
      toBal.textContent = 'Balance: —';
    }
  }

  async function ensureProvider() {
    if (window.ethereum) {
      provider = window.ethereum;
      return true;
    }
    setStatus('No injected wallet found. Open inside MetaMask/OKX in-app browser.', 'err');
    return false;
  }

  async function ensureChain() {
    if (!provider) return false;
    try {
      const chainId = await provider.request({ method: 'eth_chainId' });
      if (chainId === CHAIN_ID_HEX) return true;
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
      return true;
    } catch (e) {
      // if chain not added
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: CHAIN_ID_HEX,
            chainName: 'Monad',
            rpcUrls: ['https://rpc.monad.xyz'],
            nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
            blockExplorerUrls: ['https://monadscan.com']
          }]
        });
        return true;
      } catch (e2) {
        setStatus('Please switch to Monad in your wallet.', 'err');
        return false;
      }
    }
  }

  async function connect() {
    if (!await ensureProvider()) return;
    const okChain = await ensureChain();
    if (!okChain) return;
    try {
      const accts = await provider.request({ method: 'eth_requestAccounts' });
      account = accts && accts[0] ? accts[0] : null;
      if (account) {
        connectBtn.textContent = 'Connected';
        accountLine.textContent = account.slice(0,6) + '…' + account.slice(-4);
        setStatus('Connected. Enter an amount — quote updates automatically.', 'ok');
        swapBtn.disabled = true;
        updateTokenUI();
      }
    } catch(e) {
      setStatus('Wallet connection canceled.', 'err');
    }
  }

  async function tryAutoConnect() {
    if (!await ensureProvider()) return;
    try {
      const accts = await provider.request({ method: 'eth_accounts' });
      if (accts && accts[0]) {
        account = accts[0];
        connectBtn.textContent = 'Connected';
        accountLine.textContent = account.slice(0,6) + '…' + account.slice(-4);
        updateTokenUI();
      }
    } catch(_e) {}
  }

  function currentSlippageBps() {
    return Math.floor(slip * 100); // 0.5% => 50 bps
  }

  let quoteTimer = null;
  function scheduleQuote() {
    // Debounce to avoid spamming RPC/Netlify
    if (!account) return;
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(() => {
      getQuote();
    }, 450);
  }

  // Support toggle (0.20% fee to treasury)
  const SUPPORT_KEY = 'dyoor_support_on';
  let supportOn = true;
  try{ const v = localStorage.getItem(SUPPORT_KEY); if (v === '0') supportOn = false; }catch(_e){}
  if (supportToggle){
    supportToggle.checked = supportOn;
    supportToggle.addEventListener('change', ()=>{
      supportOn = !!supportToggle.checked;
      try{ localStorage.setItem(SUPPORT_KEY, supportOn ? '1':'0'); }catch(_e){}
      lastQuote = null;
      toAmt.textContent = '—';
      swapBtn.disabled = true;
      setRoute('Route: —');
      setStatus('Enter an amount — quote updates automatically.', 'mini');
      scheduleQuote();
    });
  }


  async function getQuote() {
    lastQuote = null;
    swapBtn.disabled = true;
    const fromT = getToken(fromSel.value);
    const toT = getToken(toSel.value);
    if (!fromT || !toT) return;

    const amt = parseUnits(fromAmt.value, fromT.decimals);
    if (!amt || amt <= 0n) {
      setStatus('Enter a valid amount.', 'err');
      return;
    }

    setStatus('Fetching quote…', 'mini');
    const params = new URLSearchParams();
    params.set('sellToken', fromT.address);
    params.set('buyToken', toT.address);
    params.set('sellAmount', amt.toString());
    params.set('chainId', String(CHAIN_ID_DEC));
    params.set('slippageBps', String(currentSlippageBps()));
    params.set('sellTokenDecimals', String(fromT.decimals));
    params.set('buyTokenDecimals', String(toT.decimals));
    params.set('support', supportOn ? '1' : '0');
    if (account) params.set('taker', account);

    try {
      const res = await fetch('/.netlify/functions/quote?' + params.toString());
      const data = await res.json();
      if (!res.ok) {
        setRoute('Route: —');
        setStatus(data?.error || 'Quote failed', 'err');
        return;
      }
      lastQuote = data;
      toAmt.textContent = formatUnits(data.buyAmount, toT.decimals, 6);

      const piNum = data.priceImpactBps != null ? (Number(data.priceImpactBps)/100) : null;
      const pi = (piNum != null && Number.isFinite(piNum) && piNum >= 0 && piNum <= 99.99) ? piNum.toFixed(2) : null;
      const route = data?.route?.label || data?.route?.version || '—';
      setRoute(`Route: ${route}`);
      const warnTxt = (data.warnings && data.warnings.length) ? data.warnings.join(' • ') : '';
      const msg = `${pi ? `Price impact ~${pi}%` : 'Quote ready.'}${warnTxt ? ` — ${warnTxt}` : ''}`;
      setStatus(msg, (data.warnings && data.warnings.length) ? 'warn' : 'ok');

      // If allowance issue exists, user must approve first (we'll do it automatically before swapping)
      swapBtn.disabled = !account;
      if (!account) setStatus('Connect wallet to swap.', 'warn');
    } catch(e) {
      setStatus('Quote error. Check connection and retry.', 'err');
    }
  }

  function hexPad32(bi) {
    let h = BigInt(bi).toString(16);
    if (h.length % 2) h = '0' + h;
    return h.padStart(64, '0');
  }
  function addrPad32(addr) {
    return addr.toLowerCase().replace(/^0x/,'').padStart(64, '0');
  }
  function encodeApprove(spender, amount) {
    // approve(address,uint256) selector = 0x095ea7b3
    return '0x095ea7b3' + addrPad32(spender) + hexPad32(amount);
  }

  function encodeAllowance(owner, spender) {
    // allowance(address,address) selector = 0xdd62ed3e
    return '0xdd62ed3e' + addrPad32(owner) + addrPad32(spender);
  }

  async function readAllowance(token, owner, spender) {
    const data = encodeAllowance(owner, spender);
    const res = await provider.request({
      method: 'eth_call',
      params: [{ to: token, data }, 'latest']
    });
    return BigInt(res);
  
  function encodeTransfer(to, amount){
    const iface = new ethers.utils.Interface(['function transfer(address to, uint256 value)']);
    return iface.encodeFunctionData('transfer',[to, amount.toString()]);
  }

}

  async function estimateGas(tx) {
    const req = { from: account, to: tx.to, data: tx.data };
    if (tx.value && tx.value !== '0') req.value = '0x' + BigInt(tx.value).toString(16);
    return await provider.request({ method: 'eth_estimateGas', params: [req] });
  }

  async function sendTx(tx) {
    const req = {
      from: account,
      to: tx.to,
      data: tx.data,
    };
    if (tx.value && tx.value !== '0') req.value = '0x' + BigInt(tx.value).toString(16);
    return await provider.request({ method: 'eth_sendTransaction', params: [req] });
  }

  async function unwrapNow() {
    try {
      if (!account) return;
      const wmon = getToken('0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A') || TOKENS.find(t=>t.symbol==='WMON');
      const wmonAddr = wmon?.address || '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
      setStatus('Preparing unwrap…', 'mini');
      // withdraw(uint256) selector: 0x2e1a7d4d
      const bal = await provider.request({
        method: 'eth_call',
        params: [{ to: wmonAddr, data: '0x70a08231' + addrPad32(account) }, 'latest']
      });
      const balRaw = BigInt(bal);
      if (balRaw <= 0n) {
        setStatus('No WMON balance to unwrap.', 'warn');
        return;
      }
      const data = '0x2e1a7d4d' + hexPad32(balRaw); // withdraw(amount)
      await sendTx({ to: wmonAddr, data, value: '0' });
      setStatus('Unwrap sent. You should receive MON shortly.', 'ok');
      unwrapBtn.style.display = 'none';
      refreshBalances();
    } catch (e) {
      setStatus('Unwrap canceled or failed in wallet.', 'err');
    }
  }

  async function doSwap() {
    unwrapBtn.style.display = 'none';

    if (!account) {
      setStatus('Connect wallet first.', 'err');
      return;
    }
    if (!await ensureChain()) return;
    if (!lastQuote) {
      setStatus('Quote not ready yet — type an amount.', 'err');
      return;
    }

    const fromT = getToken(fromSel.value);
    const toT = getToken(toSel.value);

    try {
      swapBtn.disabled = true;
      setStatus('Preparing transaction…', 'mini');

      // --- Approvals (ERC20-in) ---
      // Some RPCs / wallets fail our server-side allowance precheck, so we do a client-side check too.
      const issues = lastQuote.issues || {};
      const isNativeIn = (fromT?.symbol === 'MON' || String(fromT?.address||'').toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
      if (!isNativeIn) {
        const spender = (issues.allowance?.spender || lastQuote?.transaction?.to || '').toLowerCase();
        const token = (issues.allowance?.token || fromT.address || '').toLowerCase();
        if (spender && token) {
          const need = parseUnits(fromAmt.value, fromT.decimals);
          try {
            const allowance = await readAllowance(token, account, spender);
            if (allowance < need) {
              const max = (1n << 256n) - 1n;
              const approveData = encodeApprove(spender, max);
              setStatus('Approve token…', 'warn');
              await sendTx({ to: token, data: approveData, value: '0' });
            }
          } catch (_a) {
            // If allowance read fails, still attempt an approval so the swap doesn't hard-fail.
            const max = (1n << 256n) - 1n;
            const approveData = encodeApprove(spender, max);
            setStatus('Approve token…', 'warn');
            await sendTx({ to: token, data: approveData, value: '0' });
          }
        }
      }

      // If user wants native MON output from an ERC20 input, some wallet webviews fail to simulate multicall+unwrap.
      // Preflight with estimateGas; if it fails, fall back to swapping into WMON and offer a one-tap unwrap.
      const wantsNativeOut = (toT?.symbol === 'MON' || String(toT?.address||'').toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
      const isERC20In = !(fromT?.symbol === 'MON' || String(fromT?.address||'').toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
      if (wantsNativeOut && isERC20In) {
        try {
          await estimateGas(lastQuote.transaction);
        } catch (_eg) {
          // fallback to WMON swap
          setStatus('Wallet cannot simulate MON unwrap. Swapping to WMON instead — then tap Unwrap.', 'warn');

          const wmonAddr = TOKENS.find(t=>t.symbol==='WMON')?.address || '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
          const params = new URLSearchParams();
          params.set('sellToken', fromT.address);
          params.set('buyToken', wmonAddr);
          const amt = parseUnits(fromAmt.value, fromT.decimals);
          params.set('sellAmount', String(amt));
          params.set('chainId', String(CHAIN_ID_DEC));
          params.set('slippageBps', String(currentSlippageBps()));
          params.set('sellTokenDecimals', String(fromT.decimals));
          params.set('buyTokenDecimals', '18');
          params.set('support', supportOn ? '1' : '0');
          params.set('taker', account);

          const res = await fetch('/.netlify/functions/quote?' + params.toString());
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || 'Fallback quote failed');

          // approve if needed for fallback
          const fbIssues = data.issues || {};
          if (fbIssues.allowance && fbIssues.allowance.spender && fbIssues.allowance.token) {
            const max = (1n << 256n) - 1n;
            const approveData = encodeApprove(fbIssues.allowance.spender, max);
            setStatus('Approve token…', 'warn');
            await sendTx({ to: fbIssues.allowance.token, data: approveData, value: '0' });
          }

          setStatus('Send swap (to WMON)…', 'mini');
          await sendTx(data.transaction);

          // Offer unwrap
          unwrapBtn.style.display = 'inline-flex';
          setStatus('Swap sent to WMON. Tap “Unwrap WMON → MON” to receive MON.', 'ok');
          return;
        }
      }

      setStatus('Send swap transaction…', 'mini');
      await sendTx(lastQuote.transaction);

      // Support fee transfer (separate confirmation) when enabled
      try{
        if (supportOn && lastQuote?.fee && BigInt(lastQuote.fee.amount||'0') > 0n){
          const feeAmt = BigInt(lastQuote.fee.amount);
          const feeToken = String(lastQuote.fee.token||'').toLowerCase();
          const nativeSentinel = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
          const recipient = String(lastQuote.fee.recipient||'').trim();
          // Soft warning: a second tx is coming
          setStatus('Swap sent. Confirm support fee transfer…', 'mini');

          if (feeToken === nativeSentinel || fromT?.symbol === 'MON'){
            // native MON fee (simple value transfer)
            await sendTx({ to: recipient, data: '0x', value: feeAmt.toString() });
          } else {
            // ERC20 fee transfer
            const transferData = encodeTransfer(recipient, feeAmt);
            await sendTx({ to: feeToken, data: transferData, value: '0' });
          }
        }
      }catch(_feeErr){
        // If user rejects the fee transfer, don't mark swap as failed.
        setStatus('Swap sent. Support fee transfer was skipped.', 'warn');
      }

      // If we swapped to WMON and user wanted MON, offer unwrap anyway as a convenience
      if (wantsNativeOut && isERC20In) {
        unwrapBtn.style.display = 'inline-flex';
      }

      setStatus('Transaction sent. Check your wallet / explorer.', 'ok');
      refreshBalances();
    } catch(e) {
      setStatus('Swap canceled or failed in wallet.', 'err');
    } finally {
      swapBtn.disabled = false;
    }
  }


  // slippage chip handlers
  document.querySelectorAll('[data-slip]').forEach(btn => {
    btn.addEventListener('click', () => {
      slip = Number(btn.getAttribute('data-slip'));
      document.querySelectorAll('[data-slip]').forEach(b=>b.classList.remove('chip--active'));
      btn.classList.add('chip--active');
      scheduleQuote();
    });
  });
  document.querySelector('[data-slip="0.5"]')?.classList.add('chip--active');

  connectBtn.addEventListener('click', connect);
  swapBtn.addEventListener('click', doSwap);
  unwrapBtn.addEventListener('click', unwrapNow);
  flipBtn.addEventListener('click', () => {
    flipTokens();
  });
  fromSel.addEventListener('change', () => {
    toAmt.textContent = '—';
    swapBtn.disabled = true;
    lastQuote = null;
    setRoute('Route: —');
    updateTokenUI();
    setStatus('Enter an amount — quote updates automatically.', 'mini');
    scheduleQuote();
  });
  toSel.addEventListener('change', () => {
    toAmt.textContent = '—';
    swapBtn.disabled = true;
    lastQuote = null;
    setRoute('Route: —');
    updateTokenUI();
    setStatus('Enter an amount — quote updates automatically.', 'mini');
    scheduleQuote();
  });
  fromAmt.addEventListener('input', () => {
    toAmt.textContent = '—';
    swapBtn.disabled = true;
    lastQuote = null;
    setRoute('Route: —');
    scheduleQuote();
  });

  // MAX button: fills amount with available balance (keeps a small gas buffer for MON)
  maxBtn.addEventListener('click', () => {
    const t = getToken(fromSel.value);
    if (!t || lastFromBalRaw == null) return;

    let amtRaw = lastFromBalRaw;
    if (t.symbol === 'MON') {
      // Keep a buffer for gas (0.05 MON). Prevents "insufficient funds".
      const buffer = 5n * (10n ** 16n); // 0.05 * 1e18
      amtRaw = amtRaw > buffer ? (amtRaw - buffer) : 0n;
    }
    fromAmt.value = formatUnits(amtRaw, t.decimals, 6);
    toAmt.textContent = '—';
    swapBtn.disabled = true;
    lastQuote = null;
    setRoute('Route: —');
  });

  (async () => {
    try {
      await loadTokens();
    } catch(_) {}
    populate();
    tryAutoConnect();
  })();
})();

// stake.js (root)
// Minimal wiring so buttons actually work.
// Assumes your stake.html has ids: btnConnectWL, btnStake, btnStakeAll, btnUnstake, btnUnstakeAll,
// btnSync, btnRefresh, btnDownloadSnapshot, btnLoadLeaderboard, btnExportLeaderboard, statusBox.

(() => {
  const qs = (s) => document.querySelector(s);
  const setStatus = (msg) => {
    const el = qs('#statusBox');
    if (el) el.textContent = msg;
  };

  // ---- placeholders (we’ll replace with real logic next) ----
  async function stakePartial() { setStatus('Stake: not wired yet (stakePartial).'); }
  async function stakeAll() { setStatus('Stake All: not wired yet (stakeAll).'); }
  async function unstakePartial() { setStatus('Unstake: not wired yet (unstakePartial).'); }
  async function unstakeAll() { setStatus('Unstake All: not wired yet (unstakeAll).'); }
  async function syncPoints() { setStatus('Sync: not wired yet (syncPoints).'); }
  async function downloadSnapshotCsv() {
    // If you already have a Netlify endpoint, this will hit it.
    // Otherwise it just tells you it’s missing.
    try {
      const url = '/.netlify/functions/snapshot.csv';
      setStatus('Downloading CSV…');
      const res = await fetch(url);
      if (!res.ok) throw new Error('CSV endpoint not available');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dyoor-softstake-snapshot.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus('CSV downloaded.');
    } catch (e) {
      setStatus('CSV endpoint not ready yet.');
    }
  }
  async function loadLeaderboard() { setStatus('Leaderboard: not wired yet (loadLeaderboard).'); }
  async function exportLeaderboardCsv() { return downloadSnapshotCsv(); }
  async function refreshStakeUI() { setStatus('Refreshed.'); }

  // expose for other scripts if needed
  window.refreshStakeUI = refreshStakeUI;

  // ---- Connect wallet helper ----
  async function connectWalletUI() {
    // Preferred: if your script.js exposes a connect function
    if (typeof window.connectWithWallet === 'function') {
      await window.connectWithWallet();
      return;
    }
    if (typeof window.connectWallet === 'function') {
      await window.connectWallet();
      return;
    }

    // Otherwise: open the modal if it exists
    const modal = qs('#walletModal');
    if (modal) {
      modal.setAttribute('aria-hidden', 'false');
      modal.classList.add('is-open');
      setStatus('Select a wallet in the modal.');
      return;
    }

    setStatus('Wallet UI not found. Make sure script.js + wallet modal exist.');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btnConnect = qs('#btnConnectWL');
    const btnRefresh = qs('#btnRefresh');
    const btnStake = qs('#btnStake');
    const btnStakeAll = qs('#btnStakeAll');
    const btnUnstake = qs('#btnUnstake');
    const btnUnstakeAll = qs('#btnUnstakeAll');
    const btnSync = qs('#btnSync');
    const btnDownloadSnapshot = qs('#btnDownloadSnapshot');
    const btnLoadLeaderboard = qs('#btnLoadLeaderboard');
    const btnExportLeaderboard = qs('#btnExportLeaderboard');

    if (!btnConnect) {
      console.error('Missing #btnConnectWL. Check stake.html ids.');
      return;
    }

    btnConnect.addEventListener('click', async () => {
      try { await connectWalletUI(); await refreshStakeUI(); }
      catch (e) { console.error(e); setStatus('Connect failed.'); }
    });

    btnRefresh?.addEventListener('click', async () => {
      try { await refreshStakeUI(); } catch (e) { console.error(e); }
    });

    btnStake?.addEventListener('click', async () => { try { await stakePartial(); } catch(e){ console.error(e);} });
    btnStakeAll?.addEventListener('click', async () => { try { await stakeAll(); } catch(e){ console.error(e);} });
    btnUnstake?.addEventListener('click', async () => { try { await unstakePartial(); } catch(e){ console.error(e);} });
    btnUnstakeAll?.addEventListener('click', async () => { try { await unstakeAll(); } catch(e){ console.error(e);} });
    btnSync?.addEventListener('click', async () => { try { await syncPoints(); } catch(e){ console.error(e);} });
    btnDownloadSnapshot?.addEventListener('click', async () => { try { await downloadSnapshotCsv(); } catch(e){ console.error(e);} });
    btnLoadLeaderboard?.addEventListener('click', async () => { try { await loadLeaderboard(); } catch(e){ console.error(e);} });
    btnExportLeaderboard?.addEventListener('click', async () => { try { await exportLeaderboardCsv(); } catch(e){ console.error(e);} });

    setStatus('Ready.');
  });
})();

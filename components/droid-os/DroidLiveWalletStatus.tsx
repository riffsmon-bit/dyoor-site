export function DroidLiveWalletStatus() {
  return <section className="os-wallet-strip" aria-label="Live integration status">
    <div className="os-wallet-identity"><span className="os-eyebrow">CONNECTED ROSTER</span><strong>Your Droids. Current artwork.</strong><span>Account balances and actions are not wired yet.</span></div>
    {[["DROID WALLET", "Not loaded"], ["MON BALANCE", "Unavailable"], ["OWNER ENERGY", "Unavailable"], ["ACHIEVEMENTS", "Unavailable"]].map(([label, value]) => <div className="os-wallet-metric" key={label}><span className="os-eyebrow">{label}</span><strong style={{ fontSize: 16 }}>{value}</strong></div>)}
  </section>;
}

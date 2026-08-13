import type {
  DroidAccountSnapshot,
  DroidProtocolConfig,
} from "@/lib/droid-accounts/types";

function positive(value: string) {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

export function DroidAssetTransferWarning({
  droid,
  config,
  compact = false,
}: {
  droid: DroidAccountSnapshot;
  config: DroidProtocolConfig;
  compact?: boolean;
}) {
  const assets = [
    ...(positive(droid.nativeBalance)
      ? [`${droid.nativeFormatted} ${config.nativeCurrencySymbol}`]
      : []),
    ...droid.tokens
      .filter((token) => positive(token.rawBalance))
      .map((token) => `${token.formattedBalance} ${token.symbol}`),
    ...(droid.nfts.length ? [`${droid.nfts.length} NFT${droid.nfts.length === 1 ? "" : "s"}`] : []),
  ];

  return (
    <aside
      className={`rounded-2xl border border-amber-300/35 bg-amber-300/[0.08] ${compact ? "p-4" : "p-5 sm:p-6"}`}
      aria-label="Droid Account transfer warning"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-300 text-lg font-black text-black" aria-hidden="true">!</span>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-200">
            Droid Account {assets.length ? "contains assets" : "travels with this NFT"}
          </p>
          {assets.length ? (
            <p className="mt-2 font-mono text-sm font-bold leading-6 text-white">
              {assets.join(" · ")}
            </p>
          ) : null}
          <p className="mt-2 text-sm font-semibold leading-6 text-amber-50/70">
            Transferring or selling Droid #{droid.tokenId} transfers control of its Droid Account to the new NFT owner. Assets are not automatically returned to your wallet.
          </p>
          {config.parentTokenBurnable ? (
            <p className="mt-3 rounded-xl border border-red-300/25 bg-red-300/[0.07] p-3 text-sm font-bold leading-6 text-red-100">
              Burning the parent {config.collectionName} permanently removes its controller. Withdraw every asset first; an activated or funded Droid must not be burned.
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

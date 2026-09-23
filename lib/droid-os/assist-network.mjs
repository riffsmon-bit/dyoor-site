/** Display and validation share the selected provider's eth_chainId, never a wallet UI label. */
export function describeAssistNetwork(raw) {
  const value = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw)
    : typeof raw === "bigint" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^(?:0x[\da-f]+|\d+)$/i.test(value) || value.length > 66) {
    return { status: "UNKNOWN", chainId: null, label: "Network unavailable" };
  }
  const chain = BigInt(value);
  if (chain <= 0n) return { status: "UNKNOWN", chainId: null, label: "Network unavailable" };
  return { status: chain === 143n ? "MONAD" : "OTHER", chainId: chain.toString(),
    label: chain === 143n ? "Monad mainnet · 143" : chain === 10143n ? "Monad testnet · 10143" : `Chain ${chain}` };
}

export async function requireAssistMonad(rpc) {
  const network = describeAssistNetwork(await rpc("eth_chainId", []));
  if (network.status !== "MONAD") {
    throw Error(network.status === "UNKNOWN" ? "The connected wallet provider did not report a valid network. Reconnect this site's wallet session; testing remains disabled."
      : `The connected wallet provider reports ${network.label}; this test requires Monad mainnet (143). If Backpack already shows Monad, reconnect this site's wallet session.`);
  }
  return network;
}

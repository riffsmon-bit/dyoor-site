import {
  MONAD_MAINNET_CHAIN_ID,
  switchProviderToMonadMainnet,
  type MonadEip1193Provider,
} from "@/lib/monad";
import {
  isRobinhoodChainId,
  switchProviderToRobinhoodChain,
  type RobinhoodEip1193Provider,
} from "@/lib/robinhood-chain";

export type DroidEip1193Provider = MonadEip1193Provider & RobinhoodEip1193Provider;

export function isSupportedDroidChainId(chainId: number) {
  return chainId === MONAD_MAINNET_CHAIN_ID || isRobinhoodChainId(chainId);
}

export async function providerDroidChainId(provider: DroidEip1193Provider) {
  const raw = await provider.request({ method: "eth_chainId" }).catch(() => "");
  try {
    return Number(BigInt(String(raw || 0)));
  } catch {
    return 0;
  }
}

export async function switchProviderToDroidChain(
  provider: DroidEip1193Provider,
  chainId: number,
) {
  if (chainId === MONAD_MAINNET_CHAIN_ID) {
    await switchProviderToMonadMainnet(provider);
    return;
  }
  if (isRobinhoodChainId(chainId)) {
    await switchProviderToRobinhoodChain(provider, chainId);
    return;
  }
  throw new Error(`Unsupported native Droid chain ${chainId}.`);
}

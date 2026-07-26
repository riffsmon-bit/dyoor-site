"use client";

import { useConnectWallet, usePrivy, type WalletListEntry } from "@privy-io/react-auth";
import { BrowserProvider } from "ethers";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useActivePrivyWallet } from "@/hooks/useActivePrivyWallet";
import { MONAD_CHAIN_HEX, MONAD_CHAIN_ID, MONAD_EXPLORER_URL, MONAD_RPC_URL } from "@/lib/monad";

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type BrowserEthereum = Eip1193Provider & {
  isMetaMask?: boolean;
  isOkxWallet?: boolean;
  isRabby?: boolean;
  isBackpack?: boolean;
  isTokenPocket?: boolean;
  isPhantom?: boolean;
  providers?: BrowserEthereum[];
};

type WalletStatus = "loading" | "idle" | "connecting" | "connected" | "wrong-network" | "error";
type WalletSource = "privy" | "browser" | "none";

const MOBILE_WALLET_LIST: WalletListEntry[] = [
  "metamask",
  "coinbase_wallet",
  "rainbow",
  "okx_wallet",
  "phantom",
  "backpack",
];

const DESKTOP_WALLET_LIST: WalletListEntry[] = [
  "metamask",
  "coinbase_wallet",
  "rainbow",
  "okx_wallet",
  "phantom",
  "backpack",
  "detected_ethereum_wallets",
  "wallet_connect_qr",
];

export type WalletService = {
  address: string;
  connected: boolean;
  error: string;
  providerName: string;
  ready: boolean;
  source: WalletSource;
  status: WalletStatus;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  getAddress: () => Promise<string>;
  getProvider: () => Promise<Eip1193Provider>;
  getSigner: () => Promise<unknown>;
  sendTransaction: (request: Record<string, string>) => Promise<string>;
  signMessage: (message: string) => Promise<string>;
  switchChain: () => Promise<void>;
};

const emptyService: WalletService = {
  address: "",
  connected: false,
  error: "",
  providerName: "",
  ready: true,
  source: "none",
  status: "idle",
  connect: async () => {
    throw new Error("No wallet provider found. Install MetaMask, Rabby, OKX, Backpack, TokenPocket, or Phantom EVM.");
  },
  disconnect: async () => {},
  getAddress: async () => {
    throw new Error("Wallet is not connected.");
  },
  getProvider: async () => {
    throw new Error("Wallet is not connected.");
  },
  getSigner: async () => {
    throw new Error("Wallet is not connected.");
  },
  sendTransaction: async () => {
    throw new Error("Wallet is not connected.");
  },
  signMessage: async () => {
    throw new Error("Wallet is not connected.");
  },
  switchChain: async () => {
    throw new Error("Wallet is not connected.");
  },
};

const WalletServiceContext = createContext<WalletService>(emptyService);

function shortProviderName(provider?: BrowserEthereum | null) {
  if (!provider) return "";
  if (provider.isOkxWallet) return "OKX";
  if (provider.isBackpack) return "Backpack";
  if (provider.isRabby) return "Rabby";
  if (provider.isTokenPocket) return "TokenPocket";
  if (provider.isPhantom) return "Phantom";
  if (provider.isMetaMask) return "MetaMask";
  return "Browser Wallet";
}

function injectedProvider() {
  if (typeof window === "undefined") return null;
  const ethereum = (window as any).ethereum as BrowserEthereum | undefined;
  if (!ethereum) return null;
  const providers: BrowserEthereum[] = Array.isArray(ethereum.providers) ? ethereum.providers : [ethereum];
  return providers.find((provider: BrowserEthereum) => provider.isMetaMask)
    || providers.find((provider: BrowserEthereum) => provider.isOkxWallet)
    || providers.find((provider: BrowserEthereum) => provider.isRabby)
    || providers.find((provider: BrowserEthereum) => provider.isBackpack)
    || providers.find((provider: BrowserEthereum) => provider.isTokenPocket)
    || providers.find((provider: BrowserEthereum) => provider.isPhantom)
    || providers[0]
    || null;
}

function normalizeAddress(value: unknown) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "")) ? String(value).toLowerCase() : "";
}

function isMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  const navigatorWithHints = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return navigatorWithHints.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function metaMaskDappUrl() {
  if (typeof window === "undefined") return "https://link.metamask.io";
  const dappUrl = `${window.location.host}${window.location.pathname}`;
  return `https://link.metamask.io/dapp/${dappUrl}`;
}

function privyConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/cancel|closed|rejected|denied/i.test(message)) return "Wallet connection was cancelled.";
  return message && !/^[a-z0-9_]+$/i.test(message)
    ? message
    : "Wallet connection failed. Close other wallet sessions, then try again.";
}

function useInjectedWallet() {
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [suppressedAddress, setSuppressedAddress] = useState("");
  const [providerName, setProviderName] = useState("");

  useEffect(() => {
    let attempts = 0;
    let timer = 0;
    const detect = () => {
      attempts += 1;
      const nextName = shortProviderName(injectedProvider());
      if (nextName) {
        setProviderName(nextName);
        return;
      }
      if (attempts < 12) {
        timer = window.setTimeout(detect, 350);
      }
    };
    detect();
    return () => window.clearTimeout(timer);
  }, []);

  const getProvider = useCallback(async () => {
    const active = injectedProvider();
    if (!active) throw new Error("No browser wallet found.");
    return active;
  }, []);

  const refreshAccounts = useCallback(async () => {
    try {
      const active = await getProvider();
      const accounts = await active.request({ method: "eth_accounts" }) as string[];
      const nextAddress = normalizeAddress(accounts?.[0]);
      if (nextAddress && nextAddress === suppressedAddress) {
        setAddress("");
        setWrongNetwork(false);
        return;
      }
      if (nextAddress && suppressedAddress && nextAddress !== suppressedAddress) {
        setSuppressedAddress("");
      }
      setAddress(nextAddress);
      const chainId = await active.request({ method: "eth_chainId" }).catch(() => "");
      setWrongNetwork(String(chainId || "").toLowerCase() !== MONAD_CHAIN_HEX);
    } catch {
      setAddress("");
    }
  }, [getProvider, suppressedAddress]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshAccounts(), 0);
    const active = injectedProvider();
    if (!active || typeof window === "undefined") {
      return () => window.clearTimeout(timer);
    }
    const onAccounts = () => void refreshAccounts();
    const onChain = () => void refreshAccounts();
    (active as any).on?.("accountsChanged", onAccounts);
    (active as any).on?.("chainChanged", onChain);
    return () => {
      window.clearTimeout(timer);
      (active as any).removeListener?.("accountsChanged", onAccounts);
      (active as any).removeListener?.("chainChanged", onChain);
    };
  }, [refreshAccounts]);

  const switchChain = useCallback(async () => {
    const active = await getProvider();
    try {
      await active.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MONAD_CHAIN_HEX }] });
    } catch {
      await active.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: MONAD_CHAIN_HEX,
          chainName: "Monad",
          rpcUrls: [MONAD_RPC_URL],
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          blockExplorerUrls: [MONAD_EXPLORER_URL],
        }],
      });
    }
    await refreshAccounts();
  }, [getProvider, refreshAccounts]);

  const connect = useCallback(async () => {
    setError("");
    setSuppressedAddress("");
    setConnecting(true);
    try {
      const active = await getProvider();
      const accounts = await active.request({ method: "eth_requestAccounts" }) as string[];
      const nextAddress = normalizeAddress(accounts?.[0]);
      if (!nextAddress) throw new Error("Wallet did not return an account.");
      setAddress(nextAddress);
      const chainId = await active.request({ method: "eth_chainId" }).catch(() => "");
      if (String(chainId || "").toLowerCase() !== MONAD_CHAIN_HEX) await switchChain();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connection failed.");
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [getProvider, switchChain]);

  const disconnect = useCallback(async () => {
    setError("");
    setWrongNetwork(false);
    let nextSuppressedAddress = address;
    try {
      const active = await getProvider();
      const accounts = await active.request({ method: "eth_accounts" }).catch(() => []) as string[];
      nextSuppressedAddress = normalizeAddress(nextSuppressedAddress || accounts?.[0]);
      await active.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      }).catch(() => undefined);
    } catch {}
    if (nextSuppressedAddress) setSuppressedAddress(nextSuppressedAddress);
    setAddress("");
  }, [address, getProvider]);

  const service = useMemo<WalletService>(() => ({
    address,
    connected: Boolean(address),
    error,
    providerName,
    ready: true,
    source: address ? "browser" : "none",
    status: connecting ? "connecting" : error ? "error" : address ? wrongNetwork ? "wrong-network" : "connected" : "idle",
    connect,
    disconnect,
    getAddress: async () => {
      if (address) return address;
      const active = await getProvider();
      const accounts = await active.request({ method: "eth_accounts" }) as string[];
      const nextAddress = normalizeAddress(accounts?.[0]);
      if (!nextAddress || nextAddress === suppressedAddress) throw new Error("Wallet is not connected.");
      return nextAddress;
    },
    getProvider,
    getSigner: async () => {
      const active = await getProvider();
      return new BrowserProvider(active, MONAD_CHAIN_ID).getSigner();
    },
    sendTransaction: async (request) => {
      const active = await getProvider();
      return await active.request({ method: "eth_sendTransaction", params: [request] }) as string;
    },
    signMessage: async (message: string) => {
      const active = await getProvider();
      let activeAddress = address;
      if (!activeAddress) {
        const accounts = await active.request({ method: "eth_accounts" }) as string[];
        activeAddress = normalizeAddress(accounts?.[0]);
      }
      if (!activeAddress || activeAddress === suppressedAddress) throw new Error("Wallet is not connected.");
      return await active.request({ method: "personal_sign", params: [message, activeAddress] }) as string;
    },
    switchChain,
  }), [address, connect, connecting, disconnect, error, getProvider, providerName, suppressedAddress, switchChain, wrongNetwork]);

  return service;
}

function InjectedOnlyWalletServiceProvider({ children }: { children: ReactNode }) {
  const service = useInjectedWallet();
  return <WalletServiceContext.Provider value={service}>{children}</WalletServiceContext.Provider>;
}

function MobileWalletBridge({
  metaMaskUrl,
  onClose,
  onOtherWallets,
}: {
  metaMaskUrl: string;
  onClose: () => void;
  onOtherWallets: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      aria-labelledby="mobile-wallet-bridge-title"
      aria-modal="true"
      className="fixed inset-0 z-[300] flex items-end justify-center bg-[#02040d]/88 p-3 backdrop-blur-md sm:items-center sm:p-6"
      role="dialog"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-dyoor-cyan/35 bg-[radial-gradient(circle_at_top_right,rgba(131,110,249,.24),transparent_42%),linear-gradient(145deg,#0b1023,#050712_72%)] p-5 shadow-[0_26px_90px_rgba(0,0,0,.72),0_0_42px_rgba(57,255,226,.12)] sm:p-7">
        <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-dyoor-purple/20 blur-3xl" />
        <button
          aria-label="Close mobile wallet options"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/35 text-lg text-white/65 transition hover:border-dyoor-cyan/50 hover:text-dyoor-cyan"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
        <div className="relative">
          <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-dyoor-cyan">Mobile wallet bridge</p>
          <h2 className="mt-2 pr-10 text-2xl font-black uppercase text-white" id="mobile-wallet-bridge-title">
            Open dYOOR in MetaMask
          </h2>
          <p className="mt-3 text-sm font-bold leading-6 text-white/60">
            Safari and Chrome cannot inject your mobile wallet. Open this exact page inside MetaMask, then tap
            Connect Holder Wallet there to approve the connection.
          </p>
          <a
            className="mt-6 flex min-h-14 w-full items-center justify-center rounded border border-dyoor-cyan bg-dyoor-cyan px-5 py-4 text-center text-sm font-black uppercase tracking-[0.08em] text-black shadow-[0_0_28px_rgba(57,255,226,.2)] transition hover:bg-white"
            href={metaMaskUrl}
          >
            Open in MetaMask
          </a>
          <button
            className="mt-3 min-h-12 w-full rounded border border-dyoor-purple/45 bg-dyoor-purple/12 px-4 py-3 text-xs font-black uppercase tracking-[0.08em] text-white/80 transition hover:border-dyoor-cyan/55 hover:text-dyoor-cyan"
            onClick={onOtherWallets}
            type="button"
          >
            Use another mobile wallet
          </button>
          <p className="mt-4 text-center text-[0.62rem] font-black uppercase leading-5 tracking-[0.1em] text-white/32">
            No transaction or token approval is requested during connection.
          </p>
        </div>
      </div>
    </div>
  );
}

function PrivyFirstWalletServiceProvider({ children }: { children: ReactNode }) {
  const injected = useInjectedWallet();
  const { authenticated, ready: authReady, logout } = usePrivy();
  const { wallet, ready: walletsReady } = useActivePrivyWallet();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [readyTimedOut, setReadyTimedOut] = useState(false);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [suppressedPrivyAddress, setSuppressedPrivyAddress] = useState("");
  const [metaMaskUrl, setMetaMaskUrl] = useState("");
  const rawPrivyAddress = normalizeAddress(wallet?.address);
  const privyAddress = rawPrivyAddress && rawPrivyAddress !== suppressedPrivyAddress ? rawPrivyAddress : "";
  const address = privyAddress || injected.address;
  const source: WalletSource = privyAddress ? "privy" : injected.source;
  const hasInjectedWallet = Boolean(injected.providerName);
  const privyReady = authReady && walletsReady;
  const uiReady = privyReady || readyTimedOut || hasInjectedWallet || Boolean(privyAddress);
  const { connectWallet } = useConnectWallet({
    onSuccess: () => {
      setConnecting(false);
      setError("");
    },
    onError: (connectionError) => {
      setConnecting(false);
      setError(privyConnectionError(connectionError));
    },
  });

  useEffect(() => {
    if (privyReady) return;
    const timer = window.setTimeout(() => setReadyTimedOut(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [privyReady]);

  const getProvider = useCallback(async () => {
    if (privyAddress && wallet && "getEthereumProvider" in wallet) {
      return await wallet.getEthereumProvider() as Eip1193Provider;
    }
    return await injected.getProvider();
  }, [injected, privyAddress, wallet]);

  const switchChain = useCallback(async () => {
    const provider = await getProvider();
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MONAD_CHAIN_HEX }] });
    } catch {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: MONAD_CHAIN_HEX,
          chainName: "Monad",
          rpcUrls: [MONAD_RPC_URL],
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          blockExplorerUrls: [MONAD_EXPLORER_URL],
        }],
      });
    }
  }, [getProvider]);

  useEffect(() => {
    let active = true;
    async function checkChain() {
      if (!address) {
        if (active) setWrongNetwork(false);
        return;
      }
      try {
        const provider = await getProvider();
        const chainId = await provider.request({ method: "eth_chainId" });
        if (active) setWrongNetwork(String(chainId || "").toLowerCase() !== MONAD_CHAIN_HEX);
      } catch {
        if (active) setWrongNetwork(false);
      }
    }
    void checkChain();
    return () => {
      active = false;
    };
  }, [address, getProvider]);

  const connect = useCallback(async () => {
    setError("");
    setSuppressedPrivyAddress("");
    setConnecting(true);
    try {
      if (injectedProvider()) {
        await injected.connect();
        return;
      }
      if (isMobileBrowser()) {
        setMetaMaskUrl(metaMaskDappUrl());
        return;
      }
      if (privyReady) {
        connectWallet({
          description: "Connect the wallet that holds your D.Y.O.O.R.",
          walletChainType: "ethereum-only",
          walletList: DESKTOP_WALLET_LIST,
        });
        return;
      }
      throw new Error(
        "Privy is still loading. Wait a moment, then tap Connect Wallet again.",
      );
    } catch (connectionError) {
      const message = connectionError instanceof Error
        ? connectionError.message
        : "Wallet connection failed.";
      setError(message);
      throw new Error(message);
    } finally {
      setConnecting(false);
    }
  }, [connectWallet, injected, privyReady]);

  const connectOtherMobileWallet = useCallback(() => {
    setMetaMaskUrl("");
    if (!privyReady) {
      setError("Wallet services are still loading. Wait a moment, then try again.");
      return;
    }
    connectWallet({
      description: "Connect the wallet that holds your D.Y.O.O.R.",
      walletChainType: "ethereum-only",
      walletList: MOBILE_WALLET_LIST,
    });
  }, [connectWallet, privyReady]);

  const disconnect = useCallback(async () => {
    setError("");
    setWrongNetwork(false);
    if (rawPrivyAddress) setSuppressedPrivyAddress(rawPrivyAddress);
    await Promise.resolve(wallet?.disconnect?.()).catch(() => undefined);
    if (authenticated) await Promise.resolve(logout()).catch(() => undefined);
    await injected.disconnect();
  }, [authenticated, injected, logout, rawPrivyAddress, wallet]);

  const service = useMemo<WalletService>(() => ({
    address,
    connected: Boolean(address),
    error: error || injected.error,
    providerName: source === "privy" ? "Privy" : injected.providerName,
    ready: uiReady,
    source,
    status: !uiReady
      ? "loading"
      : connecting || injected.status === "connecting"
        ? "connecting"
        : error || injected.status === "error"
          ? "error"
          : address
            ? wrongNetwork
              ? "wrong-network"
              : "connected"
            : "idle",
    connect,
    disconnect,
    getAddress: async () => {
      if (address) return address;
      return await injected.getAddress();
    },
    getProvider,
    getSigner: async () => {
      const provider = await getProvider();
      return new BrowserProvider(provider, MONAD_CHAIN_ID).getSigner();
    },
    sendTransaction: async (request) => {
      const provider = await getProvider();
      return await provider.request({ method: "eth_sendTransaction", params: [request] }) as string;
    },
    signMessage: async (message) => {
      const provider = await getProvider();
      const activeAddress = address || await injected.getAddress();
      return await provider.request({ method: "personal_sign", params: [message, activeAddress] }) as string;
    },
    switchChain,
  }), [address, connect, connecting, disconnect, error, getProvider, injected, source, switchChain, uiReady, wrongNetwork]);

  return (
    <WalletServiceContext.Provider value={service}>
      {children}
      {metaMaskUrl ? (
        <MobileWalletBridge
          metaMaskUrl={metaMaskUrl}
          onClose={() => setMetaMaskUrl("")}
          onOtherWallets={connectOtherMobileWallet}
        />
      ) : null}
    </WalletServiceContext.Provider>
  );
}

export function WalletServiceProvider({ children, privyEnabled }: { children: ReactNode; privyEnabled: boolean }) {
  return privyEnabled
    ? <PrivyFirstWalletServiceProvider>{children}</PrivyFirstWalletServiceProvider>
    : <InjectedOnlyWalletServiceProvider>{children}</InjectedOnlyWalletServiceProvider>;
}

export function useWalletService() {
  return useContext(WalletServiceContext);
}

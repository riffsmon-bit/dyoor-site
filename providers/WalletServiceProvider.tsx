"use client";

import { usePrivy } from "@privy-io/react-auth";
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

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: number;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => window.clearTimeout(timer));
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

function PrivyFirstWalletServiceProvider({ children }: { children: ReactNode }) {
  const injected = useInjectedWallet();
  const { authenticated, ready: authReady, login, logout } = usePrivy();
  const { wallet } = useActivePrivyWallet();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [readyTimedOut, setReadyTimedOut] = useState(false);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [suppressedPrivyAddress, setSuppressedPrivyAddress] = useState("");
  const rawPrivyAddress = normalizeAddress(wallet?.address);
  const privyAddress = rawPrivyAddress && rawPrivyAddress !== suppressedPrivyAddress ? rawPrivyAddress : "";
  const address = privyAddress || injected.address;
  const source: WalletSource = privyAddress ? "privy" : injected.source;
  const uiReady = authReady || readyTimedOut || injected.ready;
  const hasInjectedWallet = Boolean(injected.providerName);

  useEffect(() => {
    if (authReady) return;
    const timer = window.setTimeout(() => setReadyTimedOut(true), 4500);
    return () => window.clearTimeout(timer);
  }, [authReady]);

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
      if (hasInjectedWallet) {
        await injected.connect();
        return;
      }
      if (authReady && !readyTimedOut) {
        await timeout(Promise.resolve(login()), 8_000, "Privy connection timed out.");
        return;
      }
      await injected.connect();
    } catch (privyError) {
      try {
        await injected.connect();
      } catch (injectedError) {
        const message = injectedError instanceof Error
          ? injectedError.message
          : privyError instanceof Error
            ? privyError.message
            : "Wallet connection failed.";
        setError(message);
        throw new Error(message);
      }
    } finally {
      setConnecting(false);
    }
  }, [authReady, hasInjectedWallet, injected, login, readyTimedOut]);

  const disconnect = useCallback(async () => {
    setError("");
    setWrongNetwork(false);
    if (rawPrivyAddress) setSuppressedPrivyAddress(rawPrivyAddress);
    if (authenticated) await Promise.resolve(logout()).catch(() => undefined);
    await injected.disconnect();
  }, [authenticated, injected, logout, rawPrivyAddress]);

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

  return <WalletServiceContext.Provider value={service}>{children}</WalletServiceContext.Provider>;
}

export function WalletServiceProvider({ children, privyEnabled }: { children: ReactNode; privyEnabled: boolean }) {
  return privyEnabled
    ? <PrivyFirstWalletServiceProvider>{children}</PrivyFirstWalletServiceProvider>
    : <InjectedOnlyWalletServiceProvider>{children}</InjectedOnlyWalletServiceProvider>;
}

export function useWalletService() {
  return useContext(WalletServiceContext);
}

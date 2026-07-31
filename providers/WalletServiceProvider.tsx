"use client";

import { useConnectWallet, usePrivy } from "@privy-io/react-auth";
import { BrowserProvider } from "ethers";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { WalletAppChooser } from "@/components/wallet/WalletAppChooser";
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

type Eip6963ProviderDetail = {
  info?: {
    name?: string;
  };
  provider?: BrowserEthereum;
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
const announcedBrowserProviders: BrowserEthereum[] = [];
const browserProviderNames = new WeakMap<object, string>();

function shortProviderName(provider?: BrowserEthereum | null) {
  if (!provider) return "";
  const announcedName = browserProviderNames.get(provider);
  if (announcedName) return announcedName;
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
  if (!ethereum) return announcedBrowserProviders[0] || null;
  const providers: BrowserEthereum[] = Array.isArray(ethereum.providers) ? ethereum.providers : [ethereum];
  return announcedBrowserProviders[0] || providers[0] || null;
}

function normalizeAddress(value: unknown) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "")) ? String(value).toLowerCase() : "";
}

function walletConnectionError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  if (/cancel|closed|rejected|denied/i.test(message)) return "Wallet connection was cancelled.";
  return message && !/^[a-z0-9_]+$/i.test(message)
    ? message
    : "Wallet connection failed. Close any stale wallet request, then try again.";
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
    const onProviderAnnouncement = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      const announcedProvider = detail?.provider;
      if (!announcedProvider) return;
      if (!announcedBrowserProviders.includes(announcedProvider)) {
        announcedBrowserProviders.push(announcedProvider);
      }
      const announcedName = String(detail?.info?.name || "").trim();
      if (announcedName) browserProviderNames.set(announcedProvider, announcedName);
      setProviderName(shortProviderName(announcedProvider));
    };
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
    window.addEventListener("eip6963:announceProvider", onProviderAnnouncement);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    detect();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("eip6963:announceProvider", onProviderAnnouncement);
    };
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
  }, [providerName, refreshAccounts]);

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
      // Holder authentication only needs the wallet address and a signature.
      // Defer any Monad switch until the holder starts an on-chain World action.
      setWrongNetwork(String(chainId || "").toLowerCase() !== MONAD_CHAIN_HEX);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connection failed.");
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [getProvider]);

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

function PrivyWalletServiceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const {
    authenticated,
    error: privyInitializationError,
    logout,
    ready: authReady,
  } = usePrivy();
  const { wallet, ready: walletsReady } = useActivePrivyWallet();
  const [connectionError, setConnectionError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [suppressedAddress, setSuppressedAddress] = useState("");
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const rawAddress = normalizeAddress(wallet?.address);
  const address = rawAddress && rawAddress !== suppressedAddress ? rawAddress : "";
  const ready = authReady && walletsReady;

  const { connectWallet } = useConnectWallet({
    onError: (caught) => {
      setConnecting(false);
      setConnectionError(walletConnectionError(caught));
    },
    onSuccess: () => {
      setConnecting(false);
      setConnectionError("");
      setSuppressedAddress("");
    },
  });

  const getProvider = useCallback(async () => {
    if (!wallet || !address) throw new Error("Wallet is not connected.");
    return await wallet.getEthereumProvider() as Eip1193Provider;
  }, [address, wallet]);

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
    setConnectionError("");
    setSuppressedAddress("");
    if (!ready) {
      const message = privyInitializationError?.message
        || "Wallet choices are still loading. Wait a moment, then try again.";
      setConnectionError(message);
      throw new Error(message);
    }

    setConnecting(true);
    try {
      connectWallet({
        description: "Choose the wallet that holds your D.Y.O.O.R.",
        walletChainType: "ethereum-only",
        walletList: ["detected_ethereum_wallets", "wallet_connect"],
      });
    } catch (caught) {
      const message = walletConnectionError(caught);
      setConnectionError(message);
      throw new Error(message);
    } finally {
      // Privy's modal owns the remainder of the connection lifecycle. Its
      // callbacks update the final success/error state without locking the
      // site's Connect button if the user closes the modal.
      setConnecting(false);
    }
  }, [connectWallet, privyInitializationError?.message, ready]);

  const disconnect = useCallback(async () => {
    setConnectionError("");
    setWrongNetwork(false);
    if (rawAddress) setSuppressedAddress(rawAddress);
    await Promise.resolve(wallet?.disconnect?.()).catch(() => undefined);
    if (authenticated) await Promise.resolve(logout()).catch(() => undefined);
  }, [authenticated, logout, rawAddress, wallet]);

  const switchChain = useCallback(async () => {
    if (!wallet || !address) throw new Error("Wallet is not connected.");
    await wallet.switchChain(MONAD_CHAIN_ID);
    const provider = await wallet.getEthereumProvider() as Eip1193Provider;
    const chainId = await provider.request({ method: "eth_chainId" }).catch(() => "");
    setWrongNetwork(String(chainId || "").toLowerCase() !== MONAD_CHAIN_HEX);
  }, [address, wallet]);

  const error = connectionError || privyInitializationError?.message || "";
  const service = useMemo<WalletService>(() => ({
    address,
    connected: Boolean(address),
    error,
    providerName: wallet?.meta?.name || "Privy Wallet",
    ready,
    source: address ? "privy" : "none",
    status: !ready
      ? error
        ? "error"
        : "loading"
      : connecting
        ? "connecting"
        : error
          ? "error"
          : address
            ? wrongNetwork
              ? "wrong-network"
              : "connected"
            : "idle",
    connect,
    disconnect,
    getAddress: async () => {
      if (!address) throw new Error("Wallet is not connected.");
      return address;
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
      if (!address) throw new Error("Wallet is not connected.");
      return await provider.request({ method: "personal_sign", params: [message, address] }) as string;
    },
    switchChain,
  }), [
    address,
    connect,
    connecting,
    disconnect,
    error,
    getProvider,
    ready,
    switchChain,
    wallet?.meta?.name,
    wrongNetwork,
  ]);

  return <WalletServiceContext.Provider value={service}>{children}</WalletServiceContext.Provider>;
}

function UniversalWalletServiceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const injected = useInjectedWallet();
  const [walletChooserOpen, setWalletChooserOpen] = useState(false);
  const address = injected.address;
  const source: WalletSource = address ? "browser" : "none";
  const connecting = injected.status === "connecting";
  const error = injected.error;
  const wrongNetwork = injected.status === "wrong-network";

  const closeWalletChooser = useCallback(() => {
    setWalletChooserOpen(false);
  }, []);

  const connect = useCallback(async () => {
    if (injectedProvider()) {
      await injected.connect();
      return;
    }
    setWalletChooserOpen(true);
  }, [injected]);

  const disconnect = useCallback(async () => {
    await injected.disconnect();
  }, [injected]);

  const getProvider = useCallback(async () => {
    if (!injectedProvider()) {
      throw new Error("Open this page inside an EVM wallet browser, then connect your wallet.");
    }
    return await injected.getProvider();
  }, [injected]);

  const getAddress = useCallback(async () => {
    if (address) return address;
    if (injectedProvider()) return await injected.getAddress();
    throw new Error("Open this page inside an EVM wallet browser, then connect your wallet.");
  }, [address, injected]);

  const switchChain = useCallback(async () => {
    if (!injectedProvider()) {
      throw new Error("Open this page inside an EVM wallet browser, then connect your wallet.");
    }
    await injected.switchChain();
  }, [injected]);

  const service = useMemo<WalletService>(() => ({
    address,
    connected: Boolean(address),
    error,
    providerName: injected.providerName || "Wallet App",
    ready: true,
    source,
    status: connecting
      ? "connecting"
      : error
        ? "error"
        : address
          ? wrongNetwork
            ? "wrong-network"
            : "connected"
          : "idle",
    connect,
    disconnect,
    getAddress,
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
      const activeAddress = await getAddress();
      return await provider.request({ method: "personal_sign", params: [message, activeAddress] }) as string;
    },
    switchChain,
  }), [
    address,
    connect,
    connecting,
    disconnect,
    error,
    getAddress,
    getProvider,
    injected.providerName,
    source,
    switchChain,
    wrongNetwork,
  ]);

  return (
    <>
      <WalletServiceContext.Provider value={service}>{children}</WalletServiceContext.Provider>
      <WalletAppChooser
        onClose={closeWalletChooser}
        open={walletChooserOpen}
      />
    </>
  );
}

export function WalletServiceProvider({
  children,
  privyEnabled,
}: {
  children: ReactNode;
  privyEnabled: boolean;
}) {
  return privyEnabled
    ? <PrivyWalletServiceProvider>{children}</PrivyWalletServiceProvider>
    : <UniversalWalletServiceProvider>{children}</UniversalWalletServiceProvider>;
}

export function useWalletService() {
  return useContext(WalletServiceContext);
}

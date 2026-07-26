"use client";

import { BrowserProvider } from "ethers";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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

type WalletConnectProvider = Eip1193Provider & {
  accounts?: string[];
  chainId?: number;
  connected?: boolean;
  session?: {
    peer?: {
      metadata?: {
        name?: string;
      };
    };
  };
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  enable: () => Promise<string[]>;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  removeListener: (event: string, listener: (...args: any[]) => void) => unknown;
};

type WalletStatus = "loading" | "idle" | "connecting" | "connected" | "wrong-network" | "error";
type WalletSource = "walletconnect" | "browser" | "none";

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
  const message = error instanceof Error ? error.message : String(error || "");
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

let walletConnectProviderPromise: Promise<WalletConnectProvider> | null = null;
let walletConnectProviderProjectId = "";

function createWalletConnectProvider(projectId: string) {
  if (walletConnectProviderPromise && walletConnectProviderProjectId === projectId) {
    return walletConnectProviderPromise;
  }

  walletConnectProviderProjectId = projectId;
  walletConnectProviderPromise = import("@walletconnect/ethereum-provider")
    .then(async ({ EthereumProvider }) => {
      const origin = window.location.origin;
      return await EthereumProvider.init({
        projectId,
        optionalChains: [MONAD_CHAIN_ID],
        optionalMethods: [
          "eth_accounts",
          "eth_requestAccounts",
          "eth_sendTransaction",
          "personal_sign",
          "eth_signTypedData",
          "eth_signTypedData_v3",
          "eth_signTypedData_v4",
          "wallet_switchEthereumChain",
          "wallet_addEthereumChain",
        ],
        optionalEvents: ["accountsChanged", "chainChanged", "disconnect", "connect"],
        rpcMap: {
          [MONAD_CHAIN_ID]: MONAD_RPC_URL,
        },
        showQrModal: true,
        metadata: {
          name: "D.Y.O.O.R",
          description: "Connect the wallet that holds your D.Y.O.O.R.",
          url: origin,
          icons: [`${origin}/dyoor-world-icon.svg`],
        },
        qrModalOptions: {
          themeMode: "dark",
          enableExplorer: true,
          enableMobileFullScreen: true,
          themeVariables: {
            "--wcm-z-index": "350",
            "--wcm-accent-color": "#39ffe2",
            "--wcm-accent-fill-color": "#02040d",
            "--wcm-background-color": "#060817",
          },
        },
      }) as unknown as WalletConnectProvider;
    })
    .catch((error) => {
      walletConnectProviderPromise = null;
      throw error;
    });

  return walletConnectProviderPromise;
}

async function switchProviderToMonad(provider: Eip1193Provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MONAD_CHAIN_HEX }],
    });
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
}

function useWalletConnectWallet(projectId: string) {
  const providerRef = useRef<WalletConnectProvider | null>(null);
  const [address, setAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [providerName, setProviderName] = useState("WalletConnect");
  const [ready, setReady] = useState(!projectId);
  const [wrongNetwork, setWrongNetwork] = useState(false);

  const syncProvider = useCallback(async (provider: WalletConnectProvider, accounts?: string[]) => {
    const nextAccounts = accounts || provider.accounts || await provider.request({
      method: "eth_accounts",
    }).catch(() => []) as string[];
    const nextAddress = normalizeAddress(nextAccounts?.[0]);
    setAddress(nextAddress);
    setProviderName(provider.session?.peer?.metadata?.name || "WalletConnect");
    if (!nextAddress) {
      setWrongNetwork(false);
      return;
    }
    const chainId = await provider.request({ method: "eth_chainId" }).catch(() => MONAD_CHAIN_HEX);
    setWrongNetwork(String(chainId || "").toLowerCase() !== MONAD_CHAIN_HEX);
  }, []);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let active = true;
    let connectedProvider: WalletConnectProvider | null = null;
    const onAccounts = (accounts: string[]) => void syncProvider(connectedProvider!, accounts);
    const onChain = () => void syncProvider(connectedProvider!);
    const onDisconnect = () => {
      setAddress("");
      setWrongNetwork(false);
      setProviderName("WalletConnect");
    };

    void createWalletConnectProvider(projectId)
      .then((provider) => {
        if (!active) return;
        connectedProvider = provider;
        providerRef.current = provider;
        provider.on("accountsChanged", onAccounts);
        provider.on("chainChanged", onChain);
        provider.on("connect", onChain);
        provider.on("disconnect", onDisconnect);
        provider.on("session_delete", onDisconnect);
        if (provider.session) void syncProvider(provider);
      })
      .catch((initializationError) => {
        if (active) setError(walletConnectionError(initializationError));
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
      if (!connectedProvider) return;
      connectedProvider.removeListener("accountsChanged", onAccounts);
      connectedProvider.removeListener("chainChanged", onChain);
      connectedProvider.removeListener("connect", onChain);
      connectedProvider.removeListener("disconnect", onDisconnect);
      connectedProvider.removeListener("session_delete", onDisconnect);
    };
  }, [projectId, syncProvider]);

  const getProvider = useCallback(async () => {
    if (!projectId) {
      throw new Error("WalletConnect is not configured for this deployment.");
    }
    const provider = providerRef.current || await createWalletConnectProvider(projectId);
    providerRef.current = provider;
    setReady(true);
    return provider;
  }, [projectId]);

  const switchChain = useCallback(async () => {
    const provider = await getProvider();
    await switchProviderToMonad(provider);
    await syncProvider(provider);
  }, [getProvider, syncProvider]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      const provider = await getProvider();
      const accounts = await provider.enable();
      await syncProvider(provider, accounts);
      const chainId = await provider.request({ method: "eth_chainId" }).catch(() => MONAD_CHAIN_HEX);
      if (String(chainId || "").toLowerCase() !== MONAD_CHAIN_HEX) {
        await switchProviderToMonad(provider);
        await syncProvider(provider);
      }
    } catch (connectionError) {
      const message = walletConnectionError(connectionError);
      setError(message);
      throw new Error(message);
    } finally {
      setConnecting(false);
    }
  }, [getProvider, syncProvider]);

  const disconnect = useCallback(async () => {
    setError("");
    setWrongNetwork(false);
    setAddress("");
    const provider = providerRef.current;
    if (provider?.session) {
      await provider.disconnect().catch(() => undefined);
    }
  }, []);

  return useMemo(() => ({
    address,
    connect,
    connecting,
    disconnect,
    error,
    getProvider,
    providerName,
    ready,
    switchChain,
    wrongNetwork,
  }), [address, connect, connecting, disconnect, error, getProvider, providerName, ready, switchChain, wrongNetwork]);
}

function UniversalWalletServiceProvider({
  children,
  walletConnectProjectId,
}: {
  children: ReactNode;
  walletConnectProjectId: string;
}) {
  const injected = useInjectedWallet();
  const walletConnect = useWalletConnectWallet(walletConnectProjectId);
  const address = injected.address || walletConnect.address;
  const source: WalletSource = injected.address
    ? "browser"
    : walletConnect.address
      ? "walletconnect"
      : "none";
  const ready = Boolean(injected.providerName) || walletConnect.ready;
  const connecting = injected.status === "connecting" || walletConnect.connecting;
  const error = injected.error || walletConnect.error;
  const wrongNetwork = source === "browser" ? injected.status === "wrong-network" : walletConnect.wrongNetwork;

  const connect = useCallback(async () => {
    if (injectedProvider()) {
      await injected.connect();
      return;
    }
    await walletConnect.connect();
  }, [injected, walletConnect]);

  const disconnect = useCallback(async () => {
    if (source === "browser") {
      await injected.disconnect();
      return;
    }
    await walletConnect.disconnect();
  }, [injected, source, walletConnect]);

  const getProvider = useCallback(async () => {
    if (source === "browser" || (!walletConnect.address && injectedProvider())) {
      return await injected.getProvider();
    }
    return await walletConnect.getProvider();
  }, [injected, source, walletConnect]);

  const getAddress = useCallback(async () => {
    if (address) return address;
    if (injectedProvider()) return await injected.getAddress();
    const provider = await walletConnect.getProvider();
    const accounts = await provider.request({ method: "eth_accounts" }) as string[];
    const nextAddress = normalizeAddress(accounts?.[0]);
    if (!nextAddress) throw new Error("Wallet is not connected.");
    return nextAddress;
  }, [address, injected, walletConnect]);

  const switchChain = useCallback(async () => {
    if (source === "browser" || (!walletConnect.address && injectedProvider())) {
      await injected.switchChain();
      return;
    }
    await walletConnect.switchChain();
  }, [injected, source, walletConnect]);

  const service = useMemo<WalletService>(() => ({
    address,
    connected: Boolean(address),
    error,
    providerName: source === "browser"
      ? injected.providerName
      : source === "walletconnect"
        ? walletConnect.providerName
        : injected.providerName || "WalletConnect",
    ready,
    source,
    status: !ready
      ? "loading"
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
    ready,
    source,
    switchChain,
    walletConnect.providerName,
    wrongNetwork,
  ]);

  return <WalletServiceContext.Provider value={service}>{children}</WalletServiceContext.Provider>;
}

export function WalletServiceProvider({
  children,
  walletConnectProjectId,
}: {
  children: ReactNode;
  walletConnectProjectId: string;
}) {
  return (
    <UniversalWalletServiceProvider walletConnectProjectId={walletConnectProjectId}>
      {children}
    </UniversalWalletServiceProvider>
  );
}

export function useWalletService() {
  return useContext(WalletServiceContext);
}

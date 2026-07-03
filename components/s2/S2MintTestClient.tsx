"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { dyoorSeason2SeaDropAbi } from "@/lib/contracts/abis";
import { dyoorS2Contract } from "@/lib/contracts/addresses";
import { useWalletService } from "@/providers/WalletServiceProvider";
import { Alert, Button, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";

type MintMode = "active" | "team" | "whitelist" | "gtd" | "public";
type LoadState = "idle" | "loading" | "success" | "error";

type PhaseConfig = {
  startTime: bigint;
  price: bigint;
  walletLimit: number;
  merkleRoot: string;
};

type OwnedToken = {
  tokenId: string;
  tokenURI: string;
  image: string;
  name: string;
  attributes: Array<{ trait_type?: string; value?: string | number }>;
  metadataStatus: "loaded" | "unavailable";
};

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const PHASE_LABELS = ["Not Started", "Team", "Whitelist", "GTD", "Public"] as const;
const MINT_MODES: Array<{ value: MintMode; label: string; proof: boolean }> = [
  { value: "active", label: "Active Phase", proof: true },
  { value: "team", label: "Team", proof: true },
  { value: "whitelist", label: "Whitelist", proof: true },
  { value: "gtd", label: "GTD", proof: true },
  { value: "public", label: "Public", proof: false },
];

const S2_CHAIN_ID = Number(process.env.NEXT_PUBLIC_DYOOR_S2_CHAIN_ID || process.env.NEXT_PUBLIC_MONAD_TESTNET_CHAIN_ID || "10143");
const S2_CHAIN_HEX = `0x${Math.max(1, S2_CHAIN_ID || 10143).toString(16)}`;
const S2_CHAIN_NAME = process.env.NEXT_PUBLIC_DYOOR_S2_CHAIN_NAME || "Monad Testnet";
const S2_RPC_URL = process.env.NEXT_PUBLIC_DYOOR_S2_RPC_URL || process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
const S2_EXPLORER_URL = (process.env.NEXT_PUBLIC_DYOOR_S2_EXPLORER_URL || "https://testnet.monadscan.com").replace(/\/$/, "");
const S2_START_BLOCK = BigInt(Math.max(0, Number(process.env.NEXT_PUBLIC_DYOOR_S2_START_BLOCK || "0") || 0));
const S2_LOG_CHUNK_SIZE = BigInt(Math.min(100, Math.max(1, Number(process.env.NEXT_PUBLIC_DYOOR_S2_LOG_CHUNK_SIZE || "100") || 100)));
const NFT_LOG_REQUEST_DELAY_MS = 60;
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

const s2Chain = defineChain({
  id: Math.max(1, S2_CHAIN_ID || 10143),
  name: S2_CHAIN_NAME,
  nativeCurrency: { decimals: 18, name: "MON", symbol: "MON" },
  rpcUrls: {
    default: { http: [S2_RPC_URL] },
    public: { http: [S2_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Monadscan", url: S2_EXPLORER_URL },
  },
});

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "-";
}

function formatMon(value: bigint) {
  return formatEther(value).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function toHex(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex;
}

function normalizeUri(uri: string) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

function walletLeaf(address: string) {
  return isAddress(address) ? keccak256(`0x${getAddress(address).slice(2).toLowerCase()}` as Hex) : "";
}

function parseProof(value: string): Hex[] {
  const raw = value.trim();
  if (!raw) return [];

  let entries: string[];
  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Merkle proof JSON must be an array of bytes32 strings.");
    entries = parsed.map((entry) => String(entry));
  } else {
    entries = raw.split(/[\s,]+/);
  }

  const proof = entries.map((entry) => entry.trim()).filter(Boolean);
  const invalid = proof.find((entry) => !/^0x[a-fA-F0-9]{64}$/.test(entry));
  if (invalid) throw new Error(`Invalid proof entry: ${invalid}`);
  return proof as Hex[];
}

function normalizePhaseConfig(raw: unknown): PhaseConfig {
  const item = raw as Record<string, unknown> & { [index: number]: unknown };
  return {
    startTime: BigInt(String(item.startTime ?? item[0] ?? 0)),
    price: BigInt(String(item.price ?? item[1] ?? 0)),
    walletLimit: Number(item.walletLimit ?? item[2] ?? 0),
    merkleRoot: String(item.merkleRoot ?? item[3] ?? ZERO_HASH),
  };
}

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/user rejected|user denied|rejected request|denied transaction/i.test(message)) return "Transaction rejected in wallet.";
  if (/requests limited|rate limit|too many requests/i.test(message)) return "Monad testnet RPC rate limit hit. Wait a moment and refresh NFTs.";
  if (/insufficient funds/i.test(message)) return "Insufficient MON for mint price or gas.";
  if (/allowlist|proof|Merkle/i.test(message)) return "Allowlist proof rejected for this wallet.";
  if (/walletlimit|wallet limit/i.test(message)) return "Wallet mint limit reached.";
  if (/mintinactive|inactive/i.test(message)) return "Selected mint phase is not active.";
  if (/incorrectpayment|payment/i.test(message)) return "Mint payment did not match contract price.";
  if (/maxsupply|supply/i.test(message)) return "Mint would exceed remaining supply.";
  if (/network|chain/i.test(message)) return "Wrong network. Switch to Monad testnet.";
  return message || "Mint test failed.";
}

function selectedPhaseId(mode: MintMode, activePhase: number) {
  if (mode === "team") return 1;
  if (mode === "whitelist") return 2;
  if (mode === "gtd") return 3;
  if (mode === "public") return 4;
  return activePhase;
}

function mintFunctionForMode(mode: MintMode) {
  if (mode === "team") return "teamMint";
  if (mode === "whitelist") return "whitelistMint";
  if (mode === "gtd") return "gtdMint";
  if (mode === "public") return "publicMint";
  return "mintDirect";
}

async function fetchMetadata(uri: string): Promise<Omit<OwnedToken, "tokenId" | "tokenURI">> {
  const url = normalizeUri(uri);
  if (!url) throw new Error("Missing token URI.");
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
  const json = await response.json() as {
    name?: string;
    image?: string;
    image_url?: string;
    attributes?: Array<{ trait_type?: string; value?: string | number }>;
  };

  return {
    image: normalizeUri(json.image || json.image_url || ""),
    name: json.name || "D.Y.O.O.R",
    attributes: Array.isArray(json.attributes) ? json.attributes : [],
    metadataStatus: "loaded",
  };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function S2MintTestClient() {
  const wallet = useWalletService();
  const contractAddress = dyoorS2Contract || "";
  const [currentChainId, setCurrentChainId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [mintMode, setMintMode] = useState<MintMode>("active");
  const [proofText, setProofText] = useState("");
  const [activePhase, setActivePhase] = useState(0);
  const [phaseConfigs, setPhaseConfigs] = useState<Record<number, PhaseConfig>>({});
  const [totalMinted, setTotalMinted] = useState<bigint>(0n);
  const [maxSupply, setMaxSupply] = useState<bigint>(0n);
  const [walletMinted, setWalletMinted] = useState<bigint>(0n);
  const [walletBalance, setWalletBalance] = useState<bigint>(0n);
  const [readState, setReadState] = useState<LoadState>("idle");
  const [nftState, setNftState] = useState<LoadState>("idle");
  const [mintState, setMintState] = useState<LoadState>("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [ownedTokens, setOwnedTokens] = useState<OwnedToken[]>([]);
  const readRequest = useRef(0);
  const nftRequest = useRef(0);

  const publicClient = useMemo(() => createPublicClient({
    chain: s2Chain,
    transport: http(S2_RPC_URL),
  }), []);

  const normalizedWallet = useMemo(() => {
    try {
      return wallet.address ? getAddress(wallet.address) : "";
    } catch {
      return "";
    }
  }, [wallet.address]);

  const selectedPhase = selectedPhaseId(mintMode, activePhase);
  const selectedConfig = phaseConfigs[selectedPhase];
  const selectedMode = MINT_MODES.find((mode) => mode.value === mintMode) || MINT_MODES[0];
  const mintValue = (selectedConfig?.price || 0n) * BigInt(quantity);
  const remainingSupply = maxSupply > totalMinted ? maxSupply - totalMinted : 0n;
  const wrongNetwork = Boolean(wallet.connected && currentChainId && currentChainId.toLowerCase() !== S2_CHAIN_HEX);
  const mintButtonDisabled = Boolean(
    !contractAddress
      || selectedPhase === 0
      || quantity <= 0
      || remainingSupply < BigInt(quantity)
      || mintState === "loading",
  );
  const mintButtonLabel = mintState === "loading"
    ? "Minting"
    : !wallet.connected
      ? "Connect Wallet"
      : wrongNetwork
        ? "Switch Network"
        : selectedPhase === 0
          ? "Mint Inactive"
          : "Mint Test NFT";
  const txUrl = txHash ? `${S2_EXPLORER_URL}/tx/${txHash}` : "";
  const leaf = normalizedWallet ? walletLeaf(normalizedWallet) : "";

  const refreshChain = useCallback(async () => {
    if (!wallet.connected) {
      setCurrentChainId("");
      return "";
    }
    try {
      const provider = await wallet.getProvider();
      const chainId = String(await provider.request({ method: "eth_chainId" }) || "");
      setCurrentChainId(chainId);
      return chainId;
    } catch {
      setCurrentChainId("");
      return "";
    }
  }, [wallet]);

  const switchToTestnet = useCallback(async () => {
    const provider = await wallet.getProvider();
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: S2_CHAIN_HEX }] });
    } catch {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: S2_CHAIN_HEX,
          chainName: S2_CHAIN_NAME,
          rpcUrls: [S2_RPC_URL],
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          blockExplorerUrls: [S2_EXPLORER_URL],
        }],
      });
    }
    await refreshChain();
  }, [refreshChain, wallet]);

  const connectWallet = useCallback(async () => {
    setError("");
    await wallet.connect();
    await switchToTestnet().catch(() => undefined);
  }, [switchToTestnet, wallet]);

  const refreshReads = useCallback(async () => {
    const requestId = ++readRequest.current;
    if (!contractAddress) {
      setReadState("error");
      setError("Set NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS to enable this test page.");
      return;
    }

    setReadState("loading");
    setError("");
    try {
      const [
        nextActivePhase,
        nextTotalMinted,
        nextMaxSupply,
        team,
        whitelist,
        gtd,
        publicPhase,
        nextWalletMinted,
        nextWalletBalance,
      ] = await Promise.all([
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "activePhase" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "totalMinted" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "MAX_SUPPLY" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "phaseConfig", args: [1] }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "phaseConfig", args: [2] }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "phaseConfig", args: [3] }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "phaseConfig", args: [4] }),
        normalizedWallet
          ? publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "numberMinted", args: [normalizedWallet as Address] })
          : Promise.resolve(0n),
        normalizedWallet
          ? publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "balanceOf", args: [normalizedWallet as Address] })
          : Promise.resolve(0n),
      ]);

      if (requestId !== readRequest.current) return;
      setActivePhase(Number(nextActivePhase));
      setTotalMinted(BigInt(nextTotalMinted));
      setMaxSupply(BigInt(nextMaxSupply));
      setPhaseConfigs({
        1: normalizePhaseConfig(team),
        2: normalizePhaseConfig(whitelist),
        3: normalizePhaseConfig(gtd),
        4: normalizePhaseConfig(publicPhase),
      });
      setWalletMinted(BigInt(nextWalletMinted));
      setWalletBalance(BigInt(nextWalletBalance));
      setReadState("success");
    } catch (err) {
      if (requestId !== readRequest.current) return;
      setReadState("error");
      setError(normalizeError(err));
    }
  }, [contractAddress, normalizedWallet, publicClient]);

  const refreshOwnedTokens = useCallback(async () => {
    const requestId = ++nftRequest.current;
    if (!contractAddress || !normalizedWallet) {
      setOwnedTokens([]);
      setNftState("idle");
      return;
    }

    setNftState("loading");
    try {
      const nextWalletBalance = await publicClient.readContract({
        address: contractAddress as Address,
        abi: dyoorSeason2SeaDropAbi,
        functionName: "balanceOf",
        args: [normalizedWallet as Address],
      });
      if (requestId !== nftRequest.current) return;
      if (BigInt(nextWalletBalance) === 0n) {
        setOwnedTokens([]);
        setNftState("success");
        return;
      }

      const latest = await publicClient.getBlockNumber();
      const changes: Array<{ tokenId: bigint; owns: boolean; blockNumber: bigint; logIndex: number }> = [];

      for (let fromBlock = S2_START_BLOCK; fromBlock <= latest;) {
        const toBlock = fromBlock + S2_LOG_CHUNK_SIZE - 1n > latest ? latest : fromBlock + S2_LOG_CHUNK_SIZE - 1n;
        const incoming = await publicClient.getLogs({
          address: contractAddress as Address,
          event: TRANSFER_EVENT,
          args: { to: normalizedWallet as Address },
          fromBlock,
          toBlock,
        });
        await delay(NFT_LOG_REQUEST_DELAY_MS);
        if (requestId !== nftRequest.current) return;

        const outgoing = await publicClient.getLogs({
          address: contractAddress as Address,
          event: TRANSFER_EVENT,
          args: { from: normalizedWallet as Address },
          fromBlock,
          toBlock,
        });
        await delay(NFT_LOG_REQUEST_DELAY_MS);
        if (requestId !== nftRequest.current) return;

        for (const log of incoming) {
          if (log.args.tokenId !== undefined) {
            changes.push({ tokenId: log.args.tokenId, owns: true, blockNumber: log.blockNumber || 0n, logIndex: log.logIndex || 0 });
          }
        }
        for (const log of outgoing) {
          if (log.args.tokenId !== undefined) {
            changes.push({ tokenId: log.args.tokenId, owns: false, blockNumber: log.blockNumber || 0n, logIndex: log.logIndex || 0 });
          }
        }
        fromBlock = toBlock + 1n;
      }

      changes.sort((a, b) => {
        if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex;
        return a.blockNumber < b.blockNumber ? -1 : 1;
      });

      const tokenIds = new Set<bigint>();
      for (const change of changes) {
        if (change.owns) tokenIds.add(change.tokenId);
        else tokenIds.delete(change.tokenId);
      }

      const previewIds = Array.from(tokenIds).sort((a, b) => a < b ? -1 : 1).slice(0, 24);
      const tokens = await Promise.all(previewIds.map(async (tokenId) => {
        let tokenURI = "";
        try {
          tokenURI = await publicClient.readContract({
            address: contractAddress as Address,
            abi: dyoorSeason2SeaDropAbi,
            functionName: "tokenURI",
            args: [tokenId],
          });
        } catch {}

        try {
          const metadata = await fetchMetadata(tokenURI);
          return {
            tokenId: tokenId.toString(),
            tokenURI,
            ...metadata,
          };
        } catch {
          return {
            tokenId: tokenId.toString(),
            tokenURI,
            image: "",
            name: `D.Y.O.O.R #${tokenId.toString()}`,
            attributes: [],
            metadataStatus: "unavailable" as const,
          };
        }
      }));

      if (requestId !== nftRequest.current) return;
      setOwnedTokens(tokens);
      setNftState("success");
    } catch (err) {
      if (requestId !== nftRequest.current) return;
      setNftState("error");
      setError(normalizeError(err));
    }
  }, [contractAddress, normalizedWallet, publicClient]);

  const refreshAll = useCallback(async () => {
    await refreshChain();
    await refreshReads();
    await refreshOwnedTokens();
  }, [refreshChain, refreshOwnedTokens, refreshReads]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refreshChain(), 0);
    const refreshTimer = window.setInterval(() => void refreshChain(), 5000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
    };
  }, [refreshChain]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshReads(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshReads]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshOwnedTokens(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshOwnedTokens]);

  async function submitMint() {
    if (!contractAddress) {
      setError("Set NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS before testing mints.");
      return;
    }
    if (!wallet.connected) {
      await connectWallet();
      return;
    }
    if (wrongNetwork) {
      await switchToTestnet();
      return;
    }

    setMintState("loading");
    setError("");
    setStatus("Preparing mint transaction.");
    setTxHash("");

    try {
      const functionName = mintFunctionForMode(mintMode);
      const proof = functionName === "publicMint" ? [] : parseProof(proofText);
      const data = functionName === "publicMint"
        ? encodeFunctionData({ abi: dyoorSeason2SeaDropAbi, functionName, args: [BigInt(quantity)] })
        : encodeFunctionData({ abi: dyoorSeason2SeaDropAbi, functionName, args: [BigInt(quantity), proof] });

      const hash = await wallet.sendTransaction({
        from: normalizedWallet,
        to: contractAddress,
        data,
        value: toHex(mintValue),
      });

      setTxHash(hash);
      setStatus("Mint submitted. Waiting for confirmation.");
      await publicClient.waitForTransactionReceipt({ hash: hash as Hex, confirmations: 1 });
      setMintState("success");
      setStatus("Mint confirmed.");
      await refreshAll();
    } catch (err) {
      setMintState("error");
      setStatus("");
      setError(normalizeError(err));
    }
  }

  const statusTone = mintState === "loading" || readState === "loading"
    ? "busy"
    : error
      ? "danger"
      : mintState === "success"
        ? "success"
        : wrongNetwork
          ? "warning"
          : "idle";

  return (
    <PageShell size="wide" className="space-y-7">
      <section className="overflow-hidden rounded border border-dyoor-cyan/25 bg-white shadow-[0_22px_70px_rgba(57,255,226,.12)]">
        <Image
          src="/assets/dyoor-s2-mint-banner.png"
          alt="D.Y.O.O.R Season 2 mints July 15 on OpenSea"
          width={1983}
          height={793}
          priority
          sizes="(max-width: 768px) 100vw, 90rem"
          className="h-auto w-full"
        />
      </section>

      <SectionHeader
        eyebrow="Internal Test Route"
        title="Season 2 Mint Test"
        copy="Hidden test console for dyoor.xyz direct mints on Monad testnet."
        actions={(
          <div className="flex flex-wrap gap-3">
            {!wallet.connected ? (
              <Button variant="primary" onClick={() => void connectWallet()} disabled={wallet.status === "connecting"}>
                {wallet.status === "connecting" ? "Connecting" : "Connect Wallet"}
              </Button>
            ) : wrongNetwork ? (
              <Button variant="primary" onClick={() => void switchToTestnet()}>
                Switch Network
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void wallet.disconnect()}>
                Disconnect
              </Button>
            )}
            <Button variant="secondary" onClick={() => void refreshAll()} disabled={readState === "loading" || nftState === "loading"}>
              Refresh
            </Button>
          </div>
        )}
      />

      <Alert tone={statusTone}>
        {error || status || (contractAddress ? `Connected to ${S2_CHAIN_NAME} contract ${shortAddress(contractAddress)}.` : "S2 contract address is not configured.")}
        {txUrl ? (
          <a className="ml-2 underline decoration-dyoor-cyan/60 underline-offset-4" href={txUrl} target="_blank" rel="noreferrer">
            View tx
          </a>
        ) : null}
      </Alert>

      {wrongNetwork ? (
        <Alert tone="warning">
          Wallet is on chain {currentChainId || "unknown"}. This page is configured for {S2_CHAIN_NAME} ({S2_CHAIN_HEX}).
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Active Phase" value={PHASE_LABELS[activePhase as 0 | 1 | 2 | 3 | 4] || `Phase ${activePhase}`} />
        <StatCard label="Mint Price" value={`${formatMon(selectedConfig?.price || 0n)} MON`} />
        <StatCard label="Wallet Minted" value={wallet.connected ? walletMinted.toString() : "-"} />
        <StatCard label="Total Minted" value={totalMinted.toString()} />
        <StatCard label="Remaining" value={maxSupply ? remainingSupply.toString() : "-"} />
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="glass-panel p-5">
          <div className="flex flex-col gap-1">
            <p className="eyebrow">Mint Console</p>
            <h2 className="text-2xl font-black uppercase text-white">Direct Contract Mint</h2>
            <p className="text-sm font-semibold leading-6 text-white/58">Tests the dyoor.xyz path. SeaDrop/OpenSea should be tested separately through OpenSea Primary Drops.</p>
          </div>

          <div className="mt-5 grid gap-4">
            <label className="grid gap-2">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Mint Path</span>
              <select
                className="rounded border border-dyoor-purple/35 bg-black/45 px-4 py-3 text-sm font-black uppercase text-white outline-none transition focus:border-dyoor-cyan"
                value={mintMode}
                onChange={(event) => setMintMode(event.target.value as MintMode)}
              >
                {MINT_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Quantity</span>
              <input
                className="rounded border border-dyoor-purple/35 bg-black/45 px-4 py-3 text-sm font-black text-white outline-none transition focus:border-dyoor-cyan"
                min={1}
                max={25}
                type="number"
                value={quantity}
                onChange={(event) => setQuantity(Math.max(1, Math.min(25, Number(event.target.value) || 1)))}
              />
            </label>

            {selectedMode.proof ? (
              <label className="grid gap-2">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Merkle Proof</span>
                <textarea
                  className="min-h-28 rounded border border-dyoor-purple/35 bg-black/45 px-4 py-3 font-mono text-xs text-white outline-none transition focus:border-dyoor-cyan"
                  placeholder="0x... one per line, comma separated, or JSON array"
                  value={proofText}
                  onChange={(event) => setProofText(event.target.value)}
                />
              </label>
            ) : null}

            <div className="grid gap-2 rounded border border-white/12 bg-white/[0.035] p-4 text-sm font-semibold text-white/66">
              <p>Wallet: <span className="text-white">{wallet.connected ? shortAddress(normalizedWallet) : "Not connected"}</span></p>
              <p>Wallet leaf: <span className="break-all font-mono text-dyoor-cyan">{leaf || "-"}</span></p>
              <p>Selected phase limit: <span className="text-white">{selectedConfig?.walletLimit ? selectedConfig.walletLimit : "Unlimited"}</span></p>
              <p>Total price: <span className="text-dyoor-cyan">{formatMon(mintValue)} MON</span></p>
              <p>Wallet balance in contract: <span className="text-white">{wallet.connected ? walletBalance.toString() : "-"}</span></p>
            </div>

            <Button variant="primary" onClick={() => void submitMint()} disabled={mintButtonDisabled}>
              {mintButtonLabel}
            </Button>
          </div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="eyebrow">NFT Preview</p>
              <h2 className="text-2xl font-black uppercase text-white">Minted In Wallet</h2>
            </div>
            <Button variant="secondary" onClick={() => void refreshOwnedTokens()} disabled={!wallet.connected || nftState === "loading"}>
              Refresh NFTs
            </Button>
          </div>

          {nftState === "loading" ? (
            <LoadingSkeleton lines={6} className="mt-5" />
          ) : !wallet.connected ? (
            <EmptyState className="mt-5" title="Connect Wallet" copy="Connect a wallet to load Season 2 tokens minted to that address." />
          ) : ownedTokens.length === 0 ? (
            <EmptyState className="mt-5" title="No Tokens Found" copy="No Season 2 tokens were found for this wallet in the configured log range." />
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {ownedTokens.map((token) => (
                <article key={token.tokenId} className="overflow-hidden rounded border border-dyoor-purple/25 bg-black/35">
                  <div className="aspect-square bg-black/45">
                    {token.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="h-full w-full object-cover" src={token.image} alt={token.name} />
                    ) : (
                      <div className="grid h-full place-items-center text-xs font-black uppercase tracking-[0.18em] text-white/35">No Image</div>
                    )}
                  </div>
                  <div className="space-y-3 p-4">
                    <div>
                      <p className="text-lg font-black text-white">{token.name}</p>
                      <p className="text-sm font-bold text-white/45">#{token.tokenId}</p>
                    </div>
                    {token.metadataStatus === "unavailable" ? (
                      <p className="break-all text-xs font-semibold text-yellow-100/80">Metadata unavailable from tokenURI.</p>
                    ) : (
                      <div className="grid gap-2">
                        {token.attributes.slice(0, 6).map((attribute, index) => (
                          <p key={`${token.tokenId}-${attribute.trait_type || index}`} className="text-xs font-semibold text-white/58">
                            <span className="uppercase tracking-[0.14em] text-white/35">{attribute.trait_type || "Trait"}:</span>{" "}
                            <span className="text-white">{String(attribute.value ?? "None")}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </PageShell>
  );
}

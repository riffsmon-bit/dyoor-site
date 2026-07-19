"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  parseAbiItem,
  type Address,
} from "viem";
import { Alert, Button, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { dyoorSeason2SeaDropAbi } from "@/lib/contracts/abis";
import { dyoorS2Contract } from "@/lib/contracts/addresses";
import { useWalletService } from "@/providers/WalletServiceProvider";

type LoadState = "idle" | "loading" | "success" | "error";

type OwnedToken = {
  tokenId: string;
  tokenURI: string;
  image: string;
  name: string;
  attributes: Array<{ trait_type?: string; value?: string | number }>;
  metadataStatus: "loaded" | "unavailable";
};

const S2_CHAIN_ID = 143;
const S2_CHAIN_HEX = "0x8f";
const S2_CHAIN_NAME = process.env.NEXT_PUBLIC_DYOOR_S2_CHAIN_NAME || "Monad";
const S2_RPC_URL = process.env.NEXT_PUBLIC_DYOOR_S2_RPC_URL || process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://rpc.monad.xyz";
const S2_EXPLORER_URL = (process.env.NEXT_PUBLIC_DYOOR_S2_EXPLORER_URL || "https://monadscan.com").replace(/\/$/, "");
const S2_OPENSEA_URL = process.env.NEXT_PUBLIC_DYOOR_S2_OPENSEA_URL || "";
const S2_START_BLOCK = BigInt(Math.max(0, Number(process.env.NEXT_PUBLIC_DYOOR_S2_START_BLOCK || "0") || 0));
const S2_LOG_CHUNK_SIZE = BigInt(Math.min(100, Math.max(1, Number(process.env.NEXT_PUBLIC_DYOOR_S2_LOG_CHUNK_SIZE || "100") || 100)));
const NFT_OWNER_SCAN_LIMIT = 250n;
const NFT_OWNER_REQUEST_DELAY_MS = 45;
const NFT_LOG_REQUEST_DELAY_MS = 60;
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

const s2Chain = defineChain({
  id: S2_CHAIN_ID,
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

function normalizeUri(uri: string) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/user rejected|user denied|rejected request|denied transaction/i.test(message)) return "Request rejected in wallet.";
  if (/requests limited|rate limit|too many requests/i.test(message)) return "Monad RPC rate limit hit. Wait a moment and refresh.";
  if (/network|chain/i.test(message)) return "Wrong network. Switch to Monad.";
  return message || "Season 2 status failed.";
}

async function fetchMetadata(uri: string): Promise<Omit<OwnedToken, "tokenId" | "tokenURI">> {
  const url = normalizeUri(uri);
  if (!url) throw new Error("Missing token URI.");
  let response = await fetch(url, { cache: "no-cache" });
  if (!response.ok && !/\.[a-z0-9]+$/i.test(url)) {
    response = await fetch(`${url}.json`, { cache: "no-cache" });
  }
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
  const [totalMinted, setTotalMinted] = useState<bigint>(0n);
  const [totalSupply, setTotalSupply] = useState<bigint>(0n);
  const [maxSupply, setMaxSupply] = useState<bigint>(3333n);
  const [airdropReserve, setAirdropReserve] = useState<bigint>(610n);
  const [seaDropCap, setSeaDropCap] = useState<bigint>(2723n);
  const [totalSeaDropMinted, setTotalSeaDropMinted] = useState<bigint>(0n);
  const [totalAirdropped, setTotalAirdropped] = useState<bigint>(0n);
  const [walletMinted, setWalletMinted] = useState<bigint>(0n);
  const [walletBalance, setWalletBalance] = useState<bigint>(0n);
  const [mintPaused, setMintPaused] = useState(false);
  const [airdropPaused, setAirdropPaused] = useState(false);
  const [allowedSeaDrops, setAllowedSeaDrops] = useState<readonly Address[]>([]);
  const [readState, setReadState] = useState<LoadState>("idle");
  const [nftState, setNftState] = useState<LoadState>("idle");
  const [status, setStatus] = useState("OpenSea Drop configuration pending");
  const [error, setError] = useState("");
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

  const wrongNetwork = Boolean(wallet.connected && currentChainId && currentChainId.toLowerCase() !== S2_CHAIN_HEX);
  const remainingSupply = maxSupply > totalMinted ? maxSupply - totalMinted : 0n;
  const remainingSeaDropSupply = seaDropCap > totalSeaDropMinted ? seaDropCap - totalSeaDropMinted : 0n;
  const remainingAirdropReserve = airdropReserve > totalAirdropped ? airdropReserve - totalAirdropped : 0n;
  const openSeaReady = Boolean(S2_OPENSEA_URL);

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

  const switchToMonad = useCallback(async () => {
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
    await switchToMonad().catch(() => undefined);
  }, [switchToMonad, wallet]);

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
        nextMaxSupply,
        nextAirdropReserve,
        nextSeaDropCap,
        nextTotalMinted,
        nextTotalSupply,
        nextTotalSeaDropMinted,
        nextTotalAirdropped,
        nextPaused,
        nextAirdropPaused,
        nextAllowedSeaDrops,
        nextWalletMinted,
        nextWalletBalance,
      ] = await Promise.all([
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "MAX_SUPPLY" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "AIRDROP_RESERVE" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "SEADROP_MAX_SUPPLY" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "totalMinted" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "totalSupply" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "totalSeaDropMinted" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "totalAirdropped" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "paused" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "airdropPaused" }),
        publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "allowedSeaDrops" }),
        normalizedWallet
          ? publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "numberMinted", args: [normalizedWallet as Address] })
          : Promise.resolve(0n),
        normalizedWallet
          ? publicClient.readContract({ address: contractAddress as Address, abi: dyoorSeason2SeaDropAbi, functionName: "balanceOf", args: [normalizedWallet as Address] })
          : Promise.resolve(0n),
      ]);

      if (requestId !== readRequest.current) return;
      setMaxSupply(BigInt(nextMaxSupply));
      setAirdropReserve(BigInt(nextAirdropReserve));
      setSeaDropCap(BigInt(nextSeaDropCap));
      setTotalMinted(BigInt(nextTotalMinted));
      setTotalSupply(BigInt(nextTotalSupply));
      setTotalSeaDropMinted(BigInt(nextTotalSeaDropMinted));
      setTotalAirdropped(BigInt(nextTotalAirdropped));
      setMintPaused(Boolean(nextPaused));
      setAirdropPaused(Boolean(nextAirdropPaused));
      setAllowedSeaDrops(nextAllowedSeaDrops);
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

      const tokenIds = new Set<bigint>();
      const nextTotalSupply = await publicClient.readContract({
        address: contractAddress as Address,
        abi: dyoorSeason2SeaDropAbi,
        functionName: "totalSupply",
      });
      if (requestId !== nftRequest.current) return;

      if (BigInt(nextTotalSupply) <= NFT_OWNER_SCAN_LIMIT) {
        const targetCount = Math.min(Number(nextWalletBalance), 24);
        for (let tokenId = 1n; tokenId <= BigInt(nextTotalSupply); tokenId += 1n) {
          const owner = await publicClient.readContract({
            address: contractAddress as Address,
            abi: dyoorSeason2SeaDropAbi,
            functionName: "ownerOf",
            args: [tokenId],
          });
          if (String(owner).toLowerCase() === normalizedWallet.toLowerCase()) {
            tokenIds.add(tokenId);
            if (tokenIds.size >= targetCount) break;
          }
          await delay(NFT_OWNER_REQUEST_DELAY_MS);
          if (requestId !== nftRequest.current) return;
        }
      } else {
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

        for (const change of changes) {
          if (change.owns) tokenIds.add(change.tokenId);
          else tokenIds.delete(change.tokenId);
        }
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
          return { tokenId: tokenId.toString(), tokenURI, ...metadata };
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

  function openOpenSea() {
    if (!S2_OPENSEA_URL) {
      setStatus("OpenSea Drop configuration pending");
      return;
    }
    window.open(S2_OPENSEA_URL, "_blank", "noopener,noreferrer");
    setStatus("Opening OpenSea Drop.");
  }

  const statusTone = readState === "loading"
    ? "busy"
    : error
      ? "danger"
      : mintPaused
        ? "warning"
        : readState === "success"
          ? "success"
          : "idle";

  return (
    <PageShell size="wide" className="space-y-7">
      <section className="overflow-hidden rounded border border-dyoor-cyan/25 bg-white shadow-[0_22px_70px_rgba(57,255,226,.12)]">
        <Image
          src="/assets/dyoor-s2-mint-banner.png"
          alt="D.Y.O.O.R Season 2 mints on OpenSea"
          width={1983}
          height={793}
          priority
          sizes="(max-width: 768px) 100vw, 90rem"
          className="h-auto w-full"
        />
      </section>

      <SectionHeader
        eyebrow="Season 2 SeaDrop"
        title="D.Y.O.O.R Season 2"
        copy="Paid mint configuration is managed through OpenSea SeaDrop. This page tracks the custom D.Y.O.O.R contract, reserved airdrop supply, and owned NFTs."
        actions={(
          <div className="flex flex-wrap gap-3">
            {!wallet.connected ? (
              <Button variant="primary" onClick={() => void connectWallet()} disabled={wallet.status === "connecting"}>
                {wallet.status === "connecting" ? "Connecting" : "Connect Wallet"}
              </Button>
            ) : wrongNetwork ? (
              <Button variant="primary" onClick={() => void switchToMonad()}>
                Switch Network
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void refreshAll()} disabled={readState === "loading" || nftState === "loading"}>
                Refresh
              </Button>
            )}
            <Button variant={openSeaReady ? "primary" : "secondary"} onClick={openOpenSea} disabled={!openSeaReady}>
              {openSeaReady ? "OpenSea Drop" : "OpenSea Pending"}
            </Button>
          </div>
        )}
      />

      <Alert tone={statusTone}>
        {error || status}
      </Alert>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Wallet" value={wallet.connected ? shortAddress(normalizedWallet) : "Not Connected"} />
        <StatCard label="Network" value={currentChainId ? (wrongNetwork ? "Wrong Chain" : S2_CHAIN_NAME) : "-"} />
        <StatCard label="Total Minted" value={`${totalMinted.toLocaleString()} / ${maxSupply.toLocaleString()}`} />
        <StatCard label="Current Supply" value={totalSupply.toLocaleString()} />
        <StatCard label="SeaDrop Minted" value={`${totalSeaDropMinted.toLocaleString()} / ${seaDropCap.toLocaleString()}`} />
        <StatCard label="Airdropped" value={`${totalAirdropped.toLocaleString()} / ${airdropReserve.toLocaleString()}`} />
        <StatCard label="Wallet Minted" value={walletMinted.toLocaleString()} />
        <StatCard label="Wallet Balance" value={walletBalance.toLocaleString()} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
        <div className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Contract Status</p>
              <h2 className="mt-2 text-2xl font-black uppercase text-white">SeaDrop Launch State</h2>
            </div>
            <Button variant="secondary" onClick={() => void refreshReads()} disabled={readState === "loading"}>
              Refresh
            </Button>
          </div>

          <div className="mt-5 grid gap-3 text-sm font-semibold text-white/72">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
              <span>Mint Pause</span>
              <span className={mintPaused ? "text-yellow-200" : "text-emerald-200"}>{mintPaused ? "Paused" : "Open"}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
              <span>Airdrop Pause</span>
              <span className={airdropPaused ? "text-yellow-200" : "text-emerald-200"}>{airdropPaused ? "Paused" : "Open"}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
              <span>Remaining Collection Supply</span>
              <span className="text-white">{remainingSupply.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
              <span>Remaining SeaDrop Allocation</span>
              <span className="text-white">{remainingSeaDropSupply.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
              <span>Remaining Airdrop Reserve</span>
              <span className="text-white">{remainingAirdropReserve.toLocaleString()}</span>
            </div>
            <div>
              <span className="block text-white/45">Authorized SeaDrop Contracts</span>
              <div className="mt-2 grid gap-2">
                {allowedSeaDrops.length ? allowedSeaDrops.map((address) => (
                  <a key={address} className="break-all text-dyoor-cyan hover:text-white" href={`${S2_EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer">
                    {address}
                  </a>
                )) : <span className="text-yellow-200">No SeaDrop address configured.</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Owned NFTs</p>
              <h2 className="mt-2 text-2xl font-black uppercase text-white">Wallet Preview</h2>
            </div>
            <Button variant="secondary" onClick={() => void refreshOwnedTokens()} disabled={!wallet.connected || nftState === "loading"}>
              Refresh NFTs
            </Button>
          </div>

          {nftState === "loading" ? (
            <LoadingSkeleton lines={5} className="mt-5" />
          ) : !wallet.connected ? (
            <EmptyState
              className="mt-5"
              title="Wallet Required"
              copy="Connect a wallet to preview Season 2 NFTs from this contract."
              action={<Button variant="primary" onClick={() => void connectWallet()}>Connect Wallet</Button>}
            />
          ) : ownedTokens.length === 0 ? (
            <EmptyState
              className="mt-5"
              title="No NFTs Found"
              copy="This wallet does not currently show any D.Y.O.O.R Season 2 tokens from the configured contract."
            />
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {ownedTokens.map((token) => (
                <article key={token.tokenId} className="overflow-hidden rounded border border-white/12 bg-white/[0.04]">
                  <div className="aspect-square bg-black/35">
                    {token.image ? (
                      <Image
                        src={token.image}
                        alt={token.name}
                        width={420}
                        height={420}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-xs font-black uppercase tracking-[0.18em] text-white/40">
                        Metadata Pending
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-black text-white">{token.name}</p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-white/45">#{token.tokenId}</p>
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

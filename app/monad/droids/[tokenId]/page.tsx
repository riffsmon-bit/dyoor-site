import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DroidAccountClient } from "@/components/robinhood/droids/DroidAccountClient";
import { MONAD_MAINNET_CHAIN_ID } from "@/lib/monad";

type DroidPageProps = {
  params: Promise<{ tokenId: string }>;
};

export async function generateMetadata({ params }: DroidPageProps): Promise<Metadata> {
  const { tokenId } = await params;
  return {
    title: `D.Y.O.O.R Droid #${tokenId} | Monad`,
    description: `Open the deterministic Monad Droid Wallet and inventory controlled by D.Y.O.O.R #${tokenId}.`,
  };
}

export default async function MonadDroidAccountPage({ params }: DroidPageProps) {
  const { tokenId: rawTokenId } = await params;
  const tokenId = Number(rawTokenId);
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 3_333) notFound();
  return (
    <DroidAccountClient
      chainId={MONAD_MAINNET_CHAIN_ID}
      basePath="/monad/droids"
      tokenId={tokenId}
    />
  );
}

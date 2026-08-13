import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DroidAccountClient } from "@/components/robinhood/droids/DroidAccountClient";

type DroidPageProps = {
  params: Promise<{ tokenId: string }>;
};

export async function generateMetadata({ params }: DroidPageProps): Promise<Metadata> {
  const { tokenId } = await params;
  return {
    title: `HoodYØØR Droid #${tokenId} Account`,
    description: `Open the deterministic Droid Account and inventory controlled by HoodYØØR #${tokenId}.`,
  };
}

export default async function DroidAccountPage({ params }: DroidPageProps) {
  const { tokenId: rawTokenId } = await params;
  const tokenId = Number(rawTokenId);
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 3_333) notFound();
  return <DroidAccountClient tokenId={tokenId} />;
}

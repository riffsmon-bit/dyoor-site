import { notFound } from "next/navigation";
import { S2MintTestClient } from "@/components/s2/S2MintTestClient";

export default function S2MintTestPage() {
  if (process.env.NEXT_PUBLIC_ENABLE_S2_MINT_TEST !== "true") {
    notFound();
  }

  return <S2MintTestClient />;
}

import { getAddress, type Address } from "viem";

export const DEFAULT_DYOOR_S1_CONTRACT = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
export const DEFAULT_ASCENSION_STAKING_CONTRACT = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
export const DEFAULT_ENERGY_BANK_CONTRACT = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
export const DEFAULT_TREASURY_WALLET = "0x4D540f7D0Eb841c839334655C9f88313D750c6d5";
export const DEFAULT_DYOOR_S2_MAINNET_CONTRACT = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const LEGACY_DYOOR_S2_TESTNET_CONTRACT = "0xcE586aA467F6351bf819DbF134BC69947125CD92";

export function contractAddress(value: string | undefined, fallback: string): Address {
  return getAddress(value || fallback);
}

export function optionalContractAddress(value: string | undefined): Address | "" {
  try {
    return value ? getAddress(value) : "";
  } catch {
    return "";
  }
}

function s2ContractAddress() {
  const configured = optionalContractAddress(
    process.env.DYOOR_S2_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS,
  );
  const mainnet = getAddress(DEFAULT_DYOOR_S2_MAINNET_CONTRACT);
  const legacyTestnet = getAddress(LEGACY_DYOOR_S2_TESTNET_CONTRACT);

  if (!configured) return mainnet;
  if (process.env.NODE_ENV === "production" && configured !== mainnet) {
    const detail = configured === legacyTestnet ? "legacy Monad testnet" : "non-mainnet";
    throw new Error(`Production D.Y.O.O.R S2 configuration cannot use the ${detail} contract.`);
  }
  return configured;
}

export const dyoorS1Contract = contractAddress(
  process.env.DYOOR_S1_CONTRACT || process.env.NEXT_PUBLIC_DYOOR_S1_CONTRACT,
  DEFAULT_DYOOR_S1_CONTRACT,
);

export const ascensionStakingContract = contractAddress(
  process.env.ASCENSION_STAKING_CONTRACT || process.env.NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT,
  DEFAULT_ASCENSION_STAKING_CONTRACT,
);

export const energyBankContract = contractAddress(
  process.env.ENERGY_BANK_ADDRESS || process.env.NEXT_PUBLIC_ENERGY_BANK_ADDRESS,
  DEFAULT_ENERGY_BANK_CONTRACT,
);

export const dyoorS2Contract = s2ContractAddress();

import type { CharacterProfile } from "./game";

export type WalletConnection = {
  address: string;
  authenticated: boolean;
};

export type OwnedDroid = CharacterProfile & {
  tokenId: number;
};

export type WalletPort = {
  kind: "host" | "mock" | "unavailable";
  available: boolean;
  connect(): Promise<WalletConnection>;
  disconnect(): Promise<void>;
  getAddress(): Promise<string>;
  getOwnedDroids(): Promise<OwnedDroid[]>;
  recheckOwnership(tokenId: number): Promise<boolean>;
};

export type DyoorGameHostBridge = {
  connect(): Promise<WalletConnection>;
  disconnect?(): Promise<void>;
  getAddress(): Promise<string>;
  getOwnedS2Droids(): Promise<OwnedDroid[]>;
  verifyS2Ownership(tokenId: number): Promise<boolean>;
};

declare global {
  interface Window {
    dyoorGameHost?: DyoorGameHostBridge;
  }
}

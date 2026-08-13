import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { dyoorDiscordConfig } from "../config/dyoor-discord.js";

describe("centralized production contract registry", () => {
  it("pins the authoritative contracts to their validated chains", () => {
    const contracts = Object.fromEntries(
      dyoorDiscordConfig.contracts.map((contract) => [contract.key, contract]),
    );
    expect(contracts.season1).toMatchObject({
      address: "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f",
      chainKey: "monad",
      ownershipMethod: "balanceOf",
    });
    expect(contracts.ascended).toMatchObject({
      address: "0xf9611226c1ccccca37951938d6f358d3d5106549",
      chainKey: "monad",
      ownershipMethod: "tokensOfStaker",
    });
    expect(contracts.season2).toMatchObject({
      address: "0x349d8eb480c92cf75371fba5c6344a4d11b9103a",
      chainKey: "monad",
    });
    expect(contracts.hoodyoor).toMatchObject({
      address: "0x8277f8126722b11d7b44c5c453bcf62a78aafa25",
      chainKey: "robinhood",
    });
    expect(dyoorDiscordConfig.chains.find((chain) => chain.key === "monad")?.id).toBe(143);
    expect(dyoorDiscordConfig.chains.find((chain) => chain.key === "robinhood")?.id).toBe(4663);
    expect(() =>
      dyoorDiscordConfig.contracts.forEach((contract) => getAddress(contract.address)),
    ).not.toThrow();
  });

  it("includes S1 and S2 in sales but deliberately excludes HoodYØØR", () => {
    expect(dyoorDiscordConfig.salesCollections.map((collection) => collection.key)).toEqual([
      "season1",
      "season2",
    ]);
  });
});

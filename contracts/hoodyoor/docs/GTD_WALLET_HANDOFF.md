# GTD wallet handoff

The frozen launch tree currently combines two independently sourced cohorts:

- every unique holder of the Monad D.Y.O.O.R contract at block `93374159`, with
  `maxMint = 1` regardless of token balance;
- the supplied 200-wallet Robinhood top-holder allowlist, with `maxMint = 3`.

Duplicate addresses take the higher allowance and never stack. All GTD mints are
paid at the HoodYØØR contract price; the imported OpenSea zero-price column does not
apply. The combined root is
`0x915e9b6ddcfe13a197ade8f6b776d37beb8ce2f766001e6579bd0601ffc5dd31`.

If the launch-page registration cohort is added later, it should prove wallet
ownership before inclusion. Prefer Sign-In with Ethereum (EIP-4361) on Robinhood
Chain ID `4663`, with a domain-bound nonce and expiration.

At minimum, preserve:

- checksummed wallet address;
- requested or approved `maxMint` allowance;
- exact signed message;
- signature;
- domain and URI;
- nonce;
- issued-at timestamp;
- expiration timestamp when used;
- verification timestamp and result.

Never request or store a private key or seed phrase.

Before changing or extending the frozen tree:

1. Verify every signature against the exact message and address.
2. Remove duplicates by normalized address.
3. Merge the two frozen cohorts and any separately approved registrations by taking
   the highest `maxMint` for duplicate addresses.
4. Build an OpenZeppelin `StandardMerkleTree` with value types
   `["address", "uint256"]`.
5. Save the complete tree dump and a flat wallet/allowance CSV.
6. Confirm that any changed root is reflected in the launch manifest, then set it
   through `setGTDMerkleRoot` while the GTD phase is closed.
7. Test at least one valid proof, one invalid proof, and one exhausted allowance.

Suggested SIWE statement:

```text
Register this wallet for HoodYØØR GTD mint access. This signature does not authorize a transaction or transfer of assets.
```

The GTD contract proof contains only `wallet` and `maxMint`. Signatures remain in
the launch database/export as the admission audit trail and are not published
on-chain.

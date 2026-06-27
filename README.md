# DYOOR Site (Rebuilt)

- One-page layout with a centered container system (no drifting sections)
- Homepage focused on live flows: swap, ascension, and collection preview
- Discord verification lives on `/verify.html`
- Stake page uses a real wallet chooser instead of the old prompt-based selector

## Deploy
Upload the folder contents to Netlify as a static site.

## Energy Bank Admin

Energy Bank deployment, backfill, and airdrop commands live in
`DEPLOY_ENERGY_BANK.md`.

For the 25,000 Energy wallet airdrop, run contract tests first:

```bash
npm run compile:contracts
npm run test:contracts
```

Then dry-run before any broadcast:

```bash
export ENERGY_BANK_ADDRESS=<deployed DYOOREnergyBank address>
export DEPLOYER_PRIVATE_KEY=<admin private key>
export HARDHAT_NETWORK=monad
export AIRDROP_WALLET_FILE=/Users/brandonduke/Desktop/dyoor_wallet_addresses.txt

npm run airdrop:energy:dry-run
```

Broadcast command:

```bash
npm run airdrop:energy:broadcast
```

## OpenSea collection preview (scrolling marquee)
This site includes a "Collection Preview" section that pulls NFT images from OpenSea and scrolls them continuously.

- Collection details are set in `script.js`:
  - `const OPENSEA_CHAIN = "monad";`
  - `const MONAD_CONTRACT_ADDRESS = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";`
  - `const OPENSEA_COLLECTION_SLUG = "dyoor-154958357";` (fallback)

### Netlify environment variable (recommended)
Set `OPENSEA_API_KEY` in Netlify to reduce rate-limits and make the preview more reliable.

**Netlify UI:**
1. Netlify Dashboard → select your site
2. **Site configuration** → **Environment variables**
3. **Add a variable**
   - Key: `OPENSEA_API_KEY`
   - Value: *(your OpenSea API key)*
4. Deploy/trigger a new build (or redeploy). Netlify Functions will pick it up.

The proxy function lives at `netlify/functions/opensea.js` and the front-end calls (contract-first):
`/.netlify/functions/opensea?chain=monad&address=0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f&slug=dyoor-154958357&limit=48`

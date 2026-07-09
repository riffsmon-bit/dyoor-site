# DYOOR S2 Pinata Asset Uploads

Dynamic rerolls need two asset layers:

- Final composed images for the initial reveal/fallback state.
- Individual trait image assets for rendering updated visuals after rerolls.

Metadata should stay dynamic at `https://dyoor.xyz/api/metadata/{tokenId}`. Pinata should store image assets and optional metadata backups.

## 1. Create a Pinata JWT

In Pinata, create an API key/JWT with upload or pinning permissions.

Add it locally only:

```bash
PINATA_JWT=your_pinata_jwt_here
PINATA_GATEWAY_URL=https://your-gateway.mypinata.cloud
```

Do not add `PINATA_JWT` to any `NEXT_PUBLIC_` variable.

## 2. Dry Run the Trait Asset Upload

Run this first to confirm file count and IPFS paths:

```bash
npm run upload:pinata -- --dir "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/output/trait-items/images" --name dyoor-s2-trait-assets --type s2-trait-assets --dry-run
```

The current generator output has a flat trait image folder, so example paths look like:

```text
black-beanie.png
dyoor-black-hoodie.png
laser-eyes.png
```

After upload, those resolve as:

```text
ipfs://TRAIT_ASSET_CID/black-beanie.png
```

## 3. Upload Trait Assets

```bash
npm run upload:pinata -- --dir "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/output/trait-items/images" --name dyoor-s2-trait-assets --type s2-trait-assets
```

Save the returned CID as the trait asset CID for the image renderer.

## 4. Upload Final Composed Images

These are the initial token images and fallback images:

```bash
npm run upload:pinata -- --dir "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/output/images" --name dyoor-s2-final-images --type s2-final-images --dry-run
npm run upload:pinata -- --dir "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/output/images" --name dyoor-s2-final-images --type s2-final-images
```

The returned CID becomes:

```bash
DYOOR_S2_IMAGE_CID=<final_images_cid>
```

Initial metadata images then look like:

```text
ipfs://DYOOR_S2_IMAGE_CID/1.png
ipfs://DYOOR_S2_IMAGE_CID/3333.png
```

## 5. Optional Metadata Backup

The live collection metadata should come from the dynamic API, but pinning a backup metadata folder is useful:

```bash
npm run upload:pinata -- --dir "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/output/metadata" --name dyoor-s2-metadata-backup --type s2-metadata-backup --dry-run
npm run upload:pinata -- --dir "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/output/metadata" --name dyoor-s2-metadata-backup --type s2-metadata-backup
```

## 6. Upload Manifests

Every successful upload writes a manifest under:

```text
exports/pinata-uploads/
```

The manifest includes:

- CID
- `ipfs://` base URI
- optional gateway URL
- file count
- source folder
- sample paths

Keep those manifests with the project so we can wire the dynamic metadata/image API to the correct CIDs.

## 7. Important Notes

- Use Pinata for static image assets.
- Use `dyoor.xyz` for dynamic metadata and dynamic rendered images.
- The final contract base URI should be `https://dyoor.xyz/api/metadata/`.
- Rerolls should update the trait override state, then the metadata API and image renderer should read the new state.
- OpenSea caches metadata and images, so refreshed rerolls may require a marketplace metadata refresh.

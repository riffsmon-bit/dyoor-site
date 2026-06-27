# Move Back To MacBook

Date: 2026-06-26

## Paths

- Original external project path: `/Volumes/DYOOR Hard Drive/DYOOR_PROJECT_EXPORT/dyoor-site`
- External backup path: `/Volumes/DYOOR Hard Drive/DYOOR_BACKUP_BEFORE_MOVE/dyoor-site-20260626-0950`
- New MacBook project path: `/Users/brandonduke/Projects/DYOOR`

The external drive copy was not deleted.

## Active Project Identified

The real working project was confirmed at:

```text
/Volumes/DYOOR Hard Drive/DYOOR_PROJECT_EXPORT/dyoor-site
```

It is a real Next app/project folder, not a scaffold-only or temp folder. It contains the active Git repo and the expected app/source/config/docs folders.

## Git

- Branch: `audit-polish-migration-check`
- External checkpoint commit before move: `52b213d Fix mobile nav and admin command center`
- Main branch was not touched.
- No push was performed.

## Copied Files And Folders

Key folders/files verified in the backup and MacBook copy:

- `app`
- `components`
- `public`
- `contracts`
- `scripts`
- `netlify/functions`
- `src`
- `lib`
- `providers`
- `hooks`
- `package.json`
- `package-lock.json`
- `README.md`
- `AUDIT_RESULTS.md`
- `ADMIN_FEATURES.md`
- `ADMIN_COMMAND_CENTER.md`
- `MIGRATION_AUDIT.md`
- `.env.example`
- `next.config.mjs`
- `netlify.toml`

Local env files are present in the MacBook project for local operation, but no secret values were printed or copied into documentation.

## Excluded From Rsync

- `node_modules`
- `.next/cache`
- `.next/dev`
- `dist`
- `build`
- `.turbo`
- `.vite`
- `coverage`
- `.DS_Store`

## Verification Results

From `/Users/brandonduke/Projects/DYOOR`:

- `npm install`: passed
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run build`: passed after rerunning outside the sandbox because Turbopack needs to bind a local worker port
- Built server: passed on `http://localhost:3002`

Routes verified by local HTTP checks against the built server:

- `/`: 200
- `/ascension`: 200
- `/build-droid`: 200
- `/admin-command-center`: 200

## Development Server Notes

`next dev` started but hung while compiling/serving the first request in this environment, both with Turbopack and webpack. The production build and built local server are working from MacBook storage.

Working local preview command:

```bash
cd /Users/brandonduke/Projects/DYOOR
./node_modules/.bin/next start -p 3002
```

Dev command to retry:

```bash
cd /Users/brandonduke/Projects/DYOOR
./node_modules/.bin/next dev --webpack -p 3003
```

## Confirmed Current Work

- Mobile nav changes are present in `components/layout/SiteNav.tsx`.
- Admin Command Center is present at `app/admin/page.tsx` and `app/admin-command-center/page.tsx`.
- Server-side admin verification is present in `lib/adminAuth.ts`.
- Admin signed message helper is present in `lib/adminMessage.ts`.
- Ascension page exists at `app/ascension/page.tsx`.
- Blueprint builder/checker files are present at `app/build-droid/page.tsx` and `app/blueprint-checker/page.tsx`.
- Wallet provider is present at `providers/WalletServiceProvider.tsx`.

## Next Steps

1. Use `/Users/brandonduke/Projects/DYOOR` as the active development folder.
2. Open that folder in VS Code.
3. Keep the external drive copy and backup until the MacBook copy has been manually reviewed.
4. Do not push until explicitly approved.

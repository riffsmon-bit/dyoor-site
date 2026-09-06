#!/usr/bin/env node
// Read-only export. Never uploads, deletes, or rewrites live state.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { getStore, listStores } from '@netlify/blobs';

const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination)) throw new Error('Pass an absolute, private backup directory');
const siteID = process.env.NETLIFY_SITE_ID;
if (!siteID) throw new Error('NETLIFY_SITE_ID is required');
let token = process.env.NETLIFY_AUTH_TOKEN;
if (!token && process.argv.includes('--use-cli-auth')) {
  const configPath = process.env.NETLIFY_CLI_CONFIG || path.join(os.homedir(), 'Library/Preferences/netlify/config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  token = config.users[config.userId]?.auth?.token;
}
if (!token) throw new Error('Provide NETLIFY_AUTH_TOKEN or explicit --use-cli-auth');
process.umask(0o077);
await fs.mkdir(destination, { recursive: true, mode: 0o700 });
const credentials = { siteID, token, consistency: 'strong' };
const selected = process.env.DYOOR_BACKUP_STORES?.split(',').filter(Boolean);
const stores = selected || (await listStores(credentials)).stores;
const manifest = { siteID, startedAt: new Date().toISOString(), completedAt: null, files: [], errors: [] };
for (const name of stores) {
  if (!/^[a-z0-9-]+$/i.test(name)) throw new Error('Unsafe store name');
  const store = getStore({ ...credentials, name });
  const entries = [];
  for await (const page of store.list({ paginate: true })) entries.push(...page.blobs);
  console.log(`${name}: ${entries.length} objects`);
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      try {
        // Opaque keys become filenames; private keys/content are never printed.
        const file = path.join(name, crypto.createHash('sha256').update(entry.key).digest('hex'));
        const output = path.join(destination, file);
        await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
        let result;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { result = await store.getWithMetadata(entry.key, { type: 'arrayBuffer' }); break; }
          catch (error) { if (attempt === 2) throw error; }
        }
        if (!result) throw new Error('Object disappeared during export');
        const bytes = Buffer.from(result.data);
        await fs.writeFile(output, bytes, { mode: 0o600, flag: 'wx' });
        manifest.files.push({ store: name, key: entry.key, file, bytes: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'), metadata: result.metadata,
          listedEtag: entry.etag, exportedEtag: result.etag });
        if (manifest.files.length % 100 === 0) console.log(`Exported ${manifest.files.length} objects`);
      } catch (error) { manifest.errors.push({ store: name, key: entry.key, error: String(error) }); }
    }
  }));
  await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
}
manifest.completedAt = new Date().toISOString();
await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ files: manifest.files.length, errors: manifest.errors.length, destination }));
if (manifest.errors.length) process.exitCode = 1;

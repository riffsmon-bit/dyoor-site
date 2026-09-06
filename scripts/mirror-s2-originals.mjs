#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = 'bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq';
const gateway = process.env.DYOOR_MIRROR_SOURCE || 'https://jade-efficient-beaver-697.mypinata.cloud';
const repository = process.env.IPFS_PATH;
if (!repository || !path.isAbsolute(repository)) throw new Error('Set a dedicated absolute IPFS_PATH');
const api = process.env.DYOOR_MIRROR_API || 'http://127.0.0.1:5002';
if (!['127.0.0.1', 'localhost'].includes(new URL(api).hostname)) throw new Error('Use the private local IPFS API');
const apiMultiaddr = `/ip4/127.0.0.1/tcp/${new URL(api).port || '5002'}`;
const progress = path.join(repository, 'dyoor-originals-progress.json');
const completed = new Set(JSON.parse(await fs.readFile(progress, 'utf8').catch(() => '[]')));
let cursor = 1;
const failed = [];
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dyoor-car-mirror.'));
async function isPresent(id) {
  const response = await fetch(`http://127.0.0.1:8082/ipfs/${root}/${id}.png`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) { await response.body?.cancel(); return false; }
  let length = 0;
  for await (const chunk of response.body) length += chunk.length;
  return length > 0;
}
await Promise.all(Array.from({ length: 4 }, async (_, worker) => {
  while (cursor <= 3333) {
    const id = cursor++;
    if (completed.has(id) && await isPresent(id).catch(() => false)) continue;
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const response = await fetch(`${gateway}/ipfs/${root}/${id}.png?format=car&dag-scope=all`, { signal: AbortSignal.timeout(90000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 30000000) throw new Error('Unexpected CAR size');
        const file = path.join(temporary, `${worker}.car`);
        await fs.writeFile(file, bytes);
        await exec('ipfs', ['--api', apiMultiaddr, 'dag', 'import', '--pin-roots=false', file], { timeout: 120000 });
        if (!await isPresent(id)) throw new Error('Imported CAR did not contain the complete image');
        completed.add(id);
        done = true;
        // This resumable checkpoint is advisory; content is rechecked on resume.
        if (completed.size % 25 === 0) {
          await fs.writeFile(progress, JSON.stringify([...completed].sort((a, b) => a - b)));
          console.log(`Verified ${completed.size}/3333 originals`);
        }
      } catch (error) { if (attempt === 2) console.error(`Image ${id}: ${error.message}`); }
    }
    if (!done) failed.push(id);
  }
}));
await fs.writeFile(progress, JSON.stringify([...completed].sort((a, b) => a - b)));
await fs.rm(temporary, { recursive: true });
if (failed.length) {
  console.error(JSON.stringify({ failed }));
  process.exitCode = 1;
} else {
  await exec('ipfs', ['--api', apiMultiaddr, '--timeout=10m', 'pin', 'add', root], { timeout: 660000 });
  console.log(`Complete: ${root} recursively pinned`);
}

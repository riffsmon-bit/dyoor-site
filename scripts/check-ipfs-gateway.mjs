#!/usr/bin/env node
// Read-only smoke checks. Full completeness still requires private pin verify.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const gateway = new URL(process.argv[2] || 'https://ipfs.dyoor.fun');
if (gateway.protocol !== 'https:' || gateway.username || gateway.password) throw new Error('Use an HTTPS gateway without credentials');
const originals = 'bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq';
const cases = [
  { path: '/healthz', status: 200 },
  { path: '/api/v0/id', status: 404 },
  { path: '/api/v0/pin/add', method: 'POST', status: 404 },
  { path: '/ipfs/QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn/test', status: 404 },
  { path: `/ipfs/${originals}/1.png`, method: 'POST', status: 405 },
  ...[1, 3, 16, 1111, 2222, 3333].map(id => ({ path: `/ipfs/${originals}/${id}.png`, status: 200, type: 'png' })),
  { path: '/ipfs/bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq/1', status: 200, type: 'json' },
  { path: '/ipfs/bafybeigzwmixppsb5hff7hioos3j427l7esli742p6p6hvyoxz3jfv7oiu/abyss-laser.png', status: 200, type: 'png' },
  { path: `/ipfs/bafybeidbaema3cr6n7sc3rglryevbtxziqrz3sk2d6equehsssziobcrru/${(1000).toString(16).padStart(64, '0')}`, status: 200, type: 'json' },
  { path: '/ipfs/bafybeiareb6zxaatwobhwca46uadexwrwlnp7sm4awnccp3lcdwulkz6ri/Droid/Purple.webp', status: 200, type: 'webp' },
  { path: '/ipfs/QmShXqgZ1eLNGD11PHe4TZyu14T3iqxewp25AEycy252HU/1', status: 200, type: 'json' },
  ...[1, 1111].map(id => ({ path: `/ipfs/QmTPskHN7uyZbiUKEYmQG9NRjaiELwTYwoko7QQrpaVmCB/${id}`, status: 200, type: 'png' })),
];
let cursor = 0;
let failures = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < cases.length) {
    const check = cases[cursor++];
    const started = Date.now();
    try {
      const response = await fetch(new URL(check.path, gateway), { method: check.method || 'GET', signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, check.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (check.type === 'png') assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      if (check.type === 'webp') { assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WEBP'); }
      if (check.type === 'json') assert.ok(JSON.parse(bytes.toString()).name);
      console.log(JSON.stringify({ ok: true, path: check.path, method: check.method || 'GET', status: response.status,
        bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ms: Date.now() - started }));
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ ok: false, path: check.path, error: error.message }));
    }
  }
}));
console.log(JSON.stringify({ checks: cases.length, failures, gateway: gateway.origin }));
if (failures) process.exitCode = 1;

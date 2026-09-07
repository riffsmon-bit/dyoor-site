// Fixed public read-only evidence collector. No environment, signer, secret or write RPC.
import { keccak256, toUtf8Bytes } from 'ethers';

const address = '0x349D8eb480c92cF75371fbA5C6344A4d11b9103A';
const blockNumber = 102511645;
const sourceUrl = `https://sourcify.dev/server/v2/contract/143/${address}?fields=all`;
const rpcUrl = 'https://rpc.monad.xyz';

async function boundedJson(url, init = {}, maxBytes = 8_000_000) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(25_000) });
  if (!response.ok || !response.body) throw Error(`Evidence request failed: ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw Error('Evidence response too large'); }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function rpc(method, params) {
  if (!['eth_chainId', 'eth_getCode'].includes(method)) throw Error('Non-read RPC denied');
  const result = await boundedJson(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }, 100_000);
  if (result.error || typeof result.result !== 'string') throw Error('Public RPC evidence unavailable');
  return result.result;
}

if (BigInt(await rpc('eth_chainId', [])) !== 143n) throw Error('Wrong chain');
const [source, code] = await Promise.all([
  boundedJson(sourceUrl), rpc('eth_getCode', [address, `0x${blockNumber.toString(16)}`]),
]);
if (source.runtimeMatch !== 'exact_match' ||
    code.toLowerCase() !== source.runtimeBytecode?.onchainBytecode?.toLowerCase() ||
    code.toLowerCase() !== source.runtimeBytecode?.recompiledBytecode?.toLowerCase()) {
  throw Error('Verified source bytecode does not exactly match pinned RPC runtime');
}

const paths = [
  'contracts/DYOORSeason2SeaDrop.sol',
  'lib/seadrop/lib/ERC721A/contracts/ERC721A.sol',
  'lib/seadrop/src/ERC721ContractMetadata.sol',
  'lib/seadrop/src/interfaces/ITransferValidator.sol',
];
const sourceHashes = Object.fromEntries(paths.map(path => {
  const content = source.sources?.[path]?.content;
  if (typeof content !== 'string') throw Error('Missing verified source');
  return [path, keccak256(toUtf8Bytes(content))];
}));

console.log(JSON.stringify({
  version: 1, observedAt: new Date().toISOString(), chainId: 143, address, blockNumber,
  sourceUrl, rpcUrl, sourceMatchId: source.matchId, runtimeMatch: source.runtimeMatch,
  runtimeBytes: (code.length - 2) / 2, runtimeHash: keccak256(code),
  deployment: source.deployment, compilation: source.compilation,
  functions: source.abi.filter(item => item.type === 'function').map(item => item.name),
  storageSlots: source.storageLayout.storage.map(({ label, slot, offset }) => ({ label, slot, offset })),
  sourceHashes, publicWrites: false,
}, null, 2));

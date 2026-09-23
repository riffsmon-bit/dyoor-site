// Phase 0 evidence collector: public reads only; no environment or signing APIs.
import { Interface, keccak256, id } from 'ethers';
const rpcUrls = ['https://rpc.monad.xyz', 'https://monad-mainnet.drpc.org'];
const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_getBalance', 'eth_call']);
async function rpc(method, params) {
  if (!allowed.has(method)) throw Error('Non-read RPC method denied');
  for (const url of rpcUrls) {
    try {
      const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});
      const data=await response.json();
      if (data.error) throw Error(data.error.message);
      if (data.result === undefined) throw Error('Missing result');
      return data.result;
    } catch (error) { if (url === rpcUrls.at(-1)) throw error; }
  }
}
const chainId=Number(BigInt(await rpc('eth_chainId',[])));
if(chainId!==143) throw Error('Wrong chain');
const block=await rpc('eth_blockNumber',[]);
const contracts={
  season2:'0x349d8eb480c92cf75371fba5c6344a4d11b9103a',
  season1:'0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f',
  ascension:'0xf9611226c1ccccca37951938d6f358d3d5106549',
  energy:'0x291a8cc0fca08ebd64a0e4d67b4455d24e9e6767',
  canonicalRegistry:'0x000000006551c19487814612e58fe06813775758',
  implementation:'0x6281af8e25e9c20bdf44d42d46613c43433a9b29',
  registry:'0xc32b411e7dcabd85a9b25c6eadd87f0a3fe8ea1b',
  worldNames:'0xde073c0ea9052a51c7fc67be6fc311a1c0c00357',
  worldEscrow:'0xdea68bf8acfd96f174f93bd936a5dc3d2f010601',
  kuruRouter:'0xd651346d7c789536ebf06dc72ae3c8502cd695cc',
  kuruMarket:'0x065c9d28e428a0db40191a54d33d5b7c71a9c394',
};
const evidence={observedAt:new Date().toISOString(),chainId,block:Number(BigInt(block)),rpcUrls,contracts:{},calls:{}};
for(const [name,address] of Object.entries(contracts)) {
  const code=await rpc('eth_getCode',[address,block]);
  evidence.contracts[name]={address,codeBytes:(code.length-2)/2,runtimeHash:keccak256(code)};
}
async function read(name,address,fragment,args=[]) {
  const abi=new Interface([fragment]);const fn=abi.fragments[0];
  try {
    const raw=await rpc('eth_call',[{to:address,data:abi.encodeFunctionData(fn,args),gas:'0x186a0'},block]);
    const decoded=abi.decodeFunctionResult(fn,raw);
    evidence.calls[name]=Array.from(decoded);
    return decoded;
  } catch(error) { evidence.calls[name]={error:String(error.message).slice(0,180)}; return null; }
}
for(const name of ['season2','season1','ascension','energy','implementation','worldNames','worldEscrow']) {
  await read(name+'.owner',contracts[name],'function owner() view returns(address)');
}
await read('season2.name',contracts.season2,'function name() view returns(string)');
await read('season2.ownerOf11',contracts.season2,'function ownerOf(uint256) view returns(address)',[11]);
await read('season2.tokenURI11',contracts.season2,'function tokenURI(uint256) view returns(string)',[11]);
await read('season2.totalSupply',contracts.season2,'function totalSupply() view returns(uint256)');
for(const [field,type] of [['canonicalRegistry','address'],['implementation','address'],['tokenContract','address'],['tokenChainId','uint256'],['accountSalt','bytes32']]) await read('registry.'+field,contracts.registry,`function ${field}() view returns(${type})`);
const account=await read('registry.account11',contracts.registry,'function account(uint256) view returns(address)',[11]);
if(account) {
  const address=account[0];const code=await rpc('eth_getCode',[address,block]);
  evidence.account11={address,codeBytes:(code.length-2)/2,runtimeHash:keccak256(code),balanceWei:BigInt(await rpc('eth_getBalance',[address,block])).toString(),embeddedImplementation:'0x'+code.slice(22,62)};
  await read('account11.owner',address,'function owner() view returns(address)');
  await read('account11.token',address,'function token() view returns(uint256,address,uint256)');
  await read('account11.state',address,'function state() view returns(uint256)');
  await read('account11.interface165',address,'function supportsInterface(bytes4) view returns(bool)',['0x01ffc9a7']);
  const owner=evidence.calls['account11.owner']?.[0];
  if(owner) await read('account11.validSigner',address,'function isValidSigner(address,bytes) view returns(bytes4)',[owner,'0x']);
  await read('account11.invalidSigner',address,'function isValidSigner(address,bytes) view returns(bytes4)',['0x0000000000000000000000000000000000000001','0x']);
  const salt=evidence.calls['registry.accountSalt']?.[0];
  if(salt) await read('canonical.account11',contracts.canonicalRegistry,'function account(address,bytes32,uint256,address,uint256) view returns(address)',[contracts.implementation,salt,143,contracts.season2,11]);
}
await read('energy.paused',contracts.energy,'function paused() view returns(bool)');
const admin=evidence.calls['season2.owner']?.[0];
if(admin) for(const role of ['DEFAULT_ADMIN_ROLE','PAUSER_ROLE','CREDIT_ROLE','SPENDER_ROLE','CREDIT_SIGNER_ROLE']) {
  await read('energy.adminHas.'+role,contracts.energy,'function hasRole(bytes32,address) view returns(bool)',[role==='DEFAULT_ADMIN_ROLE'?'0x'+'0'.repeat(64):id(role),admin]);
}
console.log(JSON.stringify(evidence,(_,v)=>typeof v==='bigint'?v.toString():v,2));

export const DROID_COLLECTION_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function tokenTraits(uint256 tokenId) view returns (uint256)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
] as const;

export const DROID_REGISTRY_ABI = [
  "function account(uint256 tokenId) view returns (address)",
  "function createAccount(uint256 tokenId) returns (address)",
  "function isAccountCreated(uint256 tokenId) view returns (bool)",
  "function canonicalRegistry() view returns (address)",
  "function implementation() view returns (address)",
  "function tokenContract() view returns (address)",
  "function tokenChainId() view returns (uint256)",
  "function accountSalt() view returns (bytes32)",
  "event DroidAccountActivated(address indexed account,address indexed tokenContract,uint256 indexed tokenId,address owner,address implementation,uint256 implementationVersion)",
] as const;

export const CANONICAL_ERC6551_REGISTRY_ABI = [
  "function account(address implementation,bytes32 salt,uint256 chainId,address tokenContract,uint256 tokenId) view returns (address)",
] as const;

export const DROID_ACCOUNT_ABI = [
  "function owner() view returns (address)",
  "function token() view returns (uint256 chainId,address tokenContract,uint256 tokenId)",
  "function state() view returns (uint256)",
  "function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes)",
  "event NativeReceived(address indexed sender,uint256 amount,uint256 indexed state)",
  "event Executed(address indexed executor,address indexed target,uint256 value,bytes4 indexed selector,uint256 state)",
  "event ERC721Received(address indexed collection,uint256 indexed tokenId,address indexed from,address operator,uint256 state)",
  "event ERC1155Received(address indexed collection,uint256 indexed tokenId,uint256 amount,address indexed from,address operator,uint256 state)",
] as const;

export const DROID_ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address recipient,uint256 amount) returns (bool)",
] as const;

export const DROID_ERC721_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function safeTransferFrom(address from,address to,uint256 tokenId)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
] as const;

export const DROID_ENERGY_ABI = [
  "function energyBalance(address account) view returns (uint256)",
] as const;

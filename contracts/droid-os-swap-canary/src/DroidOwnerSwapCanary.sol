// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {OwnerSwapCanaryCore} from "./OwnerSwapCanaryCore.sol";

interface ISwapCanaryParent {
    function ownerOf(uint256) external view returns (address);
}

interface IUSDCProxy {
    function implementation() external view returns (address);
}

/// @notice UNDEPLOYED isolated Monad #11 test, not the canonical V2 wallet.
/// Known Kuru proxy-upgrade race remains; source/review is NOT claimed complete.
contract DroidOwnerSwapCanary is OwnerSwapCanaryCore {
    address public constant COLLECTION = 0x349D8eb480c92cF75371fbA5C6344A4d11b9103A;
    uint256 public constant TOKEN_ID = 11;
    address public constant ROUTER = 0xd651346d7c789536ebf06dc72aE3C8502cd695CC;
    address public constant MARKET = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
    address public constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    bytes32 private constant PROXY_HASH = 0xb3fcfca704395c210e969b841f35fff7483f99721de8d65b219615dd5e03f43b;

    constructor() {
        if (msg.sender != currentOwner()) revert Denied();
        _checkVenue();
    }

    function currentOwner() public view override returns (address owner) {
        if (
            block.chainid != 143
                || COLLECTION.codehash != 0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd
        ) revert Denied();
        owner = ISwapCanaryParent(COLLECTION).ownerOf(TOKEN_ID);
        if (owner == address(0) || owner == address(this)) revert Denied();
    }

    function venue() public pure override returns (address, address, address) {
        return (ROUTER, MARKET, USDC);
    }

    function _checkVenue() internal view override {
        if (
            ROUTER.codehash != PROXY_HASH || MARKET.codehash != PROXY_HASH
                || USDC.codehash != 0xbb3557cf62a26950fb58073e6ce8e130af371e5aa13e5584856a1ce2ca47dc89
        ) revert Denied();
        // The verified USDC proxy exposes its implementation slot through its own
        // fixed getter. Kuru has no equivalent proven atomic getter: runtime pinning
        // here does NOT resolve Kuru's upgrade race, even with an off-chain snapshot.
        address implementation = IUSDCProxy(USDC).implementation();
        if (
            implementation != 0xbd520ea8CbB4F81b62aFF3c3FfE7AfFD69800b6d
                || implementation.codehash != 0xe96489833045c42bacced6259e6a6372290706ed665e79457aa2fe4d46bc3559
        ) revert Denied();
    }
}

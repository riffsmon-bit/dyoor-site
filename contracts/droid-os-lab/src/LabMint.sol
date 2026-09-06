// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Fixed, inspectable mint fixture. No arbitrary calls, approvals or operators.
contract LabMint {
    uint256 public price;
    uint256 public nextTokenId = 1;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    constructor(uint256 priceWei) {
        require(block.chainid == 31337, "LOCAL_ONLY");
        price = priceWei;
    }

    function mint(address recipient) external payable returns (uint256 tokenId) {
        require(msg.value == price && recipient != address(0), "INVALID_MINT");
        tokenId = nextTokenId++;
        ownerOf[tokenId] = recipient;
        balanceOf[recipient]++;
    }
}

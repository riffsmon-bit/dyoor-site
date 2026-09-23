// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Fixed, inspectable mint fixture. No arbitrary calls, approvals or operators.
contract LabMint {
    uint256 public price;
    uint256 public nextTokenId = 1;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    constructor(uint256 priceWei) {
        require(block.chainid == 31337, "LOCAL_ONLY");
        price = priceWei;
    }

    function mint(address recipient) external payable returns (uint256 tokenId) {
        require(msg.value == price && recipient != address(0), "INVALID_MINT");
        tokenId = nextTokenId++;
        ownerOf[tokenId] = recipient;
        balanceOf[recipient]++;
        emit Transfer(address(0), recipient, tokenId);
    }

    /// @notice Fixture custody transfer, not a complete ERC-721 implementation.
    function transfer(address recipient, uint256 tokenId) external {
        require(ownerOf[tokenId] == msg.sender && recipient != address(0), "OWNER_ONLY");
        ownerOf[tokenId] = recipient;
        balanceOf[msg.sender]--;
        balanceOf[recipient]++;
        emit Transfer(msg.sender, recipient, tokenId);
    }
}

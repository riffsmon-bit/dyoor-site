// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@droid-oz/token/ERC721/ERC721.sol";

/// @dev LOCAL FIXTURE ONLY. Real Season 2 does NOT provide this lifecycle epoch.
contract EpochParentLab is ERC721 {
    mapping(uint256 => uint256) public ownershipEpoch;

    constructor() ERC721("LOCAL Epoch Droid", "LOCAL") {
        require(block.chainid == 31337, "LOCAL_ONLY");
    }

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function burn(uint256 id) external {
        require(ownerOf(id) == msg.sender, "OWNER");
        _burn(id);
    }

    function _beforeTokenTransfer(address from, address to, uint256 id) internal override {
        super._beforeTokenTransfer(from, to, id);
        ownershipEpoch[id]++;
    }
}

/// @dev Fixed zero-price mint fixture. No external feed, fee, admin or asset value.
contract MissionMintLab is ERC721 {
    uint256 public totalMinted;

    constructor() ERC721("LOCAL Mission Mint", "LOCAL") {
        require(block.chainid == 31337, "LOCAL_ONLY");
    }

    function mint() external returns (uint256 id) {
        id = ++totalMinted;
        _safeMint(msg.sender, id);
    }
}

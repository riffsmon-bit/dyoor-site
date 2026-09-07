// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@droid-oz/token/ERC721/ERC721.sol";
import {Base64} from "@droid-oz/utils/Base64.sol";

/// @notice Free public test collectible, one mint per caller. No promised value or Energy reward.
/// No owner/admin, fee, allowlist changes, paid mint, external metadata service or upgrade.
contract DroidAssistBadge is ERC721 {
    uint256 public totalMinted;
    mapping(address => bool) public hasMinted;

    error AlreadyMinted();

    constructor() ERC721("DYOOR ASSIST Canary - Test Only", "DTEST") {}

    function mintCanary() external returns (uint256 id) {
        if (hasMinted[msg.sender]) revert AlreadyMinted();
        hasMinted[msg.sender] = true;
        id = ++totalMinted;
        _safeMint(msg.sender, id);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireMinted(id);
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(
                bytes(
                    '{"name":"DYOOR ASSIST Test Badge","description":"Test collectible for owner-approved Droid wallet minting. No promised value, yield, utility or Energy reward."}'
                )
            )
        );
    }
}

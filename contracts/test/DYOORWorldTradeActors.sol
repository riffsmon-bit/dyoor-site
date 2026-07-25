// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IDYOORWorldTradeEscrowActor {
    function acceptTrade(uint256 tradeId) external payable;
    function withdrawMon(address payable recipient) external;
}

contract RejectingWorldTrader is IERC721Receiver {
    function approveDroid(address collection, address escrow, uint256 tokenId) external {
        IERC721(collection).approve(escrow, tokenId);
    }

    function accept(address escrow, uint256 tradeId) external {
        IDYOORWorldTradeEscrowActor(escrow).acceptTrade(tradeId);
    }

    function withdrawDeferredMon(address escrow, address payable recipient) external {
        IDYOORWorldTradeEscrowActor(escrow).withdrawMon(recipient);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        revert("MON_REJECTED");
    }
}

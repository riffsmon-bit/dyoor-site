// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {WrappedMissionAccountLab, IWrapperControlLab} from "./WrappedMissionAccountLab.sol";
import {MissionMintLab} from "../MissionFixtures.sol";

/// @dev Separate fixed factory keeps receipt runtime below EIP-170. No public account creation.
contract WrappedAccountFactoryLab {
    address public immutable wrapper;

    constructor() {
        require(block.chainid == 31337, "LOCAL_ONLY");
        wrapper = msg.sender;
    }

    function create(uint256 id, MissionMintLab minter) external returns (address) {
        require(block.chainid == 31337 && msg.sender == wrapper, "WRAPPER_ONLY");
        return address(new WrappedMissionAccountLab(IWrapperControlLab(wrapper), id, minter));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DroidMintAccountLab} from "../src/DroidMintAccountLab.sol";

contract WithdrawalActor {
    DroidMintAccountLab public account;
    bool public nestedSucceeded;
    bool public attempted;

    function withdraw(DroidMintAccountLab target) external {
        account = target;
        target.withdrawNative(payable(address(this)), 0.01 ether);
    }

    receive() external payable {
        attempted = true;
        (nestedSucceeded,) = address(account).call(
            abi.encodeCall(DroidMintAccountLab.withdrawNative, (payable(address(this)), 0.01 ether))
        );
    }
}

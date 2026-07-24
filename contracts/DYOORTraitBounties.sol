// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IDYOOREnergyBankBountyCredit {
    function creditEnergy(address user, uint256 amount, bytes32 claimTxHash) external;
}

/// @title DYOORTraitBounties
/// @notice Enforces capped Energy bounties for verified D.Y.O.O.R Trait Lab reveals.
/// @dev A trusted processor verifies the append-only Trait Lab completion record off-chain.
///      This contract independently enforces the configured target, action, time window,
///      global cap, wallet cap, token cap, and one settlement per operation.
contract DYOORTraitBounties is Ownable, Pausable, ReentrancyGuard {
    uint8 public constant ACTION_REROLL = 1 << 0;
    uint8 public constant ACTION_UNLOCK = 1 << 1;
    uint8 public constant ACTION_REROLL_ALL = 1 << 2;
    uint8 public constant SUPPORTED_ACTION_MASK =
        ACTION_REROLL | ACTION_UNLOCK | ACTION_REROLL_ALL;

    IDYOOREnergyBankBountyCredit public immutable ENERGY_BANK;

    struct BountyInput {
        string label;
        string traitType;
        string traitValue;
        uint256 rewardRaw;
        uint32 maxClaims;
        uint16 perWalletLimit;
        uint16 perTokenLimit;
        uint8 actionMask;
        uint64 startsAt;
        uint64 endsAt;
    }

    struct Bounty {
        bool exists;
        bool active;
        string label;
        string traitType;
        string traitValue;
        bytes32 traitTypeHash;
        bytes32 traitValueHash;
        uint256 rewardRaw;
        uint32 maxClaims;
        uint32 totalClaims;
        uint16 perWalletLimit;
        uint16 perTokenLimit;
        uint8 actionMask;
        uint64 startsAt;
        uint64 endsAt;
    }

    struct SettlementInput {
        bytes32 bountyId;
        address wallet;
        bytes32 operationId;
        uint256 tokenId;
        uint8 action;
        uint64 completedAt;
        string traitType;
        string traitValue;
    }

    mapping(address processor => bool enabled) public processors;
    mapping(bytes32 bountyId => Bounty bounty) private _bounties;
    bytes32[] private _bountyIds;

    mapping(bytes32 settlementKey => bool settled) public settled;
    mapping(bytes32 settlementKey => address wallet) public settlementWallet;
    mapping(bytes32 bountyId => mapping(address wallet => uint32 count))
        public walletClaimCount;
    mapping(bytes32 bountyId => mapping(uint256 tokenId => uint32 count))
        public tokenClaimCount;

    event ProcessorUpdated(address indexed processor, bool enabled);
    event BountyCreated(
        bytes32 indexed bountyId,
        string label,
        string traitType,
        string traitValue
    );
    event BountyActiveUpdated(bytes32 indexed bountyId, bool active);
    event BountySettled(
        bytes32 indexed bountyId,
        address indexed wallet,
        bytes32 indexed settlementKey,
        bytes32 operationId,
        uint256 tokenId,
        uint256 rewardRaw,
        bytes32 energyClaim
    );

    error BountyAlreadyExists();
    error BountyClosed();
    error BountyDoesNotExist();
    error BountyEnded();
    error BountyNotStarted();
    error DuplicateSettlement();
    error GlobalClaimLimitReached();
    error InvalidAction();
    error InvalidBounty();
    error InvalidCompletionTime();
    error InvalidLabel();
    error InvalidTrait();
    error NotProcessor();
    error TokenClaimLimitReached();
    error TraitDoesNotMatch();
    error WalletClaimLimitReached();
    error ZeroAddress();

    constructor(
        address initialOwner,
        address energyBank,
        address initialProcessor
    ) Ownable(initialOwner) {
        if (energyBank == address(0) || initialProcessor == address(0)) {
            revert ZeroAddress();
        }
        ENERGY_BANK = IDYOOREnergyBankBountyCredit(energyBank);
        processors[initialProcessor] = true;
        emit ProcessorUpdated(initialProcessor, true);
    }

    modifier onlyProcessor() {
        if (!processors[msg.sender]) revert NotProcessor();
        _;
    }

    function createBounty(
        BountyInput calldata input
    ) external onlyOwner returns (bytes32 bountyId) {
        _validateLabel(input.label);
        if (
            bytes(input.traitType).length == 0
                || bytes(input.traitType).length > 64
                || bytes(input.traitValue).length == 0
                || bytes(input.traitValue).length > 128
        ) {
            revert InvalidTrait();
        }
        if (
            input.rewardRaw == 0
                || input.maxClaims == 0
                || input.perWalletLimit == 0
                || input.perWalletLimit > input.maxClaims
                || input.perTokenLimit == 0
                || input.perTokenLimit > input.maxClaims
                || input.actionMask == 0
                || input.actionMask & ~SUPPORTED_ACTION_MASK != 0
                || (input.endsAt != 0 && input.endsAt <= input.startsAt)
        ) {
            revert InvalidBounty();
        }

        bountyId = bountyIdForLabel(input.label);
        if (_bounties[bountyId].exists) revert BountyAlreadyExists();

        _bounties[bountyId] = Bounty({
            exists: true,
            active: false,
            label: input.label,
            traitType: input.traitType,
            traitValue: input.traitValue,
            traitTypeHash: keccak256(bytes(input.traitType)),
            traitValueHash: keccak256(bytes(input.traitValue)),
            rewardRaw: input.rewardRaw,
            maxClaims: input.maxClaims,
            totalClaims: 0,
            perWalletLimit: input.perWalletLimit,
            perTokenLimit: input.perTokenLimit,
            actionMask: input.actionMask,
            startsAt: input.startsAt,
            endsAt: input.endsAt
        });
        _bountyIds.push(bountyId);

        emit BountyCreated(
            bountyId,
            input.label,
            input.traitType,
            input.traitValue
        );
    }

    function setBountyActive(
        bytes32 bountyId,
        bool active
    ) external onlyOwner {
        Bounty storage bounty = _requireBounty(bountyId);
        if (active && bounty.totalClaims >= bounty.maxClaims) {
            revert GlobalClaimLimitReached();
        }
        bounty.active = active;
        emit BountyActiveUpdated(bountyId, active);
    }

    function setProcessor(address processor, bool enabled) external onlyOwner {
        if (processor == address(0)) revert ZeroAddress();
        processors[processor] = enabled;
        emit ProcessorUpdated(processor, enabled);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function settleBounty(
        SettlementInput calldata input
    )
        external
        onlyProcessor
        whenNotPaused
        nonReentrant
        returns (bytes32 settlementKey, bytes32 energyClaim)
    {
        if (input.wallet == address(0)) revert ZeroAddress();
        if (input.operationId == bytes32(0) || input.tokenId == 0) {
            revert InvalidBounty();
        }

        Bounty storage bounty = _requireBounty(input.bountyId);
        if (!bounty.active) revert BountyClosed();
        if (
            input.action == 0
                || input.action & ~SUPPORTED_ACTION_MASK != 0
        ) {
            revert InvalidAction();
        }
        if (bounty.actionMask & input.action == 0) revert InvalidAction();
        if (
            keccak256(bytes(input.traitType)) != bounty.traitTypeHash
                || keccak256(bytes(input.traitValue)) != bounty.traitValueHash
        ) {
            revert TraitDoesNotMatch();
        }
        if (input.completedAt == 0 || input.completedAt > block.timestamp) {
            revert InvalidCompletionTime();
        }
        if (input.completedAt < bounty.startsAt) revert BountyNotStarted();
        if (bounty.endsAt != 0 && input.completedAt > bounty.endsAt) {
            revert BountyEnded();
        }

        settlementKey = settlementKeyFor(
            input.bountyId,
            input.operationId,
            input.tokenId,
            input.traitType,
            input.traitValue
        );
        if (settled[settlementKey]) revert DuplicateSettlement();

        if (bounty.totalClaims >= bounty.maxClaims) {
            revert GlobalClaimLimitReached();
        }
        if (
            walletClaimCount[input.bountyId][input.wallet]
                >= bounty.perWalletLimit
        ) {
            revert WalletClaimLimitReached();
        }
        if (
            tokenClaimCount[input.bountyId][input.tokenId]
                >= bounty.perTokenLimit
        ) {
            revert TokenClaimLimitReached();
        }

        settled[settlementKey] = true;
        settlementWallet[settlementKey] = input.wallet;
        unchecked {
            bounty.totalClaims += 1;
            walletClaimCount[input.bountyId][input.wallet] += 1;
            tokenClaimCount[input.bountyId][input.tokenId] += 1;
        }

        energyClaim = keccak256(
            abi.encode(
                "DYOOR_TRAIT_BOUNTY_V1",
                block.chainid,
                address(this),
                input.bountyId,
                settlementKey,
                input.wallet,
                bounty.rewardRaw
            )
        );
        ENERGY_BANK.creditEnergy(input.wallet, bounty.rewardRaw, energyClaim);

        emit BountySettled(
            input.bountyId,
            input.wallet,
            settlementKey,
            input.operationId,
            input.tokenId,
            bounty.rewardRaw,
            energyClaim
        );
    }

    function bountyIdForLabel(
        string memory label
    ) public pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function settlementKeyFor(
        bytes32 bountyId,
        bytes32 operationId,
        uint256 tokenId,
        string memory traitType,
        string memory traitValue
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                bountyId,
                operationId,
                tokenId,
                keccak256(bytes(traitType)),
                keccak256(bytes(traitValue))
            )
        );
    }

    function bountyCount() external view returns (uint256) {
        return _bountyIds.length;
    }

    function bountyIdAt(uint256 index) external view returns (bytes32) {
        return _bountyIds[index];
    }

    function getBounty(
        bytes32 bountyId
    ) external view returns (Bounty memory) {
        return _requireBounty(bountyId);
    }

    function remainingClaims(
        bytes32 bountyId
    ) external view returns (uint256) {
        Bounty storage bounty = _requireBounty(bountyId);
        return bounty.maxClaims - bounty.totalClaims;
    }

    function _requireBounty(
        bytes32 bountyId
    ) private view returns (Bounty storage bounty) {
        bounty = _bounties[bountyId];
        if (!bounty.exists) revert BountyDoesNotExist();
    }

    function _validateLabel(string memory label) private pure {
        bytes memory value = bytes(label);
        if (value.length < 3 || value.length > 48) revert InvalidLabel();
        if (value[0] == "-" || value[value.length - 1] == "-") {
            revert InvalidLabel();
        }

        bool previousHyphen;
        for (uint256 index = 0; index < value.length; ) {
            bytes1 character = value[index];
            bool isLowercaseLetter =
                character >= bytes1("a") && character <= bytes1("z");
            bool isNumber =
                character >= bytes1("0") && character <= bytes1("9");
            bool isHyphen = character == bytes1("-");
            if (!isLowercaseLetter && !isNumber && !isHyphen) {
                revert InvalidLabel();
            }
            if (isHyphen && previousHyphen) revert InvalidLabel();
            previousHyphen = isHyphen;
            unchecked {
                ++index;
            }
        }
    }
}

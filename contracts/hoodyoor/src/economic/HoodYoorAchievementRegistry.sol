// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IHoodYoorDroidRegistry } from "./interfaces/IHoodYoorDroidRegistry.sol";

/// @title HoodYoorAchievementRegistry
/// @notice Persistent, transparent Droid achievements for optional capped snapshot modifiers.
contract HoodYoorAchievementRegistry is AccessControlDefaultAdminRules, Pausable {
    bytes32 public constant ACHIEVEMENT_MANAGER_ROLE = keccak256("ACHIEVEMENT_MANAGER_ROLE");
    bytes32 public constant ACHIEVEMENT_ISSUER_ROLE = keccak256("ACHIEVEMENT_ISSUER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint48 public constant ADMIN_TRANSFER_DELAY = 2 days;
    uint16 public constant MAX_ACHIEVEMENT_MODIFIER_BPS = 500;
    uint16 public constant MAX_TOTAL_MODIFIER_BPS = 2_000;

    struct AchievementDefinition {
        bool exists;
        bool enabled;
        uint32 version;
        uint16 rewardModifierBps;
        string metadataURI;
    }

    struct DroidAchievement {
        bool awarded;
        uint32 definitionVersion;
        uint16 rewardModifierBps;
        uint48 awardedAt;
        bytes32 evidenceHash;
    }

    IHoodYoorDroidRegistry public immutable droidRegistry;
    mapping(bytes32 achievementId => AchievementDefinition definition) public definitions;
    mapping(bytes32 droidKey => mapping(bytes32 achievementId => DroidAchievement achievement))
        public achievements;
    mapping(bytes32 droidKey => uint16 totalModifierBps) public totalRewardModifierBps;

    error ZeroAddress();
    error InvalidContract(address target);
    error InvalidAchievementId();
    error ModifierTooLarge(uint256 supplied, uint256 maximum);
    error AchievementNotFound(bytes32 achievementId);
    error AchievementDisabled(bytes32 achievementId);
    error AchievementAlreadyAwarded(bytes32 droidKey, bytes32 achievementId);
    error TotalModifierTooLarge(uint256 supplied, uint256 maximum);

    event AchievementConfigured(
        bytes32 indexed achievementId,
        uint32 indexed version,
        uint16 rewardModifierBps,
        bool enabled,
        string metadataURI
    );
    event AchievementStatusUpdated(bytes32 indexed achievementId, bool enabled);
    event AchievementAwarded(
        bytes32 indexed droidKey,
        bytes32 indexed achievementId,
        address indexed collection,
        uint256 tokenId,
        uint32 definitionVersion,
        uint16 rewardModifierBps,
        bytes32 evidenceHash,
        address issuer
    );

    constructor(address initialAdmin, address droidRegistry_)
        AccessControlDefaultAdminRules(ADMIN_TRANSFER_DELAY, initialAdmin)
    {
        if (droidRegistry_ == address(0)) revert ZeroAddress();
        if (droidRegistry_.code.length == 0) revert InvalidContract(droidRegistry_);
        droidRegistry = IHoodYoorDroidRegistry(droidRegistry_);
        _grantRole(ACHIEVEMENT_MANAGER_ROLE, initialAdmin);
        _grantRole(ACHIEVEMENT_ISSUER_ROLE, initialAdmin);
        _grantRole(PAUSER_ROLE, initialAdmin);
    }

    function configureAchievement(
        bytes32 achievementId,
        uint16 rewardModifierBps,
        bool enabled,
        string calldata metadataURI
    ) external onlyRole(ACHIEVEMENT_MANAGER_ROLE) {
        if (achievementId == bytes32(0)) revert InvalidAchievementId();
        if (rewardModifierBps > MAX_ACHIEVEMENT_MODIFIER_BPS) {
            revert ModifierTooLarge(rewardModifierBps, MAX_ACHIEVEMENT_MODIFIER_BPS);
        }
        AchievementDefinition storage definition = definitions[achievementId];
        uint32 nextVersion = definition.version + 1;
        definitions[achievementId] = AchievementDefinition({
            exists: true,
            enabled: enabled,
            version: nextVersion,
            rewardModifierBps: rewardModifierBps,
            metadataURI: metadataURI
        });
        emit AchievementConfigured(
            achievementId, nextVersion, rewardModifierBps, enabled, metadataURI
        );
    }

    function setAchievementEnabled(bytes32 achievementId, bool enabled)
        external
        onlyRole(ACHIEVEMENT_MANAGER_ROLE)
    {
        AchievementDefinition storage definition = definitions[achievementId];
        if (!definition.exists) revert AchievementNotFound(achievementId);
        definition.enabled = enabled;
        emit AchievementStatusUpdated(achievementId, enabled);
    }

    function award(address collection, uint256 tokenId, bytes32 achievementId, bytes32 evidenceHash)
        external
        onlyRole(ACHIEVEMENT_ISSUER_ROLE)
        whenNotPaused
    {
        AchievementDefinition storage definition = definitions[achievementId];
        if (!definition.exists) revert AchievementNotFound(achievementId);
        if (!definition.enabled) revert AchievementDisabled(achievementId);

        // Existence and collection eligibility are resolved live by the registry.
        droidRegistry.ownerOf(collection, tokenId);
        bytes32 key = droidRegistry.droidKey(collection, tokenId);
        DroidAchievement storage existing = achievements[key][achievementId];
        if (existing.awarded) revert AchievementAlreadyAwarded(key, achievementId);

        uint256 nextTotal = totalRewardModifierBps[key] + definition.rewardModifierBps;
        if (nextTotal > MAX_TOTAL_MODIFIER_BPS) {
            revert TotalModifierTooLarge(nextTotal, MAX_TOTAL_MODIFIER_BPS);
        }
        totalRewardModifierBps[key] = uint16(nextTotal);
        achievements[key][achievementId] = DroidAchievement({
            awarded: true,
            definitionVersion: definition.version,
            rewardModifierBps: definition.rewardModifierBps,
            awardedAt: uint48(block.timestamp),
            evidenceHash: evidenceHash
        });
        emit AchievementAwarded(
            key,
            achievementId,
            collection,
            tokenId,
            definition.version,
            definition.rewardModifierBps,
            evidenceHash,
            msg.sender
        );
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}

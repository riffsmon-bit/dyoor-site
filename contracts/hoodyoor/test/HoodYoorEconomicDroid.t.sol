// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { HoodYoorAchievementRegistry } from "../src/economic/HoodYoorAchievementRegistry.sol";
import { HoodYoorAssetRegistry } from "../src/economic/HoodYoorAssetRegistry.sol";
import { HoodYoorDroidRegistry } from "../src/economic/HoodYoorDroidRegistry.sol";
import { HoodYoorRevenueVault } from "../src/economic/HoodYoorRevenueVault.sol";
import { HoodYoorRewardsDistributor } from "../src/economic/HoodYoorRewardsDistributor.sol";
import { HoodYoorStrategyRegistry } from "../src/economic/HoodYoorStrategyRegistry.sol";

interface EconomicVm {
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function warp(uint256 newTimestamp) external;
}

contract EconomicMockNft {
    mapping(uint256 tokenId => address owner) private _owners;

    error NotOwner();

    function mint(address to, uint256 tokenId) external {
        require(to != address(0) && _owners[tokenId] == address(0), "invalid mint");
        _owners[tokenId] = to;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "missing token");
        return tokenOwner;
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        if (msg.sender != from || _owners[tokenId] != from) revert NotOwner();
        require(to != address(0), "zero recipient");
        _owners[tokenId] = to;
    }
}

contract EconomicMockResolver {
    address public immutable tokenContract;
    uint256 public immutable tokenChainId;
    mapping(uint256 tokenId => address accountAddress) public accounts;

    constructor(address tokenContract_) {
        tokenContract = tokenContract_;
        tokenChainId = block.chainid;
    }

    function setAccount(uint256 tokenId, address accountAddress) external {
        accounts[tokenId] = accountAddress;
    }

    function account(uint256 tokenId) external view returns (address) {
        return accounts[tokenId];
    }
}

contract EconomicWrongChainResolver {
    address public immutable tokenContract;

    constructor(address tokenContract_) {
        tokenContract = tokenContract_;
    }

    function tokenChainId() external view returns (uint256) {
        return block.chainid + 1;
    }

    function account(uint256) external pure returns (address) {
        return address(0xD00D);
    }
}

contract EconomicDroidReceiver {
    receive() external payable { }
}

contract EconomicReentrantReceiver {
    address public target;
    bytes public reentryData;
    bool public reentryBlocked;

    function configure(address target_, bytes calldata reentryData_) external {
        target = target_;
        reentryData = reentryData_;
    }

    receive() external payable {
        (bool success,) = target.call(reentryData);
        reentryBlocked = !success;
    }
}

contract EconomicMockErc20 is IERC20Metadata {
    string public override name;
    string public override symbol;
    uint8 public immutable override decimals;
    uint256 public override totalSupply;
    uint16 public feeBps;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackBlocked;

    mapping(address account => uint256 amount) public override balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public override allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function setFeeBps(uint16 nextFeeBps) external {
        feeBps = nextFeeBps;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
        callbackBlocked = false;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        override
        returns (bool)
    {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "allowance");
        allowance[from][msg.sender] = approved - amount;
        if (callbackTarget != address(0)) {
            (bool success,) = callbackTarget.call(callbackData);
            callbackBlocked = !success;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        uint256 fee = (amount * feeBps) / 10_000;
        uint256 received = amount - fee;
        balanceOf[to] += received;
        if (fee != 0) {
            totalSupply -= fee;
            emit Transfer(from, address(0), fee);
        }
        emit Transfer(from, to, received);
    }
}

    contract HoodYoorEconomicDroidTest {
        EconomicVm private constant VM =
            EconomicVm(address(uint160(uint256(keccak256("hevm cheat code")))));

        address private constant ALICE = address(0xA11CE);
        address private constant BOB = address(0xB0B);
        address private constant TREASURY = address(0x7EA5);
        address private constant OTHER_DESTINATION = address(0x07E2);
        uint256 private constant TOKEN_ID = 420;
        uint32 private constant ACCOUNT_VERSION = 1;
        uint16 private constant TREASURY_BPS = 4_000;
        uint16 private constant REWARD_BPS = 6_000;
        uint16 private constant OTHER_BPS = 0;

        EconomicMockNft private collection;
        EconomicMockResolver private resolver;
        EconomicDroidReceiver private droidAccount;
        HoodYoorDroidRegistry private droidRegistry;
        HoodYoorAssetRegistry private assetRegistry;
        HoodYoorRewardsDistributor private distributor;
        HoodYoorRevenueVault private vault;
        HoodYoorStrategyRegistry private strategyRegistry;
        HoodYoorAchievementRegistry private achievementRegistry;

        function setUp() public {
            collection = new EconomicMockNft();
            collection.mint(ALICE, TOKEN_ID);
            resolver = new EconomicMockResolver(address(collection));
            droidAccount = new EconomicDroidReceiver();
            resolver.setAccount(TOKEN_ID, address(droidAccount));

            droidRegistry = new HoodYoorDroidRegistry(address(this));
            droidRegistry.registerCollection(address(collection), "ipfs://collection");
            droidRegistry.registerAccountVersion(
                address(collection), ACCOUNT_VERSION, address(resolver), "ipfs://account-v1"
            );

            assetRegistry = new HoodYoorAssetRegistry(address(this));
            assetRegistry.configureAsset(
                address(0),
                HoodYoorAssetRegistry.AssetType.NATIVE,
                18,
                "ETH",
                "Ether",
                true,
                true,
                false,
                "ipfs://eth"
            );

            distributor = new HoodYoorRewardsDistributor(
                address(this), address(droidRegistry), address(assetRegistry)
            );
            vault = new HoodYoorRevenueVault(
                address(this),
                address(assetRegistry),
                TREASURY,
                address(distributor),
                OTHER_DESTINATION,
                TREASURY_BPS,
                REWARD_BPS,
                OTHER_BPS
            );
            distributor.configureFundingVault(address(vault));
            vault.setRevenueSource(address(this), true);

            strategyRegistry = new HoodYoorStrategyRegistry(
                address(this), address(droidRegistry), address(assetRegistry)
            );
            achievementRegistry =
                new HoodYoorAchievementRegistry(address(this), address(droidRegistry));
            VM.deal(address(this), 100 ether);
        }

        function testCanonicalIdentityIncludesChainCollectionAndToken() public {
            bytes32 key = droidRegistry.droidKey(address(collection), TOKEN_ID);
            require(
                key == keccak256(abi.encode(block.chainid, address(collection), TOKEN_ID)),
                "canonical key"
            );

            EconomicMockNft sibling = new EconomicMockNft();
            require(
                droidRegistry.droidKey(address(sibling), TOKEN_ID) != key, "collection collision"
            );
            require(
                keccak256(abi.encode(block.chainid + 1, address(collection), TOKEN_ID)) != key,
                "chain collision"
            );
        }

        function testAccountResolverVersionCannotBeReplacedOrUseWrongChain() public {
            EconomicMockResolver replacement = new EconomicMockResolver(address(collection));
            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorDroidRegistry.AccountVersionAlreadyRegistered.selector,
                    address(collection),
                    ACCOUNT_VERSION
                )
            );
            droidRegistry.registerAccountVersion(
                address(collection), ACCOUNT_VERSION, address(replacement), "replacement"
            );

            EconomicWrongChainResolver wrong = new EconomicWrongChainResolver(address(collection));
            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorDroidRegistry.ResolverChainMismatch.selector,
                    block.chainid,
                    block.chainid + 1
                )
            );
            droidRegistry.registerAccountVersion(address(collection), 2, address(wrong), "wrong");
        }

        function testNativeRevenueSplitAndClaimFollowsCurrentNftOwner() public {
            vault.depositNative{ value: 10 ether }(keccak256("platform-revenue-1"));
            require(vault.treasuryAccrued(address(0)) == 4 ether, "treasury split");
            require(vault.rewardsAccrued(address(0)) == 6 ether, "reward split");
            vault.releaseRewards(address(0), 6 ether);

            bytes32 epochId = keccak256("epoch-native-1");
            bytes32 strategyId = keccak256("manual-settlement");
            uint256 weight = 125;
            uint256 amount = 5 ether;
            bytes32 leaf = distributor.rewardLeaf(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                address(droidAccount),
                strategyId,
                weight,
                amount
            );
            _createEpoch(epochId, address(0), leaf, amount);

            VM.prank(ALICE);
            collection.transferFrom(ALICE, BOB, TOKEN_ID);

            bytes32[] memory proof = new bytes32[](0);
            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorRewardsDistributor.NotCurrentDroidOwner.selector, ALICE, BOB
                )
            );
            VM.prank(ALICE);
            distributor.claim(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                strategyId,
                weight,
                amount,
                proof
            );

            VM.prank(BOB);
            distributor.claim(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                strategyId,
                weight,
                amount,
                proof
            );
            require(address(droidAccount).balance == amount, "claim must reach Droid");
            require(BOB.balance == 0, "owner wallet must not receive reward");

            bytes32 key = droidRegistry.droidKey(address(collection), TOKEN_ID);
            require(distributor.lifetimeRewards(key, address(0)) == amount, "lifetime reward");
            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorRewardsDistributor.AlreadyClaimed.selector, epochId, key
                )
            );
            VM.prank(BOB);
            distributor.claim(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                strategyId,
                weight,
                amount,
                proof
            );
        }

        function testRevenueIdsCannotReplayOrBeZero() public {
            bytes32 revenueId = keccak256("unique-revenue");
            vault.depositNative{ value: 1 ether }(revenueId);

            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorRevenueVault.RevenueIdAlreadyUsed.selector, revenueId
                )
            );
            vault.depositNative{ value: 1 ether }(revenueId);

            VM.expectRevert(HoodYoorRevenueVault.InvalidRevenueId.selector);
            vault.depositNative{ value: 1 ether }(bytes32(0));
        }

        function testClaimCannotExceedPublishedEpochAllocation() public {
            vault.depositNative{ value: 2 ether }(keccak256("allocation-bound-funding"));
            vault.releaseRewards(address(0), 1 ether);

            bytes32 epochId = keccak256("allocation-bound-epoch");
            bytes32 leaf = distributor.rewardLeaf(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                address(droidAccount),
                bytes32(0),
                1,
                2 ether
            );
            _createEpoch(epochId, address(0), leaf, 1 ether);

            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorRewardsDistributor.ClaimExceedsRemainingAllocation.selector,
                    1 ether,
                    2 ether
                )
            );
            VM.prank(ALICE);
            distributor.claim(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                bytes32(0),
                1,
                2 ether,
                new bytes32[](0)
            );
        }

        function testClaimRequiresActiveAccountAndValidProof() public {
            address counterfactual = address(0xD00D);
            resolver.setAccount(TOKEN_ID, counterfactual);
            vault.depositNative{ value: 2 ether }(keccak256("inactive-account-funding"));
            vault.releaseRewards(address(0), 1 ether);

            bytes32 epochId = keccak256("inactive-epoch");
            bytes32 leaf = distributor.rewardLeaf(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                counterfactual,
                bytes32(0),
                1,
                1 ether
            );
            _createEpoch(epochId, address(0), leaf, 1 ether);
            bytes32[] memory proof = new bytes32[](0);

            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorRewardsDistributor.DroidAccountNotActive.selector, counterfactual
                )
            );
            VM.prank(ALICE);
            distributor.claim(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                bytes32(0),
                1,
                1 ether,
                proof
            );

            resolver.setAccount(TOKEN_ID, address(droidAccount));
            VM.expectRevert(HoodYoorRewardsDistributor.InvalidRewardProof.selector);
            VM.prank(ALICE);
            distributor.claim(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                bytes32(0),
                1,
                1 ether,
                proof
            );
        }

        function testErc20RevenueAndRewardsUseExactSafeAccounting() public {
            EconomicMockErc20 token = new EconomicMockErc20("Settlement", "SET", 6);
            assetRegistry.configureAsset(
                address(token),
                HoodYoorAssetRegistry.AssetType.ERC20,
                6,
                "SET",
                "Settlement",
                true,
                true,
                false,
                "ipfs://set"
            );
            token.mint(address(this), 1_000_000);
            token.approve(address(vault), 1_000_000);
            vault.depositToken(keccak256("token-revenue"), address(token), 1_000_000);
            require(vault.treasuryAccrued(address(token)) == 400_000, "token treasury split");
            require(vault.rewardsAccrued(address(token)) == 600_000, "token reward split");
            vault.releaseRewards(address(token), 600_000);

            bytes32 epochId = keccak256("token-epoch");
            bytes32 leaf = distributor.rewardLeaf(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                address(droidAccount),
                bytes32(0),
                50,
                500_000
            );
            _createEpoch(epochId, address(token), leaf, 500_000);
            bytes32[] memory proof = new bytes32[](0);
            VM.prank(ALICE);
            distributor.claim(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                bytes32(0),
                50,
                500_000,
                proof
            );
            require(token.balanceOf(address(droidAccount)) == 500_000, "token reaches Droid");
        }

        function testFeeOnTransferRevenueIsRejected() public {
            EconomicMockErc20 token = new EconomicMockErc20("Fee Token", "FEE", 18);
            token.setFeeBps(1_000);
            assetRegistry.configureAsset(
                address(token),
                HoodYoorAssetRegistry.AssetType.ERC20,
                18,
                "FEE",
                "Fee Token",
                true,
                false,
                false,
                "ipfs://fee"
            );
            token.mint(address(this), 1_000);
            token.approve(address(vault), 1_000);
            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorRevenueVault.ExactTransferRequired.selector, 1_000, 900
                )
            );
            vault.depositToken(keccak256("fee-token"), address(token), 1_000);
            require(token.balanceOf(address(this)) == 1_000, "revert restores token balance");
        }

        function testMaliciousTokenCallbackCannotReenterDeposit() public {
            EconomicMockErc20 token = new EconomicMockErc20("Callback", "CALL", 18);
            assetRegistry.configureAsset(
                address(token),
                HoodYoorAssetRegistry.AssetType.ERC20,
                18,
                "CALL",
                "Callback Token",
                true,
                false,
                false,
                "ipfs://call"
            );
            token.mint(address(this), 1_000);
            token.approve(address(vault), 1_000);
            token.setCallback(
                address(vault),
                abi.encodeCall(
                    vault.depositToken, (keccak256("reentry"), address(token), uint256(1))
                )
            );
            vault.depositToken(keccak256("outer"), address(token), 1_000);
            require(token.callbackBlocked(), "callback must be blocked");
            require(vault.lifetimeRevenue(address(token)) == 1_000, "single deposit only");
        }

        function testNativeClaimCannotReenterDistributor() public {
            EconomicReentrantReceiver receiver = new EconomicReentrantReceiver();
            resolver.setAccount(TOKEN_ID, address(receiver));
            vault.depositNative{ value: 2 ether }(keccak256("reentrant-funding"));
            vault.releaseRewards(address(0), 1 ether);

            bytes32 epochId = keccak256("reentrant-epoch");
            bytes32 leaf = distributor.rewardLeaf(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                address(receiver),
                bytes32(0),
                1,
                1 ether
            );
            _createEpoch(epochId, address(0), leaf, 1 ether);
            bytes32[] memory proof = new bytes32[](0);
            bytes memory reentry = abi.encodeCall(
                distributor.claim,
                (
                    epochId,
                    address(collection),
                    TOKEN_ID,
                    ACCOUNT_VERSION,
                    bytes32(0),
                    uint256(1),
                    uint256(1 ether),
                    proof
                )
            );
            receiver.configure(address(distributor), reentry);
            VM.prank(ALICE);
            distributor.claim(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                bytes32(0),
                1,
                1 ether,
                proof
            );
            require(receiver.reentryBlocked(), "claim reentry must fail");
            require(address(receiver).balance == 1 ether, "single payout");
        }

        function testPauseStopsClaimsWithoutBlockingExistingDroidOwnerFunds() public {
            vault.depositNative{ value: 2 ether }(keccak256("pause-funding"));
            vault.releaseRewards(address(0), 1 ether);
            bytes32 epochId = keccak256("pause-epoch");
            bytes32 leaf = distributor.rewardLeaf(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                address(droidAccount),
                bytes32(0),
                1,
                1 ether
            );
            _createEpoch(epochId, address(0), leaf, 1 ether);
            distributor.pause();
            bytes32[] memory proof = new bytes32[](0);
            VM.expectRevert(bytes4(keccak256("EnforcedPause()")));
            VM.prank(ALICE);
            distributor.claim(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                bytes32(0),
                1,
                1 ether,
                proof
            );

            // The economic pause does not call or pause DroidAccountV1 owner execution.
            require(
                droidRegistry.ownerOf(address(collection), TOKEN_ID) == ALICE, "owner unchanged"
            );
        }

        function testStrategySelectionIsOwnerControlledVersionedAndMovesNoAssets() public {
            bytes32 strategyId = keccak256("generic-strategy-a");
            address[] memory assets = new address[](1);
            assets[0] = address(0);
            uint16[] memory targetBps = new uint16[](1);
            targetBps[0] = 10_000;
            uint32 version = strategyRegistry.configureStrategyVersion(
                strategyId, address(0), "ipfs://strategy-v1", "ipfs://risk-v1", assets, targetBps
            );
            require(version == 1, "first version");

            VM.prank(ALICE);
            strategyRegistry.selectStrategy(address(collection), TOKEN_ID, strategyId);
            bytes32 key = droidRegistry.droidKey(address(collection), TOKEN_ID);
            (bytes32 selectedId, uint32 selectedVersion,) = strategyRegistry.selections(key);
            require(selectedId == strategyId && selectedVersion == 1, "selection snapshot");

            strategyRegistry.configureStrategyVersion(
                strategyId, address(0), "ipfs://strategy-v2", "ipfs://risk-v2", assets, targetBps
            );
            (, selectedVersion,) = strategyRegistry.selections(key);
            require(selectedVersion == 1, "config update must not rewrite selection");

            VM.prank(ALICE);
            collection.transferFrom(ALICE, BOB, TOKEN_ID);
            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorStrategyRegistry.NotCurrentDroidOwner.selector, ALICE, BOB
                )
            );
            VM.prank(ALICE);
            strategyRegistry.clearStrategy(address(collection), TOKEN_ID);

            VM.prank(BOB);
            strategyRegistry.selectStrategy(address(collection), TOKEN_ID, strategyId);
            (, selectedVersion,) = strategyRegistry.selections(key);
            require(selectedVersion == 2, "new owner selects latest version");
            require(address(droidAccount).balance == 0, "strategy selection moves no assets");
        }

        function testAchievementsAreTransparentPersistentAndCapped() public {
            for (uint256 i; i < 5; ++i) {
                bytes32 achievementId = keccak256(abi.encode("achievement", i));
                achievementRegistry.configureAchievement(
                    achievementId, 500, true, "ipfs://achievement"
                );
                if (i == 4) {
                    VM.expectRevert(
                        abi.encodeWithSelector(
                            HoodYoorAchievementRegistry.TotalModifierTooLarge.selector, 2_500, 2_000
                        )
                    );
                }
                achievementRegistry.award(
                    address(collection),
                    TOKEN_ID,
                    achievementId,
                    keccak256(abi.encode("evidence", i))
                );
            }
            bytes32 key = droidRegistry.droidKey(address(collection), TOKEN_ID);
            require(achievementRegistry.totalRewardModifierBps(key) == 2_000, "capped total");
        }

        function testVaultRecoveryCannotTouchAccountedRevenue() public {
            VM.deal(TREASURY, 0);
            vault.depositNative{ value: 10 ether }(keccak256("accounted"));
            VM.deal(address(vault), 11 ether);
            vault.pause();
            uint256 recovered = vault.recoverExcess(address(0));
            require(recovered == 1 ether, "excess only");
            require(TREASURY.balance == 1 ether, "fixed treasury destination");
            require(vault.accountedBalance(address(0)) == 10 ether, "accounting preserved");
            require(address(vault).balance == 10 ether, "accounted funds remain");

            VM.expectRevert(HoodYoorRevenueVault.NoExcessBalance.selector);
            vault.recoverExcess(address(0));
        }

        function testExpiredEpochReleasesReservationButNotFundsToAdmin() public {
            vault.depositNative{ value: 2 ether }(keccak256("expiry-funding"));
            vault.releaseRewards(address(0), 1 ether);
            bytes32 epochId = keccak256("expiry-epoch");
            bytes32 leaf = distributor.rewardLeaf(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                address(droidAccount),
                bytes32(0),
                1,
                1 ether
            );
            uint48 startsAt = uint48(block.timestamp);
            uint48 endsAt = startsAt + 1 days;
            distributor.createEpoch(
                epochId,
                address(0),
                leaf,
                1 ether,
                startsAt,
                endsAt,
                keccak256("manifest"),
                "ipfs://manifest"
            );
            VM.warp(endsAt + 1);
            distributor.closeExpiredEpoch(epochId);
            require(distributor.reservedByAsset(address(0)) == 0, "reservation released");
            require(address(distributor).balance == 1 ether, "funds remain reward backing");
        }

        function testPreMintLifecycleSupportsMultipleMintsAndPreservesHistoricalAssets() public {
            uint256 secondTokenId = TOKEN_ID + 1;
            EconomicDroidReceiver secondAccount = new EconomicDroidReceiver();
            collection.mint(BOB, secondTokenId);
            resolver.setAccount(secondTokenId, address(secondAccount));

            require(collection.ownerOf(TOKEN_ID) == ALICE, "first mint owner");
            require(collection.ownerOf(secondTokenId) == BOB, "second mint owner");
            require(
                droidRegistry.droidKey(address(collection), TOKEN_ID)
                    != droidRegistry.droidKey(address(collection), secondTokenId),
                "mint identity collision"
            );

            VM.deal(address(droidAccount), 3 ether);
            vault.depositNative{ value: 2 ether }(keccak256("historical-asset-funding"));
            vault.releaseRewards(address(0), 1 ether);
            bytes32 epochId = keccak256("no-strategy-epoch");
            bytes32 leaf = distributor.rewardLeaf(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                address(droidAccount),
                bytes32(0),
                1,
                1 ether
            );
            _createEpoch(epochId, address(0), leaf, 1 ether);

            VM.prank(ALICE);
            distributor.claim(
                epochId,
                address(collection),
                TOKEN_ID,
                ACCOUNT_VERSION,
                bytes32(0),
                1,
                1 ether,
                new bytes32[](0)
            );
            require(address(droidAccount).balance == 4 ether, "historical assets changed");

            bytes32 key = droidRegistry.droidKey(address(collection), TOKEN_ID);
            (bytes32 strategyId,,) = strategyRegistry.selections(key);
            require(strategyId == bytes32(0), "strategy invented");
        }

        function testDisabledStrategiesAssetsAndPausedModulesFailClosed() public {
            bytes32 strategyId = keccak256("disable-me");
            address[] memory assets = new address[](1);
            assets[0] = address(0);
            uint16[] memory allocations = new uint16[](1);
            allocations[0] = 10_000;
            strategyRegistry.configureStrategyVersion(
                strategyId, address(0), "ipfs://strategy", "ipfs://risk", assets, allocations
            );
            strategyRegistry.setStrategyEnabled(strategyId, false);

            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorStrategyRegistry.StrategyDisabled.selector, strategyId
                )
            );
            VM.prank(ALICE);
            strategyRegistry.selectStrategy(address(collection), TOKEN_ID, strategyId);

            strategyRegistry.setStrategyEnabled(strategyId, true);
            strategyRegistry.pause();
            VM.expectRevert(bytes4(keccak256("EnforcedPause()")));
            VM.prank(ALICE);
            strategyRegistry.selectStrategy(address(collection), TOKEN_ID, strategyId);

            assetRegistry.setAssetEnabled(address(0), false);
            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorRewardsDistributor.AssetNotEnabled.selector, address(0)
                )
            );
            distributor.createEpoch(
                keccak256("disabled-asset-epoch"),
                address(0),
                keccak256("root"),
                1,
                uint48(block.timestamp),
                uint48(block.timestamp + 1 days),
                keccak256("manifest"),
                "ipfs://manifest"
            );

            EconomicMockErc20 unsupported = new EconomicMockErc20("Unknown", "UNK", 18);
            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorRewardsDistributor.AssetNotEnabled.selector, address(unsupported)
                )
            );
            distributor.createEpoch(
                keccak256("unsupported-asset-epoch"),
                address(unsupported),
                keccak256("other-root"),
                1,
                uint48(block.timestamp),
                uint48(block.timestamp + 1 days),
                keccak256("other-manifest"),
                "ipfs://manifest"
            );
        }

        function testTreasurySplitValidationDoesNotChooseGovernancePolicy() public {
            VM.expectRevert(
                abi.encodeWithSelector(HoodYoorRevenueVault.InvalidAllocation.selector, 10_001)
            );
            new HoodYoorRevenueVault(
                address(this),
                address(assetRegistry),
                TREASURY,
                address(distributor),
                OTHER_DESTINATION,
                4_000,
                6_000,
                1
            );

            VM.expectRevert(
                abi.encodeWithSelector(HoodYoorRevenueVault.InvalidAllocation.selector, 10_001)
            );
            vault.setAllocationBps(4_000, 6_000, 1);
            require(vault.treasuryBps() == TREASURY_BPS, "invalid split changed state");
            require(vault.rewardBps() == REWARD_BPS, "invalid reward split changed state");
            require(vault.otherBps() == OTHER_BPS, "invalid other split changed state");
        }

        function testOtherApprovedAllocationIsSeparateAndExactlyAccounted() public {
            HoodYoorRevenueVault threeWayVault = new HoodYoorRevenueVault(
                address(this),
                address(assetRegistry),
                TREASURY,
                address(distributor),
                OTHER_DESTINATION,
                4_000,
                5_000,
                1_000
            );
            threeWayVault.setRevenueSource(address(this), true);
            threeWayVault.depositNative{ value: 10 ether }(keccak256("three-way-revenue"));

            require(threeWayVault.treasuryAccrued(address(0)) == 4 ether, "treasury share");
            require(threeWayVault.rewardsAccrued(address(0)) == 5 ether, "reward share");
            require(threeWayVault.otherAccrued(address(0)) == 1 ether, "other share");
            require(threeWayVault.accountedBalance(address(0)) == 10 ether, "three-way total");

            VM.deal(OTHER_DESTINATION, 0);
            threeWayVault.releaseOtherAllocation(address(0), 1 ether);
            require(OTHER_DESTINATION.balance == 1 ether, "other release destination");
            require(
                threeWayVault.lifetimeOtherReleased(address(0)) == 1 ether,
                "other release accounting"
            );
        }

        function testThreeWayAllocationRoundingDustStaysWithProjectTreasury() public {
            HoodYoorRevenueVault roundingVault = new HoodYoorRevenueVault(
                address(this),
                address(assetRegistry),
                TREASURY,
                address(distributor),
                OTHER_DESTINATION,
                3_333,
                3_333,
                3_334
            );
            roundingVault.setRevenueSource(address(this), true);
            roundingVault.depositNative{ value: 1 }(keccak256("rounding-dust"));

            require(roundingVault.treasuryAccrued(address(0)) == 1, "dust destination");
            require(roundingVault.rewardsAccrued(address(0)) == 0, "reward dust fabricated");
            require(roundingVault.otherAccrued(address(0)) == 0, "other dust fabricated");
            require(roundingVault.accountedBalance(address(0)) == 1, "rounding accounting");
        }

        function testAllThreeDestinationsChangeTogetherOnlyAfterDelay() public {
            address nextTreasury = address(0x7111);
            address nextOther = address(0x0777);
            uint48 validAfter = uint48(block.timestamp + vault.DESTINATION_CHANGE_DELAY());
            vault.scheduleDestinations(nextTreasury, address(distributor), nextOther);

            VM.expectRevert(
                abi.encodeWithSelector(
                    HoodYoorRevenueVault.DestinationChangeNotReady.selector, validAfter
                )
            );
            vault.applyDestinations();
            require(vault.treasury() == TREASURY, "treasury changed early");
            require(vault.otherDestination() == OTHER_DESTINATION, "other changed early");

            VM.warp(validAfter);
            vault.applyDestinations();
            require(vault.treasury() == nextTreasury, "treasury destination");
            require(vault.rewardDistributor() == address(distributor), "reward destination");
            require(vault.otherDestination() == nextOther, "other destination");
        }

        function _createEpoch(
            bytes32 epochId,
            address asset,
            bytes32 merkleRoot,
            uint256 allocation
        ) private {
            distributor.createEpoch(
                epochId,
                asset,
                merkleRoot,
                allocation,
                uint48(block.timestamp),
                uint48(block.timestamp + 7 days),
                keccak256(abi.encode(epochId, "manifest")),
                "ipfs://manifest"
            );
        }
    }

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOORRerollController } from "../src/HoodYOORRerollController.sol";
import { HoodYOORTraitRules } from "../src/HoodYOORTraitRules.sol";
import { IHoodYOORCollection } from "../src/interfaces/IHoodYOORCollection.sol";
import { IHoodYOOREnergyBank } from "../src/interfaces/IHoodYOOREnergyBank.sol";
import { IHoodYOORRerollController } from "../src/interfaces/IHoodYOORRerollController.sol";
import { ECDSA } from "../src/lib/ECDSA.sol";

interface RerollVm {
    function addr(uint256 privateKey) external returns (address keyAddr);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
    function warp(uint256 newTimestamp) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockRerollCollection is IHoodYOORCollection {
    mapping(uint256 tokenId => address) private _owners;
    mapping(uint256 tokenId => uint256) private _traits;
    address public controller;
    bool public rejectRerolls;

    error NotController();
    error TokenDoesNotExist();
    error RerollRejected();

    function seed(uint256 tokenId, address tokenOwner, uint256 packedTraits) external {
        _owners[tokenId] = tokenOwner;
        _traits[tokenId] = packedTraits;
    }

    function setController(address controller_) external {
        controller = controller_;
    }

    function setOwner(uint256 tokenId, address tokenOwner) external {
        _owners[tokenId] = tokenOwner;
    }

    function forceTraits(uint256 tokenId, uint256 packedTraits) external {
        _traits[tokenId] = packedTraits;
    }

    function setRejectRerolls(bool rejected) external {
        rejectRerolls = rejected;
    }

    function ownerOf(uint256 tokenId) external view override returns (address tokenOwner) {
        tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert TokenDoesNotExist();
    }

    function tokenTraits(uint256 tokenId) external view override returns (uint256) {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        return _traits[tokenId];
    }

    function applyReroll(uint256 tokenId, uint256 nextTraits) external override {
        if (msg.sender != controller) revert NotController();
        if (rejectRerolls) revert RerollRejected();
        _traits[tokenId] = nextTraits;
    }
}

contract MockEnergyBank is IHoodYOOREnergyBank {
    mapping(address user => uint256) public override energyBalance;
    address public spender;
    bytes32 public lastReason;
    uint256 public spendCalls;

    error NotSpender();
    error InsufficientEnergy();

    function setSpender(address spender_) external {
        spender = spender_;
    }

    function fund(address user, uint256 amount) external {
        energyBalance[user] = amount;
    }

    function creditEnergy(address user, uint256 amount, bytes32) external override {
        energyBalance[user] += amount;
    }

    function spendEnergy(address user, uint256 amount, bytes32 reason) external override {
        if (msg.sender != spender) revert NotSpender();
        uint256 balance = energyBalance[user];
        if (balance < amount) revert InsufficientEnergy();
        energyBalance[user] = balance - amount;
        lastReason = reason;
        spendCalls += 1;
    }
}

    contract MockERC1271Wallet {
        bytes4 private constant MAGIC_VALUE = 0x1626ba7e;
        address public immutable signer;

        constructor(address signer_) {
            signer = signer_;
        }

        function isValidSignature(bytes32 digest, bytes calldata signature)
            external
            view
            returns (bytes4)
        {
            return ECDSA.tryRecover(digest, signature) == signer ? MAGIC_VALUE : bytes4(0xffffffff);
        }
    }

    contract HoodYOORRerollControllerTest {
        RerollVm private constant VM =
            RerollVm(address(uint160(uint256(keccak256("hevm cheat code")))));
        uint256 private constant TOKEN_ID = 77;
        uint256 private constant TOKEN_OWNER_KEY = 0xA11CE;
        uint256 private constant RESULT_SIGNER_KEY = 0xB0B;
        uint256 private constant WRONG_KEY = 0xBAD;
        address private constant RELAYER = address(0xCAFE);

        MockRerollCollection private collection;
        MockEnergyBank private energyBank;
        HoodYOORTraitRules private rules;
        HoodYOORRerollController private controller;
        address private tokenOwner;
        address private resultSigner;
        uint256 private initialTraits;

        function setUp() public {
            tokenOwner = VM.addr(TOKEN_OWNER_KEY);
            resultSigner = VM.addr(RESULT_SIGNER_KEY);
            initialTraits = _pack([uint16(122), 201, 3001, 3057, 4001, 5032, 6042, 7001, 0]);

            collection = new MockRerollCollection();
            energyBank = new MockEnergyBank();
            rules = new HoodYOORTraitRules(address(this), 1);

            HoodYOORTraitRules.PairInput[] memory blocked = new HoodYOORTraitRules.PairInput[](1);
            blocked[0] =
                HoodYOORTraitRules.PairInput({ layerA: 6, traitA: 6008, layerB: 4, traitB: 4001 });
            rules.setIncompatibilities(blocked);
            rules.freeze(keccak256("controller test rules"));

            controller = new HoodYOORRerollController(
                address(this),
                address(collection),
                address(energyBank),
                address(rules),
                resultSigner
            );
            collection.setController(address(controller));
            collection.seed(TOKEN_ID, tokenOwner, initialTraits);
            energyBank.setSpender(address(controller));
            energyBank.fund(tokenOwner, 5_000);
        }

        function testSingleRerollIsGaslessForHolderAndReplaySafe() public {
            uint256 nextTraits = _replace(initialTraits, 4, 4002);
            require(controller.quoteEnergy(TOKEN_ID, 4, 4002) == 100, "mouth quote");
            IHoodYOORRerollController.RerollAuthorization memory authorization =
                _authorization(nextTraits, controller.ACTION_SINGLE(), 4, 100);
            (bytes memory ownerSignature, bytes memory resultSignature) = _sign(authorization);

            VM.prank(RELAYER);
            controller.confirmReroll(authorization, ownerSignature, resultSignature);

            require(collection.tokenTraits(TOKEN_ID) == nextTraits, "traits updated");
            require(energyBank.energyBalance(tokenOwner) == 4_900, "energy spent");
            require(energyBank.spendCalls() == 1, "single spend");
            require(energyBank.lastReason() != bytes32(0), "spend reason");
            require(controller.tokenNonces(TOKEN_ID) == 1, "nonce consumed");

            VM.expectRevert(
                abi.encodeWithSelector(HoodYOORRerollController.InvalidNonce.selector, 1, 0)
            );
            controller.confirmReroll(authorization, ownerSignature, resultSignature);
        }

        function testRequiresBothHolderAndResultAuthoritySignatures() public {
            uint256 nextTraits = _replace(initialTraits, 4, 4002);
            IHoodYOORRerollController.RerollAuthorization memory authorization =
                _authorization(nextTraits, controller.ACTION_SINGLE(), 4, 100);
            bytes32 digest = controller.rerollDigest(authorization);

            VM.expectRevert(HoodYOORRerollController.InvalidOwnerSignature.selector);
            controller.confirmReroll(
                authorization, _signature(WRONG_KEY, digest), _signature(RESULT_SIGNER_KEY, digest)
            );

            VM.expectRevert(HoodYOORRerollController.InvalidResultSignature.selector);
            controller.confirmReroll(
                authorization, _signature(TOKEN_OWNER_KEY, digest), _signature(WRONG_KEY, digest)
            );
            require(energyBank.spendCalls() == 0, "no failed spend");
        }

        function testRejectsIncompatibleResultBeforeSpendingEnergy() public {
            uint256 nextTraits = _replace(initialTraits, 6, 6008);
            VM.expectRevert(HoodYOORRerollController.IncompatibleTraits.selector);
            controller.quoteEnergy(TOKEN_ID, 6, 6008);

            IHoodYOORRerollController.RerollAuthorization memory authorization =
                _authorization(nextTraits, controller.ACTION_SINGLE(), 6, 200);
            (bytes memory ownerSignature, bytes memory resultSignature) = _sign(authorization);
            VM.expectRevert(HoodYOORRerollController.IncompatibleTraits.selector);
            controller.confirmReroll(authorization, ownerSignature, resultSignature);
            require(energyBank.energyBalance(tokenOwner) == 5_000, "energy unchanged");
            require(controller.tokenNonces(TOKEN_ID) == 0, "nonce unchanged");
        }

        function testRejectsStalePreviewExpiredPreviewAndOwnershipChange() public {
            uint256 nextTraits = _replace(initialTraits, 4, 4002);
            IHoodYOORRerollController.RerollAuthorization memory authorization =
                _authorization(nextTraits, controller.ACTION_SINGLE(), 4, 100);
            (bytes memory ownerSignature, bytes memory resultSignature) = _sign(authorization);

            collection.forceTraits(TOKEN_ID, _replace(initialTraits, 5, 5031));
            VM.expectRevert(HoodYOORRerollController.StaleTraitState.selector);
            controller.confirmReroll(authorization, ownerSignature, resultSignature);

            collection.forceTraits(TOKEN_ID, initialTraits);
            collection.setOwner(TOKEN_ID, RELAYER);
            VM.expectRevert(HoodYOORRerollController.TokenOwnerChanged.selector);
            controller.confirmReroll(authorization, ownerSignature, resultSignature);

            collection.setOwner(TOKEN_ID, tokenOwner);
            VM.warp(authorization.deadline + 1);
            VM.expectRevert(HoodYOORRerollController.AuthorizationExpired.selector);
            controller.confirmReroll(authorization, ownerSignature, resultSignature);
        }

        function testRerollAllChangesEveryFilledMutableLayerAndKeepsEmptySlotsEmpty() public {
            uint256 nextTraits = _pack([uint16(122), 201, 3002, 3058, 4002, 5031, 6041, 7002, 0]);
            require(controller.quoteRerollAll(TOKEN_ID, nextTraits) == 1_000, "bundle quote");

            IHoodYOORRerollController.RerollAuthorization memory authorization =
                _authorization(nextTraits, controller.ACTION_ALL(), controller.ALL_LAYERS(), 1_000);
            (bytes memory ownerSignature, bytes memory resultSignature) = _sign(authorization);
            controller.confirmReroll(authorization, ownerSignature, resultSignature);

            require(collection.tokenTraits(TOKEN_ID) == nextTraits, "bundle traits");
            require(energyBank.energyBalance(tokenOwner) == 4_000, "bundle energy");

            uint256 fillsEmptySlot = _replace(nextTraits, 8, 8002);
            VM.expectRevert(HoodYOORRerollController.InvalidRerollAll.selector);
            controller.quoteRerollAll(TOKEN_ID, fillsEmptySlot);
        }

        function testEnergyAndTraitMutationRollbackTogether() public {
            uint256 nextTraits = _replace(initialTraits, 4, 4002);
            IHoodYOORRerollController.RerollAuthorization memory authorization =
                _authorization(nextTraits, controller.ACTION_SINGLE(), 4, 100);
            (bytes memory ownerSignature, bytes memory resultSignature) = _sign(authorization);
            collection.setRejectRerolls(true);

            VM.expectRevert(MockRerollCollection.RerollRejected.selector);
            controller.confirmReroll(authorization, ownerSignature, resultSignature);

            require(collection.tokenTraits(TOKEN_ID) == initialTraits, "traits rolled back");
            require(energyBank.energyBalance(tokenOwner) == 5_000, "energy rolled back");
            require(energyBank.spendCalls() == 0, "spend call rolled back");
            require(controller.tokenNonces(TOKEN_ID) == 0, "nonce rolled back");
        }

        function testInsufficientEnergyDoesNotConsumeAuthorization() public {
            uint256 nextTraits = _replace(initialTraits, 4, 4002);
            IHoodYOORRerollController.RerollAuthorization memory authorization =
                _authorization(nextTraits, controller.ACTION_SINGLE(), 4, 100);
            (bytes memory ownerSignature, bytes memory resultSignature) = _sign(authorization);
            energyBank.fund(tokenOwner, 99);

            VM.expectRevert(MockEnergyBank.InsufficientEnergy.selector);
            controller.confirmReroll(authorization, ownerSignature, resultSignature);
            require(controller.tokenNonces(TOKEN_ID) == 0, "nonce reusable");
            require(collection.tokenTraits(TOKEN_ID) == initialTraits, "traits unchanged");
        }

        function testTokenOwnerCanInvalidateAnUnacceptedPreview() public {
            uint256 nextTraits = _replace(initialTraits, 4, 4002);
            IHoodYOORRerollController.RerollAuthorization memory authorization =
                _authorization(nextTraits, controller.ACTION_SINGLE(), 4, 100);
            (bytes memory ownerSignature, bytes memory resultSignature) = _sign(authorization);

            VM.prank(tokenOwner);
            controller.invalidateNonce(TOKEN_ID);
            require(controller.tokenNonces(TOKEN_ID) == 1, "invalidated");

            VM.expectRevert(
                abi.encodeWithSelector(HoodYOORRerollController.InvalidNonce.selector, 1, 0)
            );
            controller.confirmReroll(authorization, ownerSignature, resultSignature);
        }

        function testSupportsERC1271SmartWalletOwners() public {
            MockERC1271Wallet wallet = new MockERC1271Wallet(tokenOwner);
            collection.setOwner(TOKEN_ID, address(wallet));
            energyBank.fund(address(wallet), 500);

            uint256 nextTraits = _replace(initialTraits, 4, 4002);
            IHoodYOORRerollController.RerollAuthorization memory authorization =
                _authorizationFor(address(wallet), nextTraits, controller.ACTION_SINGLE(), 4, 100);
            bytes32 digest = controller.rerollDigest(authorization);
            controller.confirmReroll(
                authorization,
                _signature(TOKEN_OWNER_KEY, digest),
                _signature(RESULT_SIGNER_KEY, digest)
            );

            require(energyBank.energyBalance(address(wallet)) == 400, "wallet energy");
            require(collection.tokenTraits(TOKEN_ID) == nextTraits, "wallet reroll");
        }

        function testPricesMatchTraitLabAndLockedLayersStayLocked() public {
            require(controller.energyCostForLayer(4) == 100, "mouth");
            require(controller.energyCostForLayer(5) == 100, "eyes");
            require(controller.energyCostForLayer(2) == 200, "conditions");
            require(controller.energyCostForLayer(3) == 200, "clothes");
            require(controller.energyCostForLayer(6) == 200, "hat");
            require(controller.energyCostForLayer(7) == 300, "accessory one");
            require(controller.energyCostForLayer(8) == 300, "accessory two");

            VM.expectRevert(
                abi.encodeWithSelector(HoodYOORRerollController.InvalidLayer.selector, 0)
            );
            controller.energyCostForLayer(0);
            VM.expectRevert(
                abi.encodeWithSelector(HoodYOORRerollController.InvalidLayer.selector, 1)
            );
            controller.quoteEnergy(TOKEN_ID, 1, 202);
        }

        function _authorization(uint256 nextTraits, uint8 action, uint8 layer, uint256 cost)
            private
            view
            returns (IHoodYOORRerollController.RerollAuthorization memory)
        {
            return _authorizationFor(tokenOwner, nextTraits, action, layer, cost);
        }

        function _authorizationFor(
            address authorizationOwner,
            uint256 nextTraits,
            uint8 action,
            uint8 layer,
            uint256 cost
        ) private view returns (IHoodYOORRerollController.RerollAuthorization memory) {
            return IHoodYOORRerollController.RerollAuthorization({
                tokenId: TOKEN_ID,
                tokenOwner: authorizationOwner,
                expectedTraits: collection.tokenTraits(TOKEN_ID),
                nextTraits: nextTraits,
                action: action,
                layer: layer,
                energyCost: cost,
                nonce: controller.tokenNonces(TOKEN_ID),
                deadline: block.timestamp + 1 days
            });
        }

        function _sign(IHoodYOORRerollController.RerollAuthorization memory authorization)
            private
            returns (bytes memory ownerSignature, bytes memory resultSignature)
        {
            bytes32 digest = controller.rerollDigest(authorization);
            return (_signature(TOKEN_OWNER_KEY, digest), _signature(RESULT_SIGNER_KEY, digest));
        }

        function _signature(uint256 privateKey, bytes32 digest)
            private
            returns (bytes memory signature)
        {
            (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);
            return abi.encodePacked(r, s, v);
        }

        function _pack(uint16[9] memory traits) private pure returns (uint256 packed) {
            for (uint8 layer; layer < traits.length; ++layer) {
                packed |= uint256(traits[layer]) << (uint256(layer) * 16);
            }
        }

        function _replace(uint256 packedTraits, uint8 layer, uint16 traitId)
            private
            pure
            returns (uint256)
        {
            uint256 shift = uint256(layer) * 16;
            return (packedTraits & ~(uint256(0xffff) << shift)) | (uint256(traitId) << shift);
        }
    }

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOORRerollControllerV2 } from "../src/HoodYOORRerollControllerV2.sol";
import { HoodYOORTraitRules } from "../src/HoodYOORTraitRules.sol";
import { IHoodYOORCollection } from "../src/interfaces/IHoodYOORCollection.sol";
import { IHoodYOOREnergyBank } from "../src/interfaces/IHoodYOOREnergyBank.sol";
import {
    IHoodYOORRerollControllerV2
} from "../src/interfaces/IHoodYOORRerollControllerV2.sol";
import { ECDSA } from "../src/lib/ECDSA.sol";

interface RerollV2Vm {
    function addr(uint256 privateKey) external returns (address keyAddr);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function deal(address account, uint256 newBalance) external;
    function warp(uint256 newTimestamp) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockRerollV2Collection is IHoodYOORCollection {
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

contract MockRerollV2EnergyBank is IHoodYOOREnergyBank {
    mapping(address user => uint256) public override energyBalance;
    address public spender;
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

    function spendEnergy(address user, uint256 amount, bytes32) external override {
        if (msg.sender != spender) revert NotSpender();
        uint256 balance = energyBalance[user];
        if (balance < amount) revert InsufficientEnergy();
        energyBalance[user] = balance - amount;
        spendCalls += 1;
    }
}

contract MockUSDG {
    uint8 public constant decimals = 6;
    mapping(address account => uint256) public balanceOf;
    mapping(address account => mapping(address spender => uint256)) public allowance;
    bool public returnFalse;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function setReturnFalse(bool value) external {
        returnFalse = value;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (returnFalse) return false;
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockNoReturnUSDG {
    uint8 public constant decimals = 6;
    mapping(address account => uint256) public balanceOf;
    mapping(address account => mapping(address spender => uint256)) public allowance;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract MockBadDecimalsUSDG {
    uint8 public constant decimals = 18;
}

contract MockRerollV2ERC1271Wallet {
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

contract HoodYOORRerollControllerV2Test {
    RerollV2Vm private constant VM =
        RerollV2Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant TOKEN_ID = 77;
    uint256 private constant TOKEN_OWNER_KEY = 0xA11CE;
    uint256 private constant RESULT_SIGNER_KEY = 0xB0B;
    uint256 private constant WRONG_KEY = 0xBAD;
    address private constant RELAYER = address(0xCAFE);
    address private constant TREASURY = address(0x7EA5);
    uint256 private constant WEI_PER_ENERGY = 1e12;
    uint256 private constant USDG_UNITS_PER_ENERGY = 1_000;

    MockRerollV2Collection private collection;
    MockRerollV2EnergyBank private energyBank;
    HoodYOORTraitRules private rules;
    MockUSDG private usdg;
    HoodYOORRerollControllerV2 private controller;
    address private tokenOwner;
    address private resultSigner;
    uint256 private initialTraits;

    function setUp() public {
        tokenOwner = VM.addr(TOKEN_OWNER_KEY);
        resultSigner = VM.addr(RESULT_SIGNER_KEY);
        initialTraits = _pack([uint16(122), 201, 3001, 3057, 4001, 5032, 6042, 7001, 0]);

        collection = new MockRerollV2Collection();
        energyBank = new MockRerollV2EnergyBank();
        rules = new HoodYOORTraitRules(address(this), 1);
        HoodYOORTraitRules.PairInput[] memory blocked = new HoodYOORTraitRules.PairInput[](1);
        blocked[0] =
            HoodYOORTraitRules.PairInput({ layerA: 6, traitA: 6008, layerB: 4, traitB: 4001 });
        rules.setIncompatibilities(blocked);
        rules.freeze(keccak256("controller v2 test rules"));
        usdg = new MockUSDG();

        controller = new HoodYOORRerollControllerV2(
            address(this),
            address(collection),
            address(energyBank),
            address(rules),
            resultSigner,
            address(usdg),
            TREASURY
        );
        controller.setPaymentRates(WEI_PER_ENERGY, USDG_UNITS_PER_ENERGY);
        controller.freezePaymentConfiguration();
        collection.setController(address(controller));
        collection.seed(TOKEN_ID, tokenOwner, initialTraits);
        energyBank.setSpender(address(controller));
        energyBank.fund(tokenOwner, 5_000);
        usdg.mint(tokenOwner, 10_000_000);
        VM.deal(tokenOwner, 10 ether);
        VM.deal(RELAYER, 1 ether);
    }

    function testEnergyRerollRemainsGaslessAndDoesNotChargePaidCurrencies() public {
        uint256 nextTraits = _replace(initialTraits, 4, 4002);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_ENERGY());
        (bytes memory ownerSignature, bytes memory resultSignature) = _sign(controller, authorization);

        VM.prank(RELAYER);
        controller.confirmRerollEnergy(authorization, ownerSignature, resultSignature);

        require(collection.tokenTraits(TOKEN_ID) == nextTraits, "traits");
        require(energyBank.energyBalance(tokenOwner) == 4_900, "Energy charged");
        require(usdg.balanceOf(tokenOwner) == 10_000_000, "USDG untouched");
        require(address(controller).balance == 0, "ETH untouched");
        require(controller.tokenNonces(TOKEN_ID) == 1, "nonce");

        VM.expectRevert(
            abi.encodeWithSelector(HoodYOORRerollControllerV2.InvalidNonce.selector, 1, 0)
        );
        controller.confirmRerollEnergy(authorization, ownerSignature, resultSignature);
    }

    function testETHRerollChargesExactAmountAndFundsTreasuryWithdrawal() public {
        uint256 nextTraits = _replace(initialTraits, 4, 4002);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_ETH());
        require(authorization.paymentAmount == 0.0001 ether, "ETH quote");
        (bytes memory ownerSignature, bytes memory resultSignature) = _sign(controller, authorization);

        VM.prank(tokenOwner);
        controller.confirmRerollETH{ value: authorization.paymentAmount }(
            authorization, ownerSignature, resultSignature
        );
        require(energyBank.energyBalance(tokenOwner) == 5_000, "Energy untouched");
        require(address(controller).balance == authorization.paymentAmount, "ETH retained");

        uint256 beforeTreasury = TREASURY.balance;
        controller.withdrawETH();
        require(TREASURY.balance == beforeTreasury + authorization.paymentAmount, "treasury paid");
        require(address(controller).balance == 0, "controller emptied");
    }

    function testETHRerollRejectsUnderpaymentAndOverpaymentWithoutConsumingNonce() public {
        uint256 nextTraits = _replace(initialTraits, 4, 4002);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_ETH());
        (bytes memory ownerSignature, bytes memory resultSignature) = _sign(controller, authorization);

        VM.expectRevert(
            abi.encodeWithSelector(
                HoodYOORRerollControllerV2.IncorrectPaymentAmount.selector,
                authorization.paymentAmount,
                authorization.paymentAmount - 1
            )
        );
        VM.prank(tokenOwner);
        controller.confirmRerollETH{ value: authorization.paymentAmount - 1 }(
            authorization, ownerSignature, resultSignature
        );

        VM.expectRevert(
            abi.encodeWithSelector(
                HoodYOORRerollControllerV2.IncorrectPaymentAmount.selector,
                authorization.paymentAmount,
                authorization.paymentAmount + 1
            )
        );
        VM.prank(tokenOwner);
        controller.confirmRerollETH{ value: authorization.paymentAmount + 1 }(
            authorization, ownerSignature, resultSignature
        );
        require(controller.tokenNonces(TOKEN_ID) == 0, "payment failure keeps nonce");
    }

    function testUSDGRerollUsesSixDecimalUnitsAndRequiresApproval() public {
        uint256 nextTraits = _replace(initialTraits, 4, 4002);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_USDG());
        require(authorization.paymentAmount == 100_000, "0.1 USDG quote");
        (bytes memory ownerSignature, bytes memory resultSignature) = _sign(controller, authorization);

        VM.prank(tokenOwner);
        VM.expectRevert(HoodYOORRerollControllerV2.USDGTransferFailed.selector);
        controller.confirmRerollUSDG(authorization, ownerSignature, resultSignature);
        require(controller.tokenNonces(TOKEN_ID) == 0, "failed approval keeps nonce");

        VM.prank(tokenOwner);
        usdg.approve(address(controller), authorization.paymentAmount);
        VM.prank(tokenOwner);
        controller.confirmRerollUSDG(authorization, ownerSignature, resultSignature);

        require(usdg.balanceOf(TREASURY) == 100_000, "USDG treasury payment");
        require(usdg.balanceOf(tokenOwner) == 9_900_000, "holder USDG debit");
        require(energyBank.energyBalance(tokenOwner) == 5_000, "Energy untouched");
    }

    function testSignaturesBindMethodTokenAndAmountAcrossEntryPoints() public {
        uint256 nextTraits = _replace(initialTraits, 4, 4002);
        IHoodYOORRerollControllerV2.RerollAuthorization memory energyAuthorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_ENERGY());
        (bytes memory ownerSignature, bytes memory resultSignature) =
            _sign(controller, energyAuthorization);

        VM.expectRevert(
            abi.encodeWithSelector(
                HoodYOORRerollControllerV2.UnexpectedPaymentMethod.selector,
                controller.PAYMENT_ETH(),
                controller.PAYMENT_ENERGY()
            )
        );
        VM.prank(tokenOwner);
        controller.confirmRerollETH{ value: 100 }(
            energyAuthorization, ownerSignature, resultSignature
        );

        IHoodYOORRerollControllerV2.RerollAuthorization memory badToken = energyAuthorization;
        badToken.paymentToken = address(usdg);
        (ownerSignature, resultSignature) = _sign(controller, badToken);
        VM.expectRevert(
            abi.encodeWithSelector(
                HoodYOORRerollControllerV2.UnexpectedPaymentToken.selector,
                address(energyBank),
                address(usdg)
            )
        );
        controller.confirmRerollEnergy(badToken, ownerSignature, resultSignature);

        IHoodYOORRerollControllerV2.RerollAuthorization memory badAmount =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_ENERGY());
        badAmount.paymentAmount = 101;
        (ownerSignature, resultSignature) = _sign(controller, badAmount);
        VM.expectRevert(
            abi.encodeWithSelector(
                HoodYOORRerollControllerV2.IncorrectPaymentAmount.selector, 100, 101
            )
        );
        controller.confirmRerollEnergy(badAmount, ownerSignature, resultSignature);
    }

    function testPaidRerollsRequireTheCurrentTokenOwnerAsCaller() public {
        uint256 nextTraits = _replace(initialTraits, 4, 4002);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_ETH());
        (bytes memory ownerSignature, bytes memory resultSignature) = _sign(controller, authorization);

        VM.expectRevert(HoodYOORRerollControllerV2.CallerIsNotTokenOwner.selector);
        VM.prank(RELAYER);
        controller.confirmRerollETH{ value: authorization.paymentAmount }(
            authorization, ownerSignature, resultSignature
        );
    }

    function testTraitFailureRollsBackETHUSDGAndNonce() public {
        collection.setRejectRerolls(true);
        uint256 nextTraits = _replace(initialTraits, 4, 4002);

        IHoodYOORRerollControllerV2.RerollAuthorization memory ethAuthorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_ETH());
        (bytes memory ownerSignature, bytes memory resultSignature) =
            _sign(controller, ethAuthorization);
        uint256 ownerETHBefore = tokenOwner.balance;
        VM.prank(tokenOwner);
        VM.expectRevert(MockRerollV2Collection.RerollRejected.selector);
        controller.confirmRerollETH{ value: ethAuthorization.paymentAmount }(
            ethAuthorization, ownerSignature, resultSignature
        );
        require(tokenOwner.balance == ownerETHBefore, "ETH rolled back");
        require(address(controller).balance == 0, "no retained ETH");
        require(controller.tokenNonces(TOKEN_ID) == 0, "ETH nonce rolled back");

        IHoodYOORRerollControllerV2.RerollAuthorization memory usdgAuthorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_USDG());
        (ownerSignature, resultSignature) = _sign(controller, usdgAuthorization);
        VM.prank(tokenOwner);
        usdg.approve(address(controller), usdgAuthorization.paymentAmount);
        VM.prank(tokenOwner);
        VM.expectRevert(MockRerollV2Collection.RerollRejected.selector);
        controller.confirmRerollUSDG(usdgAuthorization, ownerSignature, resultSignature);
        require(usdg.balanceOf(TREASURY) == 0, "USDG rolled back");
        require(usdg.balanceOf(tokenOwner) == 10_000_000, "holder USDG restored");
        require(controller.tokenNonces(TOKEN_ID) == 0, "USDG nonce rolled back");
    }

    function testExpiredStaleAndTransferredAuthorizationsCannotCharge() public {
        uint256 nextTraits = _replace(initialTraits, 4, 4002);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_ENERGY());
        (bytes memory ownerSignature, bytes memory resultSignature) = _sign(controller, authorization);

        collection.setOwner(TOKEN_ID, RELAYER);
        VM.expectRevert(HoodYOORRerollControllerV2.TokenOwnerChanged.selector);
        controller.confirmRerollEnergy(authorization, ownerSignature, resultSignature);
        collection.setOwner(TOKEN_ID, tokenOwner);

        VM.warp(authorization.deadline + 1);
        VM.expectRevert(HoodYOORRerollControllerV2.AuthorizationExpired.selector);
        controller.confirmRerollEnergy(authorization, ownerSignature, resultSignature);
        require(energyBank.energyBalance(tokenOwner) == 5_000, "no Energy charge");
        require(controller.tokenNonces(TOKEN_ID) == 0, "authorization reusable only before expiry");
    }

    function testIncompatiblePaidResultFailsBeforeCharging() public {
        uint256 incompatibleTraits = _replace(initialTraits, 6, 6008);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorization(
                controller,
                incompatibleTraits,
                controller.ACTION_SINGLE(),
                6,
                controller.PAYMENT_ETH()
            );
        (bytes memory ownerSignature, bytes memory resultSignature) = _sign(controller, authorization);
        uint256 holderBalance = tokenOwner.balance;
        VM.expectRevert(HoodYOORRerollControllerV2.IncompatibleTraits.selector);
        VM.prank(tokenOwner);
        controller.confirmRerollETH{ value: authorization.paymentAmount }(
            authorization, ownerSignature, resultSignature
        );
        require(tokenOwner.balance == holderBalance, "ETH not charged");
        require(controller.tokenNonces(TOKEN_ID) == 0, "nonce not consumed");
    }

    function testRerollAllCanBePurchasedWithUSDG() public {
        uint256 nextTraits =
            _pack([uint16(122), 201, 3002, 3058, 4002, 5031, 6041, 7002, 0]);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorization(
                controller,
                nextTraits,
                controller.ACTION_ALL(),
                controller.ALL_LAYERS(),
                controller.PAYMENT_USDG()
            );
        require(authorization.paymentAmount == 1_000_000, "one USDG");
        (bytes memory ownerSignature, bytes memory resultSignature) = _sign(controller, authorization);
        VM.prank(tokenOwner);
        usdg.approve(address(controller), authorization.paymentAmount);
        VM.prank(tokenOwner);
        controller.confirmRerollUSDG(authorization, ownerSignature, resultSignature);
        require(collection.tokenTraits(TOKEN_ID) == nextTraits, "all traits updated");
        require(usdg.balanceOf(TREASURY) == 1_000_000, "one USDG paid");
    }

    function testUSDGFalseReturnFailsAndNoReturnTokenSucceeds() public {
        uint256 nextTraits = _replace(initialTraits, 4, 4002);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_USDG());
        (bytes memory ownerSignature, bytes memory resultSignature) = _sign(controller, authorization);
        VM.prank(tokenOwner);
        usdg.approve(address(controller), authorization.paymentAmount);
        usdg.setReturnFalse(true);
        VM.prank(tokenOwner);
        VM.expectRevert(HoodYOORRerollControllerV2.USDGTransferFailed.selector);
        controller.confirmRerollUSDG(authorization, ownerSignature, resultSignature);

        MockNoReturnUSDG noReturnUSDG = new MockNoReturnUSDG();
        HoodYOORRerollControllerV2 noReturnController = new HoodYOORRerollControllerV2(
            address(this),
            address(collection),
            address(energyBank),
            address(rules),
            resultSigner,
            address(noReturnUSDG),
            TREASURY
        );
        noReturnController.setPaymentRates(WEI_PER_ENERGY, USDG_UNITS_PER_ENERGY);
        noReturnController.freezePaymentConfiguration();
        collection.setController(address(noReturnController));
        noReturnUSDG.mint(tokenOwner, 1_000_000);

        IHoodYOORRerollControllerV2.RerollAuthorization memory noReturnAuthorization =
            _authorization(noReturnController, nextTraits, noReturnController.ACTION_SINGLE(), 4, noReturnController.PAYMENT_USDG());
        (ownerSignature, resultSignature) = _sign(noReturnController, noReturnAuthorization);
        VM.prank(tokenOwner);
        noReturnUSDG.approve(address(noReturnController), noReturnAuthorization.paymentAmount);
        VM.prank(tokenOwner);
        noReturnController.confirmRerollUSDG(
            noReturnAuthorization, ownerSignature, resultSignature
        );
        require(noReturnUSDG.balanceOf(TREASURY) == 100_000, "no-return USDG paid");
    }

    function testPricesFreezeAndMatchAllEnergyTiers() public {
        require(controller.energyCostForLayer(4) == 100, "100 tier");
        require(controller.energyCostForLayer(2) == 200, "200 tier");
        require(controller.energyCostForLayer(7) == 300, "300 tier");
        require(controller.REROLL_ALL_COST() == 1_000, "all tier");

        (address ethToken, uint256 ethAmount) = controller.quotePayment(1_000, controller.PAYMENT_ETH());
        require(ethToken == address(0) && ethAmount == 0.001 ether, "all ETH quote");
        (address usdToken, uint256 usdAmount) = controller.quotePayment(1_000, controller.PAYMENT_USDG());
        require(usdToken == address(usdg) && usdAmount == 1_000_000, "all USDG quote");

        VM.expectRevert(HoodYOORRerollControllerV2.PaymentConfigurationIsFrozen.selector);
        controller.setPaymentRates(2e12, 2_000);
    }

    function testRerollsStayDisabledUntilRatesArePermanentlyFrozen() public {
        HoodYOORRerollControllerV2 unfrozenController = new HoodYOORRerollControllerV2(
            address(this),
            address(collection),
            address(energyBank),
            address(rules),
            resultSigner,
            address(usdg),
            TREASURY
        );
        collection.setController(address(unfrozenController));
        energyBank.setSpender(address(unfrozenController));
        uint256 nextTraits = _replace(initialTraits, 4, 4002);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorizationFor(
                unfrozenController,
                tokenOwner,
                nextTraits,
                unfrozenController.ACTION_SINGLE(),
                4,
                unfrozenController.PAYMENT_ENERGY()
            );
        (bytes memory ownerSignature, bytes memory resultSignature) =
            _sign(unfrozenController, authorization);
        VM.expectRevert(
            HoodYOORRerollControllerV2.PaymentConfigurationIsNotFrozen.selector
        );
        unfrozenController.confirmRerollEnergy(
            authorization, ownerSignature, resultSignature
        );
    }

    function testRequiresBothSignaturesAndSupportsERC1271EnergyOwners() public {
        uint256 nextTraits = _replace(initialTraits, 4, 4002);
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization =
            _authorization(controller, nextTraits, controller.ACTION_SINGLE(), 4, controller.PAYMENT_ENERGY());
        bytes32 digest = controller.rerollDigest(authorization);
        VM.expectRevert(HoodYOORRerollControllerV2.InvalidOwnerSignature.selector);
        controller.confirmRerollEnergy(
            authorization, _signature(WRONG_KEY, digest), _signature(RESULT_SIGNER_KEY, digest)
        );
        VM.expectRevert(HoodYOORRerollControllerV2.InvalidResultSignature.selector);
        controller.confirmRerollEnergy(
            authorization, _signature(TOKEN_OWNER_KEY, digest), _signature(WRONG_KEY, digest)
        );

        MockRerollV2ERC1271Wallet wallet = new MockRerollV2ERC1271Wallet(tokenOwner);
        collection.setOwner(TOKEN_ID, address(wallet));
        energyBank.fund(address(wallet), 500);
        IHoodYOORRerollControllerV2.RerollAuthorization memory walletAuthorization =
            _authorizationFor(
                controller,
                address(wallet),
                nextTraits,
                controller.ACTION_SINGLE(),
                4,
                controller.PAYMENT_ENERGY()
            );
        digest = controller.rerollDigest(walletAuthorization);
        controller.confirmRerollEnergy(
            walletAuthorization,
            _signature(TOKEN_OWNER_KEY, digest),
            _signature(RESULT_SIGNER_KEY, digest)
        );
        require(energyBank.energyBalance(address(wallet)) == 400, "ERC1271 Energy");
    }

    function testRejectsNonSixDecimalUSDG() public {
        MockBadDecimalsUSDG badUSDG = new MockBadDecimalsUSDG();
        VM.expectRevert(HoodYOORRerollControllerV2.InvalidUSDG.selector);
        new HoodYOORRerollControllerV2(
            address(this),
            address(collection),
            address(energyBank),
            address(rules),
            resultSigner,
            address(badUSDG),
            TREASURY
        );
    }

    function _authorization(
        HoodYOORRerollControllerV2 target,
        uint256 nextTraits,
        uint8 action,
        uint8 layer,
        uint8 paymentMethod
    ) private view returns (IHoodYOORRerollControllerV2.RerollAuthorization memory) {
        return _authorizationFor(target, tokenOwner, nextTraits, action, layer, paymentMethod);
    }

    function _authorizationFor(
        HoodYOORRerollControllerV2 target,
        address authorizationOwner,
        uint256 nextTraits,
        uint8 action,
        uint8 layer,
        uint8 paymentMethod
    ) private view returns (IHoodYOORRerollControllerV2.RerollAuthorization memory) {
        uint256 energyUnits = action == target.ACTION_ALL()
            ? target.REROLL_ALL_COST()
            : target.energyCostForLayer(layer);
        (address paymentToken, uint256 paymentAmount) =
            target.quotePayment(energyUnits, paymentMethod);
        return IHoodYOORRerollControllerV2.RerollAuthorization({
            tokenId: TOKEN_ID,
            tokenOwner: authorizationOwner,
            expectedTraits: collection.tokenTraits(TOKEN_ID),
            nextTraits: nextTraits,
            action: action,
            layer: layer,
            paymentMethod: paymentMethod,
            paymentToken: paymentToken,
            paymentAmount: paymentAmount,
            nonce: target.tokenNonces(TOKEN_ID),
            deadline: block.timestamp + 1 days
        });
    }

    function _sign(
        HoodYOORRerollControllerV2 target,
        IHoodYOORRerollControllerV2.RerollAuthorization memory authorization
    ) private returns (bytes memory ownerSignature, bytes memory resultSignature) {
        bytes32 digest = target.rerollDigest(authorization);
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title DYOORWorldTradeEscrow
/// @notice Non-custodial, fee-free S2-for-S2 swaps with optional native MON on either side.
/// @dev The World bot only relays events. It never owns a key or controls an active trade.
contract DYOORWorldTradeEscrow is IERC721Receiver, ReentrancyGuard {
    enum TradeStatus {
        None,
        Active,
        Completed,
        Cancelled,
        Expired
    }

    struct Trade {
        address maker;
        address taker;
        uint256 offeredTokenId;
        uint256 requestedTokenId;
        uint256 monOffered;
        uint256 monRequested;
        uint64 expiresAt;
        TradeStatus status;
    }

    IERC721 public immutable S2_COLLECTION;
    uint256 public nextTradeId = 1;
    mapping(uint256 => Trade) public trades;
    mapping(address => uint256) public claimableMon;

    bool private acceptingDeposit;
    address private expectedDepositor;
    uint256 private expectedTokenId;

    event TradeCreated(
        uint256 indexed tradeId,
        address indexed maker,
        address indexed taker,
        uint256 offeredTokenId,
        uint256 requestedTokenId,
        uint256 monOffered,
        uint256 monRequested,
        uint64 expiresAt
    );
    event TradeCompleted(uint256 indexed tradeId, address indexed maker, address indexed taker);
    event TradeCancelled(uint256 indexed tradeId, address indexed maker);
    event TradeExpired(uint256 indexed tradeId, address indexed maker);
    event MonPaymentDeferred(address indexed recipient, uint256 amount);
    event MonWithdrawn(address indexed account, address indexed recipient, uint256 amount);

    error ZeroAddress();
    error InvalidToken();
    error InvalidTaker();
    error InvalidExpiry();
    error TradeNotActive();
    error TradeNotExpired();
    error TradeExpiredAlready();
    error Unauthorized();
    error IncorrectPayment();
    error UnexpectedNftDeposit();
    error MonTransferFailed();
    error NothingToWithdraw();
    error DirectMonDisabled();

    constructor(address s2Collection) {
        if (s2Collection == address(0)) revert ZeroAddress();
        S2_COLLECTION = IERC721(s2Collection);
    }

    /// @notice Escrows the maker's S2 Droid and optional MON until acceptance or cancellation.
    /// @param taker Set to address(0) for an open offer, or a wallet for a private offer.
    function createTrade(
        address taker,
        uint256 offeredTokenId,
        uint256 requestedTokenId,
        uint256 monRequested,
        uint64 expiresAt
    ) external payable nonReentrant returns (uint256 tradeId) {
        if (offeredTokenId == 0 || requestedTokenId == 0) revert InvalidToken();
        if (taker == msg.sender) revert InvalidTaker();
        if (
            expiresAt < block.timestamp + 5 minutes
                || expiresAt > block.timestamp + 30 days
        ) revert InvalidExpiry();
        if (S2_COLLECTION.ownerOf(offeredTokenId) != msg.sender) revert Unauthorized();

        tradeId = nextTradeId++;
        trades[tradeId] = Trade({
            maker: msg.sender,
            taker: taker,
            offeredTokenId: offeredTokenId,
            requestedTokenId: requestedTokenId,
            monOffered: msg.value,
            monRequested: monRequested,
            expiresAt: expiresAt,
            status: TradeStatus.Active
        });

        acceptingDeposit = true;
        expectedDepositor = msg.sender;
        expectedTokenId = offeredTokenId;
        S2_COLLECTION.safeTransferFrom(msg.sender, address(this), offeredTokenId);
        acceptingDeposit = false;
        expectedDepositor = address(0);
        expectedTokenId = 0;

        emit TradeCreated(
            tradeId,
            msg.sender,
            taker,
            offeredTokenId,
            requestedTokenId,
            msg.value,
            monRequested,
            expiresAt
        );
    }

    /// @notice Atomically swaps both S2 Droids and optional MON consideration.
    function acceptTrade(uint256 tradeId) external payable nonReentrant {
        Trade storage trade = trades[tradeId];
        if (trade.status != TradeStatus.Active) revert TradeNotActive();
        if (block.timestamp >= trade.expiresAt) revert TradeExpiredAlready();
        if (trade.taker != address(0) && trade.taker != msg.sender) revert Unauthorized();
        if (msg.sender == trade.maker) revert InvalidTaker();
        if (msg.value != trade.monRequested) revert IncorrectPayment();
        if (S2_COLLECTION.ownerOf(trade.requestedTokenId) != msg.sender) revert Unauthorized();

        trade.status = TradeStatus.Completed;
        trade.taker = msg.sender;

        S2_COLLECTION.safeTransferFrom(msg.sender, trade.maker, trade.requestedTokenId);
        S2_COLLECTION.safeTransferFrom(address(this), msg.sender, trade.offeredTokenId);
        _payOrCredit(msg.sender, trade.monOffered);
        _payOrCredit(trade.maker, trade.monRequested);

        emit TradeCompleted(tradeId, trade.maker, msg.sender);
    }

    function cancelTrade(uint256 tradeId) external nonReentrant {
        Trade storage trade = trades[tradeId];
        if (trade.status != TradeStatus.Active) revert TradeNotActive();
        if (trade.maker != msg.sender) revert Unauthorized();

        trade.status = TradeStatus.Cancelled;
        S2_COLLECTION.safeTransferFrom(address(this), trade.maker, trade.offeredTokenId);
        _payOrCredit(trade.maker, trade.monOffered);

        emit TradeCancelled(tradeId, trade.maker);
    }

    function expireTrade(uint256 tradeId) external nonReentrant {
        Trade storage trade = trades[tradeId];
        if (trade.status != TradeStatus.Active) revert TradeNotActive();
        if (block.timestamp < trade.expiresAt) revert TradeNotExpired();

        trade.status = TradeStatus.Expired;
        S2_COLLECTION.safeTransferFrom(address(this), trade.maker, trade.offeredTokenId);
        _payOrCredit(trade.maker, trade.monOffered);

        emit TradeExpired(tradeId, trade.maker);
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata
    ) external view returns (bytes4) {
        if (
            msg.sender != address(S2_COLLECTION)
                || operator != address(this)
                || !acceptingDeposit
                || from != expectedDepositor
                || tokenId != expectedTokenId
        ) revert UnexpectedNftDeposit();
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Pulls a deferred MON payment to any recipient chosen by the credited account.
    function withdrawMon(address payable recipient) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 amount = claimableMon[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimableMon[msg.sender] = 0;
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert MonTransferFailed();
        emit MonWithdrawn(msg.sender, recipient, amount);
    }

    function _payOrCredit(address recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) {
            claimableMon[recipient] += amount;
            emit MonPaymentDeferred(recipient, amount);
        }
    }

    receive() external payable {
        revert DirectMonDisabled();
    }
}

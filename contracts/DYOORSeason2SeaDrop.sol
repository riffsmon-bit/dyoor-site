// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { ERC721ContractMetadata } from "seadrop/src/ERC721ContractMetadata.sol";
import { ERC721SeaDrop } from "seadrop/src/ERC721SeaDrop.sol";
import {
    ISeaDropTokenContractMetadata
} from "seadrop/src/interfaces/ISeaDropTokenContractMetadata.sol";
import { MerkleProof } from "openzeppelin-contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title DYOORSeason2SeaDrop
 * @notice Official D.Y.O.O.R Season 2 NFT contract.
 * @dev Extends OpenSea's ERC721SeaDrop so dyoor.xyz and OpenSea Primary Drops
 *      mint the same collection from the same supply. Direct dyoor.xyz minting
 *      uses the same ERC721A minted-count accounting that SeaDrop reads through
 *      getMintStats(), which prevents wallet-limit bypasses across mint paths.
 */
contract DYOORSeason2SeaDrop is ERC721SeaDrop {
    enum MintPhase {
        None,
        Team,
        Whitelist,
        GTD,
        Public
    }

    struct DirectPhaseConfig {
        uint64 startTime;
        uint80 price;
        uint16 walletLimit;
        bytes32 merkleRoot;
    }

    uint256 public constant MAX_SUPPLY = 5_555;
    uint80 public constant DEFAULT_PAID_PRICE = 333 ether;
    uint96 public constant DEFAULT_ROYALTY_BPS = 500;
    string public constant COLLECTION_MEANING = "Directive: Yield Opportunity Optimization Robots";
    address public constant DOCUMENTED_SEADROP_1_0 = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;

    address public treasury;
    bool public mintPaused;
    bool public metadataFrozen;

    mapping(MintPhase => DirectPhaseConfig) private _phaseConfigs;
    mapping(MintPhase => mapping(address => uint256)) public directMintedByPhase;
    mapping(bytes32 => address) public externalSystems;

    error InvalidSeaDropAddress();
    error InvalidTreasury();
    error InvalidPhase();
    error InvalidSchedule();
    error InvalidWalletLimit();
    error MintPaused();
    error MintInactive();
    error ZeroQuantity();
    error IncorrectPayment(uint256 expected, uint256 received);
    error AllowlistProofInvalid();
    error WalletLimitExceeded(uint256 attempted, uint256 limit);
    error MaxSupplyLocked(uint256 attempted, uint256 locked);
    error MetadataIsFrozen();
    error MetadataAlreadyFrozen();
    error WithdrawFailed();
    error NoTreasuryBalance();

    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event MintPausedUpdated(bool paused);
    event PhaseScheduleUpdated(
        uint64 teamStart, uint64 whitelistStart, uint64 gtdStart, uint64 publicStart
    );
    event PhaseConfigUpdated(
        MintPhase indexed phase,
        uint64 startTime,
        uint80 price,
        uint16 walletLimit,
        bytes32 merkleRoot
    );
    event DirectMint(
        address indexed minter, MintPhase indexed phase, uint256 quantity, uint256 paid
    );
    event MetadataFrozen();
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);
    event ExternalSystemUpdated(bytes32 indexed systemId, address indexed systemAddress);

    constructor(string memory name_, string memory symbol_, address[] memory allowedSeaDrop)
        ERC721SeaDrop(name_, symbol_, allowedSeaDrop)
    {
        uint256 seaDropCount = allowedSeaDrop.length;
        if (seaDropCount == 0) revert InvalidSeaDropAddress();

        for (uint256 i = 0; i < seaDropCount;) {
            if (allowedSeaDrop[i] == address(0)) revert InvalidSeaDropAddress();
            unchecked {
                ++i;
            }
        }

        treasury = msg.sender;

        _maxSupply = MAX_SUPPLY;
        emit MaxSupplyUpdated(MAX_SUPPLY);

        _royaltyInfo = ISeaDropTokenContractMetadata.RoyaltyInfo({
            royaltyAddress: msg.sender, royaltyBps: DEFAULT_ROYALTY_BPS
        });
        emit RoyaltyInfoUpdated(msg.sender, DEFAULT_ROYALTY_BPS);

        _phaseConfigs[MintPhase.Team] =
            DirectPhaseConfig({ startTime: 0, price: 0, walletLimit: 10, merkleRoot: bytes32(0) });
        _phaseConfigs[MintPhase.Whitelist] = DirectPhaseConfig({
            startTime: 0, price: DEFAULT_PAID_PRICE, walletLimit: 3, merkleRoot: bytes32(0)
        });
        _phaseConfigs[MintPhase.GTD] = DirectPhaseConfig({
            startTime: 0, price: DEFAULT_PAID_PRICE, walletLimit: 2, merkleRoot: bytes32(0)
        });
        _phaseConfigs[MintPhase.Public] = DirectPhaseConfig({
            startTime: 0, price: DEFAULT_PAID_PRICE, walletLimit: 0, merkleRoot: bytes32(0)
        });
    }

    receive() external payable { }

    function mintDirect(uint256 quantity, bytes32[] calldata proof) external payable nonReentrant {
        _mintDirect(activePhase(), quantity, proof);
    }

    function teamMint(uint256 quantity, bytes32[] calldata proof) external payable nonReentrant {
        _mintDirect(MintPhase.Team, quantity, proof);
    }

    function whitelistMint(uint256 quantity, bytes32[] calldata proof)
        external
        payable
        nonReentrant
    {
        _mintDirect(MintPhase.Whitelist, quantity, proof);
    }

    function gtdMint(uint256 quantity, bytes32[] calldata proof) external payable nonReentrant {
        _mintDirect(MintPhase.GTD, quantity, proof);
    }

    function publicMint(uint256 quantity) external payable nonReentrant {
        bytes32[] memory emptyProof = new bytes32[](0);
        _mintDirect(MintPhase.Public, quantity, emptyProof);
    }

    /**
     * @notice SeaDrop mint entrypoint. Same signature and accounting as the
     *         OpenSea base contract, with the DYOOR pause gate added.
     */
    function mintSeaDrop(address minter, uint256 quantity) external override nonReentrant {
        if (mintPaused) revert MintPaused();

        _onlyAllowedSeaDrop(msg.sender);

        uint256 newTotal = _totalMinted() + quantity;
        if (newTotal > maxSupply()) {
            revert MintQuantityExceedsMaxSupply(newTotal, maxSupply());
        }

        _safeMint(minter, quantity);
    }

    function activePhase() public view returns (MintPhase) {
        if (
            _phaseConfigs[MintPhase.Public].startTime != 0
                && block.timestamp >= _phaseConfigs[MintPhase.Public].startTime
        ) {
            return MintPhase.Public;
        }
        if (
            _phaseConfigs[MintPhase.GTD].startTime != 0
                && block.timestamp >= _phaseConfigs[MintPhase.GTD].startTime
        ) {
            return MintPhase.GTD;
        }
        if (
            _phaseConfigs[MintPhase.Whitelist].startTime != 0
                && block.timestamp >= _phaseConfigs[MintPhase.Whitelist].startTime
        ) {
            return MintPhase.Whitelist;
        }
        if (
            _phaseConfigs[MintPhase.Team].startTime != 0
                && block.timestamp >= _phaseConfigs[MintPhase.Team].startTime
        ) {
            return MintPhase.Team;
        }

        return MintPhase.None;
    }

    function phaseConfig(MintPhase phase) external view returns (DirectPhaseConfig memory) {
        if (phase == MintPhase.None) revert InvalidPhase();
        return _phaseConfigs[phase];
    }

    function totalMinted() external view returns (uint256) {
        return _totalMinted();
    }

    function numberMinted(address wallet) external view returns (uint256) {
        return _numberMinted(wallet);
    }

    function allowlistLeaf(address wallet) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(wallet));
    }

    function setMintPaused(bool paused) external onlyOwner {
        mintPaused = paused;
        emit MintPausedUpdated(paused);
    }

    function pauseMint() external onlyOwner {
        mintPaused = true;
        emit MintPausedUpdated(true);
    }

    function unpauseMint() external onlyOwner {
        mintPaused = false;
        emit MintPausedUpdated(false);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidTreasury();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function setPhaseStartTimes(
        uint64 teamStart,
        uint64 whitelistStart,
        uint64 gtdStart,
        uint64 publicStart
    ) external onlyOwner {
        _validateSchedule(teamStart, whitelistStart, gtdStart, publicStart);

        _phaseConfigs[MintPhase.Team].startTime = teamStart;
        _phaseConfigs[MintPhase.Whitelist].startTime = whitelistStart;
        _phaseConfigs[MintPhase.GTD].startTime = gtdStart;
        _phaseConfigs[MintPhase.Public].startTime = publicStart;

        emit PhaseScheduleUpdated(teamStart, whitelistStart, gtdStart, publicStart);
    }

    function setPhaseConfig(
        MintPhase phase,
        uint64 startTime,
        uint80 price,
        uint16 walletLimit,
        bytes32 merkleRoot
    ) external onlyOwner {
        if (phase == MintPhase.None) revert InvalidPhase();
        if (phase != MintPhase.Public && walletLimit == 0) {
            revert InvalidWalletLimit();
        }

        uint64 teamStart = _phaseConfigs[MintPhase.Team].startTime;
        uint64 whitelistStart = _phaseConfigs[MintPhase.Whitelist].startTime;
        uint64 gtdStart = _phaseConfigs[MintPhase.GTD].startTime;
        uint64 publicStart = _phaseConfigs[MintPhase.Public].startTime;

        if (phase == MintPhase.Team) teamStart = startTime;
        if (phase == MintPhase.Whitelist) whitelistStart = startTime;
        if (phase == MintPhase.GTD) gtdStart = startTime;
        if (phase == MintPhase.Public) publicStart = startTime;

        _validateSchedule(teamStart, whitelistStart, gtdStart, publicStart);

        _phaseConfigs[phase] = DirectPhaseConfig({
            startTime: startTime, price: price, walletLimit: walletLimit, merkleRoot: merkleRoot
        });

        emit PhaseConfigUpdated(phase, startTime, price, walletLimit, merkleRoot);
    }

    function updatePrices(
        uint80 teamPrice,
        uint80 whitelistPrice,
        uint80 gtdPrice,
        uint80 publicPrice
    ) external onlyOwner {
        _phaseConfigs[MintPhase.Team].price = teamPrice;
        _phaseConfigs[MintPhase.Whitelist].price = whitelistPrice;
        _phaseConfigs[MintPhase.GTD].price = gtdPrice;
        _phaseConfigs[MintPhase.Public].price = publicPrice;

        emit PhaseConfigUpdated(
            MintPhase.Team,
            _phaseConfigs[MintPhase.Team].startTime,
            teamPrice,
            _phaseConfigs[MintPhase.Team].walletLimit,
            _phaseConfigs[MintPhase.Team].merkleRoot
        );
        emit PhaseConfigUpdated(
            MintPhase.Whitelist,
            _phaseConfigs[MintPhase.Whitelist].startTime,
            whitelistPrice,
            _phaseConfigs[MintPhase.Whitelist].walletLimit,
            _phaseConfigs[MintPhase.Whitelist].merkleRoot
        );
        emit PhaseConfigUpdated(
            MintPhase.GTD,
            _phaseConfigs[MintPhase.GTD].startTime,
            gtdPrice,
            _phaseConfigs[MintPhase.GTD].walletLimit,
            _phaseConfigs[MintPhase.GTD].merkleRoot
        );
        emit PhaseConfigUpdated(
            MintPhase.Public,
            _phaseConfigs[MintPhase.Public].startTime,
            publicPrice,
            _phaseConfigs[MintPhase.Public].walletLimit,
            _phaseConfigs[MintPhase.Public].merkleRoot
        );
    }

    function updateMerkleRoots(bytes32 teamRoot, bytes32 whitelistRoot, bytes32 gtdRoot)
        external
        onlyOwner
    {
        _phaseConfigs[MintPhase.Team].merkleRoot = teamRoot;
        _phaseConfigs[MintPhase.Whitelist].merkleRoot = whitelistRoot;
        _phaseConfigs[MintPhase.GTD].merkleRoot = gtdRoot;

        emit PhaseConfigUpdated(
            MintPhase.Team,
            _phaseConfigs[MintPhase.Team].startTime,
            _phaseConfigs[MintPhase.Team].price,
            _phaseConfigs[MintPhase.Team].walletLimit,
            teamRoot
        );
        emit PhaseConfigUpdated(
            MintPhase.Whitelist,
            _phaseConfigs[MintPhase.Whitelist].startTime,
            _phaseConfigs[MintPhase.Whitelist].price,
            _phaseConfigs[MintPhase.Whitelist].walletLimit,
            whitelistRoot
        );
        emit PhaseConfigUpdated(
            MintPhase.GTD,
            _phaseConfigs[MintPhase.GTD].startTime,
            _phaseConfigs[MintPhase.GTD].price,
            _phaseConfigs[MintPhase.GTD].walletLimit,
            gtdRoot
        );
    }

    function setBaseURI(string calldata newBaseURI)
        external
        override(ERC721ContractMetadata, ISeaDropTokenContractMetadata)
    {
        if (metadataFrozen) revert MetadataIsFrozen();
        _onlyOwnerOrSelf();

        _tokenBaseURI = newBaseURI;

        if (totalSupply() != 0) {
            emit BatchMetadataUpdate(1, _nextTokenId() - 1);
        }
    }

    function setContractURI(string calldata newContractURI)
        external
        override(ERC721ContractMetadata, ISeaDropTokenContractMetadata)
    {
        if (metadataFrozen) revert MetadataIsFrozen();
        _onlyOwnerOrSelf();

        _contractURI = newContractURI;
        emit ContractURIUpdated(newContractURI);
    }

    function emitBatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId)
        external
        override(ERC721ContractMetadata)
    {
        _onlyOwnerOrSelf();
        emit BatchMetadataUpdate(fromTokenId, toTokenId);
    }

    function setMaxSupply(uint256 newMaxSupply)
        external
        override(ERC721ContractMetadata, ISeaDropTokenContractMetadata)
    {
        _onlyOwnerOrSelf();
        if (newMaxSupply != MAX_SUPPLY) {
            revert MaxSupplyLocked(newMaxSupply, MAX_SUPPLY);
        }
        _maxSupply = MAX_SUPPLY;
        emit MaxSupplyUpdated(MAX_SUPPLY);
    }

    function setProvenanceHash(bytes32 newProvenanceHash)
        external
        override(ERC721ContractMetadata, ISeaDropTokenContractMetadata)
    {
        if (metadataFrozen) revert MetadataIsFrozen();
        _onlyOwnerOrSelf();
        if (_totalMinted() > 0) {
            revert ProvenanceHashCannotBeSetAfterMintStarted();
        }

        bytes32 oldProvenanceHash = _provenanceHash;
        _provenanceHash = newProvenanceHash;
        emit ProvenanceHashUpdated(oldProvenanceHash, newProvenanceHash);
    }

    function setRoyaltyInfo(ISeaDropTokenContractMetadata.RoyaltyInfo calldata newInfo)
        external
        override(ERC721ContractMetadata, ISeaDropTokenContractMetadata)
    {
        _setRoyaltyInfo(newInfo.royaltyAddress, newInfo.royaltyBps);
    }

    function updateRoyaltyReceiver(address receiver) external onlyOwner {
        _setRoyaltyInfo(receiver, _royaltyInfo.royaltyBps);
    }

    function updateRoyaltyPercentage(uint96 basisPoints) external onlyOwner {
        _setRoyaltyInfo(_royaltyInfo.royaltyAddress, basisPoints);
    }

    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataAlreadyFrozen();
        metadataFrozen = true;
        emit MetadataFrozen();
    }

    function withdrawTreasury() external onlyOwner nonReentrant returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) revert NoTreasuryBalance();

        address payable target = payable(treasury);
        (bool success,) = target.call{ value: amount }("");
        if (!success) revert WithdrawFailed();

        emit TreasuryWithdrawn(target, amount);
    }

    function setExternalSystem(bytes32 systemId, address systemAddress) external onlyOwner {
        externalSystems[systemId] = systemAddress;
        emit ExternalSystemUpdated(systemId, systemAddress);
    }

    function _mintDirect(MintPhase phase, uint256 quantity, bytes32[] memory proof) internal {
        if (mintPaused) revert MintPaused();
        if (phase == MintPhase.None) revert MintInactive();
        if (quantity == 0) revert ZeroQuantity();
        if (phase != activePhase()) revert MintInactive();

        DirectPhaseConfig memory config = _phaseConfigs[phase];
        uint256 expected = uint256(config.price) * quantity;
        if (msg.value != expected) revert IncorrectPayment(expected, msg.value);

        uint256 newTotal = _totalMinted() + quantity;
        if (newTotal > MAX_SUPPLY) {
            revert MintQuantityExceedsMaxSupply(newTotal, MAX_SUPPLY);
        }

        if (phase != MintPhase.Public) {
            if (!MerkleProof.verify(proof, config.merkleRoot, allowlistLeaf(msg.sender))) {
                revert AllowlistProofInvalid();
            }

            uint256 attempted = _numberMinted(msg.sender) + quantity;
            if (attempted > config.walletLimit) {
                revert WalletLimitExceeded(attempted, config.walletLimit);
            }
        }

        directMintedByPhase[phase][msg.sender] += quantity;
        _safeMint(msg.sender, quantity);

        emit DirectMint(msg.sender, phase, quantity, msg.value);
    }

    function _validateSchedule(
        uint64 teamStart,
        uint64 whitelistStart,
        uint64 gtdStart,
        uint64 publicStart
    ) private pure {
        if (teamStart != 0 && whitelistStart != 0 && teamStart > whitelistStart) {
            revert InvalidSchedule();
        }
        if (whitelistStart != 0 && gtdStart != 0 && whitelistStart > gtdStart) {
            revert InvalidSchedule();
        }
        if (gtdStart != 0 && publicStart != 0 && gtdStart > publicStart) {
            revert InvalidSchedule();
        }
    }

    function _setRoyaltyInfo(address receiver, uint96 basisPoints) private {
        _onlyOwnerOrSelf();
        if (receiver == address(0)) revert RoyaltyAddressCannotBeZeroAddress();
        if (basisPoints > 10_000) revert InvalidRoyaltyBasisPoints(basisPoints);

        _royaltyInfo = ISeaDropTokenContractMetadata.RoyaltyInfo({
            royaltyAddress: receiver, royaltyBps: basisPoints
        });

        emit RoyaltyInfoUpdated(receiver, basisPoints);
    }
}

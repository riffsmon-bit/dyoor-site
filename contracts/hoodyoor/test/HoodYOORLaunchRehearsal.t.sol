// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOOR } from "../src/HoodYOOR.sol";
import { HoodYOOREnergyBank } from "../src/HoodYOOREnergyBank.sol";
import { HoodYOORPackedTraitStore } from "../src/HoodYOORPackedTraitStore.sol";
import { HoodYOORPixelRenderer } from "../src/HoodYOORPixelRenderer.sol";
import { HoodYOORRerollController } from "../src/HoodYOORRerollController.sol";
import { HoodYOORTraitRules } from "../src/HoodYOORTraitRules.sol";
import { IHoodYOORRerollController } from "../src/interfaces/IHoodYOORRerollController.sol";
import { IERC721Receiver } from "../src/interfaces/TokenInterfaces.sol";

interface LaunchVm {
    function addr(uint256 privateKey) external returns (address keyAddr);
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 newBalance) external;
    function deployCode(string calldata artifactPath, bytes calldata constructorArgs)
        external
        returns (address deployedAddress);
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function readFileBinary(string calldata path) external view returns (bytes memory data);
    function roll(uint256 newHeight) external;
    function setBlockhash(uint256 blockNumber, bytes32 blockHash) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
}

/// @notice Full local Robinhood-chain launch rehearsal. No external RPC is used.
contract HoodYOORLaunchRehearsalTest is IERC721Receiver {
    LaunchVm private constant VM =
        LaunchVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant TARGET_CHAIN_ID = 4_663;
    uint256 private constant TOKEN_OWNER_KEY = 0xA11CE;
    uint256 private constant RESULT_SIGNER_KEY = 0xB0B;
    address private constant TREASURY = address(0xD1007);
    address private constant RELAYER = address(0xCAFE);
    bytes32 private constant CATALOG_HASH =
        0x50e0424b927b0da11b01947b6839070d81b6aa982b214c63f78f4adb8cb756d3;
    bytes32 private constant RULES_HASH =
        0x14a33149be765254e70441c4ba2674c662f5b3f746fb3ac8a717a4f49b47ab0f;
    bytes32 private constant ASSIGNMENTS_HASH =
        0x2b3049a8235d705dba39542b53990e584e3815e4e6a32efae6ecb810b8f506a3;
    bytes32 private constant GTD_ALLOWLIST_HASH =
        0xa422f0b2443dea9c6d3d23e8ec312df7912fab929830aa435ef114923a148b68;
    bytes32 private constant GTD_ROOT =
        0x915e9b6ddcfe13a197ade8f6b776d37beb8ce2f766001e6579bd0601ffc5dd31;
    address private constant MONAD_GTD_HOLDER = 0x02A712e8Efe2b29463ec632329BFEE7eC846Ad1c;
    bytes32 private constant REVEAL_SECRET = keccak256("hoodyoor-launch-rehearsal-secret");

    function testFullChain4663DeploymentGTDRevealAndReroll() public {
        VM.chainId(TARGET_CHAIN_ID);
        require(block.chainid == TARGET_CHAIN_ID, "Robinhood chain id");

        bytes memory art =
            VM.readFileBinary("../../data/robinhood/onchain-128/hoodyoor-onchain-art.bin");
        bytes memory traitRecords =
            VM.readFileBinary("../../data/robinhood/onchain-128/hoodyoor-trait-records.bin");
        bytes memory encodedRules =
            VM.readFileBinary("../../data/robinhood/onchain-128/hoodyoor-reroll-rules.bin");
        bytes memory assignments = VM.readFileBinary(
            "../../data/robinhood/onchain-128/hoodyoor-initial-assignments.bin"
        );
        require(keccak256(assignments) == ASSIGNMENTS_HASH, "assignment provenance");
        require(keccak256(encodedRules) == RULES_HASH, "rule provenance");
        {
            bytes memory gtdAllowlist =
                VM.readFileBinary("../../data/robinhood/onchain-128/hoodyoor-gtd-allowlist.bin");
            require(keccak256(gtdAllowlist) == GTD_ALLOWLIST_HASH, "GTD provenance");
            _validateGtdAllowlist(gtdAllowlist);
        }

        HoodYOORPackedTraitStore store = _deployArtStore(art, traitRecords);
        HoodYOORPixelRenderer renderer = HoodYOORPixelRenderer(
            VM.deployCode(
                "HoodYOORPixelRenderer.sol:HoodYOORPixelRenderer", abi.encode(address(store))
            )
        );
        HoodYOOR collection = HoodYOOR(
            payable(VM.deployCode(
                    "HoodYOOR.sol:HoodYOOR", abi.encode(address(this), TREASURY, address(renderer))
                ))
        );
        HoodYOOREnergyBank energyBank = HoodYOOREnergyBank(
            VM.deployCode("HoodYOOREnergyBank.sol:HoodYOOREnergyBank", abi.encode(address(this)))
        );
        HoodYOORTraitRules rules = _deployRules(encodedRules);

        address resultSigner = VM.addr(RESULT_SIGNER_KEY);
        HoodYOORRerollController controller = HoodYOORRerollController(
            VM.deployCode(
                "HoodYOORRerollController.sol:HoodYOORRerollController",
                abi.encode(
                    address(this),
                    address(collection),
                    address(energyBank),
                    address(rules),
                    resultSigner
                )
            )
        );

        collection.setRerollController(address(controller));
        collection.freezeRerollController();
        energyBank.grantRole(energyBank.CREDIT_ROLE(), address(collection));
        collection.setEnergyConfiguration(address(energyBank), 1_000);
        collection.freezeEnergyConfiguration();
        energyBank.grantRole(energyBank.SPENDER_ROLE(), address(controller));
        _loadAssignments(collection, assignments);
        collection.freezeInitialTraits(ASSIGNMENTS_HASH, keccak256(abi.encodePacked(REVEAL_SECRET)));
        collection.freezeRenderer();

        require(store.frozen() && renderer.isFrozen(), "art frozen");
        require(rules.frozen() && rules.rulesHash() == RULES_HASH, "rules frozen");
        require(collection.initialTraitsFrozen(), "assignments frozen");
        require(collection.rendererFrozen(), "renderer frozen");
        require(collection.energyConfigurationFrozen(), "mint Energy frozen");
        require(collection.rerollControllerFrozen(), "controller frozen");
        require(energyBank.hasRole(energyBank.SPENDER_ROLE(), address(controller)), "spender wired");

        address tokenOwner = VM.addr(TOKEN_OWNER_KEY);
        collection.setGTDMerkleRoot(GTD_ROOT);
        collection.setSaleState(true, false);
        require(collection.ownerReserveMinted(), "owner reserve minted");
        require(collection.balanceOf(address(this)) == 150, "owner reserve balance");
        require(energyBank.energyBalance(address(this)) == 0, "reserve has no mint Energy");
        require(collection.totalSupply() == 150 && collection.paidMinted() == 0, "reserve supply");
        require(!collection.secondaryTradingEnabled(), "reserve counts below trading threshold");
        VM.deal(MONAD_GTD_HOLDER, 1 ether);
        uint256 mintPrice = collection.MINT_PRICE();
        VM.prank(MONAD_GTD_HOLDER);
        collection.mintGTD{ value: mintPrice }(1, 1, _monadHolderProof());
        uint256 rerollTokenId = 151;
        require(collection.ownerOf(rerollTokenId) == MONAD_GTD_HOLDER, "Monad GTD mint");
        require(energyBank.energyBalance(MONAD_GTD_HOLDER) == 1_000, "paid mint Energy");
        require(collection.paidMinted() == 1 && collection.totalSupply() == 151, "paid supply");
        VM.expectRevert(HoodYOOR.SecondaryTradingLocked.selector);
        VM.prank(MONAD_GTD_HOLDER);
        collection.transferFrom(MONAD_GTD_HOLDER, tokenOwner, rerollTokenId);
        collection.unlockSecondaryTrading();
        require(collection.secondaryTradingEnabled(), "secondary trading enabled");
        VM.expectRevert(HoodYOOR.SecondaryTradingAlreadyUnlocked.selector);
        collection.unlockSecondaryTrading();
        VM.prank(MONAD_GTD_HOLDER);
        collection.transferFrom(MONAD_GTD_HOLDER, tokenOwner, rerollTokenId);
        require(collection.ownerOf(rerollTokenId) == tokenOwner, "transferred reroll owner");

        collection.finalizeMintingAndRequestReveal(REVEAL_SECRET);
        uint256 targetBlock = collection.revealBlock();
        VM.roll(targetBlock + 1);
        VM.setBlockhash(targetBlock, keccak256("hoodyoor-fixed-chain-4663-reveal-block"));
        collection.completeReveal();
        require(collection.revealed(), "collection revealed");

        uint256 currentTraits = collection.tokenTraits(rerollTokenId);
        (uint256 nextTraits, uint8 layer, uint256 energyCost) =
            _findSingleReroll(controller, traitRecords, rerollTokenId, currentTraits);
        energyBank.creditEnergy(tokenOwner, 5_000, keccak256("local-energy-migration"));

        IHoodYOORRerollController.RerollAuthorization memory authorization =
            IHoodYOORRerollController.RerollAuthorization({
                tokenId: rerollTokenId,
                tokenOwner: tokenOwner,
                expectedTraits: currentTraits,
                nextTraits: nextTraits,
                action: controller.ACTION_SINGLE(),
                layer: layer,
                energyCost: energyCost,
                nonce: controller.tokenNonces(rerollTokenId),
                deadline: block.timestamp + 1 days
            });
        bytes32 digest = controller.rerollDigest(authorization);
        bytes memory ownerSignature = _signature(TOKEN_OWNER_KEY, digest);
        bytes memory resultSignature = _signature(RESULT_SIGNER_KEY, digest);

        VM.prank(RELAYER);
        controller.confirmReroll(authorization, ownerSignature, resultSignature);

        require(collection.tokenTraits(rerollTokenId) == nextTraits, "reroll settled");
        require(energyBank.energyBalance(tokenOwner) == 5_000 - energyCost, "Energy settled");
        require(controller.tokenNonces(rerollTokenId) == 1, "reroll nonce settled");
        require(bytes(renderer.renderSVG(nextTraits)).length != 0, "rerolled SVG renders");
        require(bytes(collection.tokenURI(rerollTokenId)).length != 0, "rerolled metadata renders");
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    function _deployArtStore(bytes memory art, bytes memory encodedRecords)
        private
        returns (HoodYOORPackedTraitStore store)
    {
        require(art.length == 586_295, "art bytes");
        require(encodedRecords.length == 201 * 17, "trait record bytes");
        store = HoodYOORPackedTraitStore(
            VM.deployCode(
                "HoodYOORPackedTraitStore.sol:HoodYOORPackedTraitStore",
                abi.encode(address(this), uint16(201))
            )
        );

        uint256 chunkBytes = store.CHUNK_PAYLOAD_BYTES();
        for (uint256 offset; offset < art.length; offset += chunkBytes) {
            uint256 remaining = art.length - offset;
            uint256 length = remaining < chunkBytes ? remaining : chunkBytes;
            bytes memory chunk = _slice(art, offset, length);
            if (offset + length == art.length) store.appendFinalChunk(chunk);
            else store.appendChunk(chunk);
        }

        for (uint256 offset; offset < 201; offset += 20) {
            uint256 count = 201 - offset < 20 ? 201 - offset : 20;
            HoodYOORPackedTraitStore.TraitInput[] memory records =
                new HoodYOORPackedTraitStore.TraitInput[](count);
            for (uint256 i; i < count; ++i) {
                uint256 cursor = (offset + i) * 17;
                records[i] = HoodYOORPackedTraitStore.TraitInput({
                    layer: uint8(encodedRecords[cursor]),
                    traitId: _uint16(encodedRecords, cursor + 1),
                    nameOffset: _uint32(encodedRecords, cursor + 3),
                    nameLength: _uint16(encodedRecords, cursor + 7),
                    artOffset: _uint32(encodedRecords, cursor + 9),
                    artLength: _uint32(encodedRecords, cursor + 13)
                });
            }
            store.setTraitRecords(records);
        }
        store.freeze(CATALOG_HASH);
    }

    function _deployRules(bytes memory encoded) private returns (HoodYOORTraitRules rules) {
        require(encoded.length == 329 * 6, "rule bytes");
        rules = HoodYOORTraitRules(
            VM.deployCode(
                "HoodYOORTraitRules.sol:HoodYOORTraitRules", abi.encode(address(this), uint16(329))
            )
        );
        for (uint256 offset; offset < 329; offset += 40) {
            uint256 count = 329 - offset < 40 ? 329 - offset : 40;
            HoodYOORTraitRules.PairInput[] memory pairs = new HoodYOORTraitRules.PairInput[](count);
            for (uint256 i; i < count; ++i) {
                uint256 cursor = (offset + i) * 6;
                pairs[i] = HoodYOORTraitRules.PairInput({
                    layerA: uint8(encoded[cursor]),
                    traitA: _uint16(encoded, cursor + 1),
                    layerB: uint8(encoded[cursor + 3]),
                    traitB: _uint16(encoded, cursor + 4)
                });
            }
            rules.setIncompatibilities(pairs);
        }
        rules.freeze(RULES_HASH);
    }

    function _loadAssignments(HoodYOOR collection, bytes memory encoded) private {
        require(encoded.length == 3_333 * 18, "assignment bytes");
        for (uint256 offset; offset < 3_333; offset += 50) {
            uint256 count = 3_333 - offset < 50 ? 3_333 - offset : 50;
            uint256[] memory assignmentIds = new uint256[](count);
            uint256[] memory packedTraits = new uint256[](count);
            for (uint256 i; i < count; ++i) {
                assignmentIds[i] = offset + i + 1;
                packedTraits[i] = _uint144(encoded, (offset + i) * 18);
            }
            collection.setInitialTraitsBatch(assignmentIds, packedTraits);
        }
    }

    function _validateGtdAllowlist(bytes memory encoded) private pure {
        require(encoded.length == 333 * 22, "GTD bytes");
        uint256 oneMintWallets;
        uint256 threeMintWallets;
        uint256 aggregateAllowance;
        uint160 previous;
        bool foundMonadHolder;

        for (uint256 record; record < 333; ++record) {
            uint256 cursor = record * 22;
            address wallet = _address(encoded, cursor);
            uint16 maxMint = _uint16(encoded, cursor + 20);
            if (record != 0) require(uint160(wallet) > previous, "GTD wallet order");
            previous = uint160(wallet);
            if (maxMint == 1) ++oneMintWallets;
            else if (maxMint == 3) ++threeMintWallets;
            else revert("GTD max mint");
            aggregateAllowance += maxMint;
            if (wallet == MONAD_GTD_HOLDER && maxMint == 1) foundMonadHolder = true;
        }

        require(oneMintWallets == 133, "Monad GTD wallets");
        require(threeMintWallets == 200, "Robinhood GTD wallets");
        require(aggregateAllowance == 733, "GTD aggregate allowance");
        require(foundMonadHolder, "Monad holder omitted");
    }

    function _monadHolderProof() private pure returns (bytes32[] memory proof) {
        proof = new bytes32[](8);
        proof[0] = 0xcc263fea6e6424f33d8c13992f718fc170e7d255513d51644535f07d19370dc0;
        proof[1] = 0x09389105482a24f1a41d430a9b1b1ed7b966b5267a9a1caf6b5b6e007fbea688;
        proof[2] = 0x263278f13c9d3396e6e69acb127fbc8947c0acb7d155cc3c72c09ab81c489b74;
        proof[3] = 0x9333cc660c36730ee71a767593cc04520e30e803bd7b2277d392f33bb2269031;
        proof[4] = 0x530fe0aa217927c5eb0a55120ce931f76b15350573081bc25d43f85e4b09799c;
        proof[5] = 0x29b299d188f5a0aef8684569ba536327f35e5c38db41f86f1cfb8689febdd1eb;
        proof[6] = 0xb19c87cc8643727b6af3f962aa9bb3d33dc7d58aba4aae4a43d5b9983c0753ca;
        proof[7] = 0xc7f65514d3e4d6ee36c9b7e204948ddea7a5cca9c86e6f89536bd1520661677a;
    }

    function _findSingleReroll(
        HoodYOORRerollController controller,
        bytes memory encodedRecords,
        uint256 tokenId,
        uint256 currentTraits
    ) private view returns (uint256 nextTraits, uint8 selectedLayer, uint256 energyCost) {
        for (uint8 layer = 2; layer < 9; ++layer) {
            uint16 currentTrait = uint16(currentTraits >> (uint256(layer) * 16));
            if (currentTrait == 0) continue;
            for (uint256 i; i < 201; ++i) {
                uint256 cursor = i * 17;
                if (uint8(encodedRecords[cursor]) != layer) continue;
                uint16 candidate = _uint16(encodedRecords, cursor + 1);
                if (candidate == currentTrait) continue;
                uint256 shift = uint256(layer) * 16;
                uint256 replaced =
                    (currentTraits & ~(uint256(0xffff) << shift)) | (uint256(candidate) << shift);
                try controller.quoteEnergy(tokenId, layer, candidate) returns (uint256 quoted) {
                    return (replaced, layer, quoted);
                } catch { }
            }
        }
        revert("no compatible single reroll");
    }

    function _signature(uint256 privateKey, bytes32 digest)
        private
        returns (bytes memory signature)
    {
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _address(bytes memory data, uint256 cursor) private pure returns (address result) {
        uint160 value;
        for (uint256 i; i < 20; ++i) {
            value = (value << 8) | uint160(uint8(data[cursor + i]));
        }
        result = address(value);
    }

    function _uint16(bytes memory data, uint256 cursor) private pure returns (uint16) {
        return (uint16(uint8(data[cursor])) << 8) | uint16(uint8(data[cursor + 1]));
    }

    function _uint32(bytes memory data, uint256 cursor) private pure returns (uint32) {
        return (uint32(uint8(data[cursor])) << 24) | (uint32(uint8(data[cursor + 1])) << 16)
            | (uint32(uint8(data[cursor + 2])) << 8) | uint32(uint8(data[cursor + 3]));
    }

    function _uint144(bytes memory data, uint256 cursor) private pure returns (uint256 value) {
        for (uint256 i; i < 18; ++i) {
            value = (value << 8) | uint8(data[cursor + i]);
        }
    }

    function _slice(bytes memory source, uint256 start, uint256 length)
        private
        pure
        returns (bytes memory output)
    {
        output = new bytes(length);
        assembly ("memory-safe") {
            let sourceCursor := add(add(source, 0x20), start)
            let outputCursor := add(output, 0x20)
            let end := add(sourceCursor, length)
            for { } lt(sourceCursor, end) {
                sourceCursor := add(sourceCursor, 0x20)
                outputCursor := add(outputCursor, 0x20)
            } { mstore(outputCursor, mload(sourceCursor)) }
        }
    }
}

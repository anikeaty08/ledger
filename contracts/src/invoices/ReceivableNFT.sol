// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

interface IRegistryView {
    function tokenURIFor(uint256 id) external view returns (string memory);
}

/// @title ReceivableNFT
/// @notice ERC-721 claim on a client-accepted invoice. tokenId == invoiceId.
///         Minted by the InvoiceRegistry when the client accepts. Freely transferable so receivables are
///         composable: whoever holds the NFT receives the settlement remainder.
contract ReceivableNFT is ERC721 {
    address public immutable registry;

    error OnlyRegistry();

    constructor(address registry_) ERC721("Ledger Receivable", "LRCV") {
        registry = registry_;
    }

    function mint(address to, uint256 id) external {
        if (msg.sender != registry) revert OnlyRegistry();
        _mint(to, id);
    }

    function exists(uint256 id) external view returns (bool) {
        return _ownerOf(id) != address(0);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return IRegistryView(registry).tokenURIFor(id);
    }
}

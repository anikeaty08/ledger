// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed} from "../interfaces/IMezo.sol";
import {LedgerAccount} from "./LedgerAccount.sol";

/// @title LedgerAccountFactory
/// @notice One deterministic LedgerAccount clone per user, plus the shared Mezo wiring accounts read.
contract LedgerAccountFactory is Ownable2Step {
    address public immutable implementation;
    IBorrowerOperations public immutable borrowerOperations;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IERC20 public immutable musd;

    address public router;
    uint16 public minICRBps = 15_000; // Keep-BTC mints may not leave the trove below 150%

    mapping(address => address) public accountOf;

    event AccountCreated(address indexed user, address account);
    event RouterSet(address router);
    event MinICRSet(uint16 bps);

    error AlreadyExists();
    error BadParams();

    constructor(
        address owner_,
        IBorrowerOperations bo_,
        ITroveManager tm_,
        IPriceFeed pf_,
        IERC20 musd_
    ) Ownable(owner_) {
        implementation = address(new LedgerAccount());
        borrowerOperations = bo_;
        troveManager = tm_;
        priceFeed = pf_;
        musd = musd_;
    }

    function setRouter(address r) external onlyOwner {
        router = r;
        emit RouterSet(r);
    }

    function setMinICR(uint16 bps) external onlyOwner {
        if (bps < 11_000) revert BadParams();
        minICRBps = bps;
        emit MinICRSet(bps);
    }

    function predict(address user) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, bytes32(uint256(uint160(user))));
    }

    function createAccount() external returns (address account) {
        if (accountOf[msg.sender] != address(0)) revert AlreadyExists();
        account = Clones.cloneDeterministic(implementation, bytes32(uint256(uint160(msg.sender))));
        LedgerAccount(payable(account)).initialize(msg.sender);
        accountOf[msg.sender] = account;
        emit AccountCreated(msg.sender, account);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Splitter} from "./Splitter.sol";

/// @title SplitterFactory
/// @notice Deterministic splitter clones: the same (recipients, bps) always maps to the same address,
///         so a team's split is reusable and verifiable before it is deployed.
contract SplitterFactory {
    address public immutable implementation;

    event SplitterCreated(address indexed splitter, address[] recipients, uint16[] bps);

    constructor() {
        implementation = address(new Splitter());
    }

    function salt(address[] calldata recipients, uint16[] calldata bps) public pure returns (bytes32) {
        return keccak256(abi.encode(recipients, bps));
    }

    function predict(address[] calldata recipients, uint16[] calldata bps) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, salt(recipients, bps));
    }

    function getOrCreate(address[] calldata recipients, uint16[] calldata bps) external returns (address s) {
        bytes32 salt_ = salt(recipients, bps);
        s = Clones.predictDeterministicAddress(implementation, salt_);
        if (s.code.length > 0) return s;
        s = Clones.cloneDeterministic(implementation, salt_);
        Splitter(s).initialize(recipients, bps);
        emit SplitterCreated(s, recipients, bps);
    }
}

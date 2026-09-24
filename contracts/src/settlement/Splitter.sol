// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Splitter
/// @notice Immutable percentage split (minimal-proxy clone). `distribute` pushes each recipient's share;
///         if a push fails (e.g. a blocklisted recipient) the share is credited for `claim` instead, so one
///         bad recipient can never block the others.
contract Splitter is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address[] internal _recipients;
    uint16[] internal _bps;
    mapping(address => mapping(address => uint256)) public owed; // token => recipient => amount
    mapping(address => uint256) public totalOwed; // token => amount reserved for pull claims

    event Distributed(address indexed token, uint256 amount);
    event Credited(address indexed token, address indexed recipient, uint256 amount);
    event Claimed(address indexed token, address indexed recipient, uint256 amount);

    error BadConfig();

    constructor() {
        _disableInitializers();
    }

    function initialize(address[] calldata recipients_, uint16[] calldata bps_) external initializer {
        if (recipients_.length == 0 || recipients_.length != bps_.length || recipients_.length > 20) {
            revert BadConfig();
        }
        uint256 sum;
        for (uint256 i; i < bps_.length; ++i) {
            if (recipients_[i] == address(0) || bps_[i] == 0) revert BadConfig();
            sum += bps_[i];
        }
        if (sum != 10_000) revert BadConfig();
        _recipients = recipients_;
        _bps = bps_;
    }

    function recipients() external view returns (address[] memory, uint16[] memory) {
        return (_recipients, _bps);
    }

    function distribute(address token) external nonReentrant {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 reserved = totalOwed[token];
        if (bal <= reserved) return;
        uint256 amount = bal - reserved;
        uint256 sent;
        uint256 n = _recipients.length;
        for (uint256 i; i < n; ++i) {
            uint256 share = i == n - 1 ? amount - sent : (amount * _bps[i]) / 10_000;
            sent += share;
            if (share == 0) continue;
            address r = _recipients[i];
            if (!_tryTransfer(token, r, share)) {
                owed[token][r] += share;
                totalOwed[token] += share;
                emit Credited(token, r, share);
            }
        }
        emit Distributed(token, amount);
    }

    function claim(address token) external nonReentrant {
        uint256 amount = owed[token][msg.sender];
        owed[token][msg.sender] = 0;
        totalOwed[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Claimed(token, msg.sender, amount);
    }

    function _tryTransfer(address token, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }
}

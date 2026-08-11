// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {MockERC20} from "./MockERC20.sol";
contract MockUSDC is MockERC20 { constructor() MockERC20("Mock USD Coin", "USDC", 6) {} }

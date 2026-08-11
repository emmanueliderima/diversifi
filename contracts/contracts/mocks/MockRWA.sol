// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {MockERC20} from "./MockERC20.sol";
contract MockRWA is MockERC20 { constructor() MockERC20("Mock Real World Asset", "RWA", 18) {} }

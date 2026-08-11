// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {MockERC20} from "./MockERC20.sol";
contract MockWETH is MockERC20 { constructor() MockERC20("Mock Wrapped Ether", "WETH", 18) {} }

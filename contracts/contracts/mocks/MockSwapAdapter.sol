// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ISwapAdapter, IERC20} from "../Vault.sol";
import {MockSwapRouter} from "./MockSwapRouter.sol";
contract MockSwapAdapter is ISwapAdapter { MockSwapRouter public immutable router; constructor(MockSwapRouter r){router=r;} function swap(address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,bytes calldata) external returns(uint256){require(IERC20(tokenIn).transferFrom(msg.sender,address(this),amountIn),"in");require(IERC20(tokenIn).approve(address(router),0),"reset");require(IERC20(tokenIn).approve(address(router),amountIn),"approve");return router.swapExactInput(tokenIn,tokenOut,amountIn,minAmountOut,msg.sender);} }

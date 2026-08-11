// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {IERC20} from "../Vault.sol";
/// @dev Deterministic, pre-funded local router. Rates use 1e18 output-token units per input-token unit.
contract MockSwapRouter {
    uint256 public constant RATE_SCALE = 1e18;
    mapping(address => mapping(address => uint256)) public rate;
    error InvalidRate(); error InsufficientOutput(uint256,uint256);
    function setRate(address tokenIn,address tokenOut,uint256 rateWad) external {if(tokenIn==address(0)||tokenOut==address(0)||rateWad==0) revert InvalidRate();rate[tokenIn][tokenOut]=rateWad;}
    function quote(address tokenIn,address tokenOut,uint256 amountIn) public view returns(uint256){return amountIn*rate[tokenIn][tokenOut]/RATE_SCALE;}
    function swapExactInput(address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,address recipient) external returns(uint256 amountOut){amountOut=quote(tokenIn,tokenOut,amountIn);if(amountOut<minAmountOut) revert InsufficientOutput(amountOut,minAmountOut);require(IERC20(tokenIn).transferFrom(msg.sender,address(this),amountIn),"input");require(IERC20(tokenOut).transfer(recipient,amountOut),"output");}
}

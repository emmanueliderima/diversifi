// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
contract MockPriceFeed { uint8 public immutable decimals; int256 private answer; uint256 private updatedAt; constructor(uint8 d,int256 a){decimals=d;answer=a;updatedAt=block.timestamp;} function setAnswer(int256 a) external {answer=a;updatedAt=block.timestamp;} function setUpdatedAt(uint256 t) external {updatedAt=t;} function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80){return(1,answer,updatedAt,updatedAt,1);} }

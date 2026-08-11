// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20Metadata { function decimals() external view returns (uint8); }
interface IAggregatorV3 { function decimals() external view returns (uint8); function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80); }

contract AssetRegistry {
    struct AssetConfig { bool exists; bool active; address priceFeed; uint8 tokenDecimals; uint8 priceFeedDecimals; uint32 maxPriceAge; }
    address public owner; address public pendingOwner;
    mapping(address => AssetConfig) private assets;
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner); event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event AssetRegistered(address indexed token, address indexed priceFeed, uint32 maxPriceAge); event AssetUpdated(address indexed token, address indexed priceFeed, uint32 maxPriceAge); event AssetStatusChanged(address indexed token, bool active);
    error Unauthorized(); error ZeroAddress(); error AssetAlreadyRegistered(address); error AssetNotRegistered(address); error InvalidDecimals(address,uint8); error InvalidPriceAge(uint32);
    modifier onlyOwner(){if(msg.sender!=owner) revert Unauthorized(); _;}
    constructor(address initialOwner){if(initialOwner==address(0)) revert ZeroAddress(); owner=initialOwner;}
    function transferOwnership(address next) external onlyOwner {if(next==address(0)) revert ZeroAddress(); pendingOwner=next; emit OwnershipTransferStarted(owner,next);}
    function acceptOwnership() external {if(msg.sender!=pendingOwner) revert Unauthorized(); address old=owner; owner=msg.sender; pendingOwner=address(0); emit OwnershipTransferred(old,msg.sender);}
    function getAsset(address token) external view returns(AssetConfig memory){return assets[token];}
    function isRegistered(address token) external view returns(bool){return assets[token].exists;}
    function isActive(address token) external view returns(bool){return assets[token].active;}
    function registerAsset(address token,address feed,uint32 age) external onlyOwner {if(assets[token].exists) revert AssetAlreadyRegistered(token); _set(token,feed,age); assets[token].exists=true; assets[token].active=true; emit AssetRegistered(token,feed,age);}
    function updateAsset(address token,address feed,uint32 age) external onlyOwner {if(!assets[token].exists) revert AssetNotRegistered(token); _set(token,feed,age); emit AssetUpdated(token,feed,age);}
    function disableAsset(address token) external onlyOwner {if(!assets[token].exists) revert AssetNotRegistered(token); assets[token].active=false; emit AssetStatusChanged(token,false);}
    function enableAsset(address token) external onlyOwner {if(!assets[token].exists) revert AssetNotRegistered(token); assets[token].active=true; emit AssetStatusChanged(token,true);}
    function _set(address token,address feed,uint32 age) private {if(token==address(0)||feed==address(0)) revert ZeroAddress(); if(age==0) revert InvalidPriceAge(age); uint8 td=IERC20Metadata(token).decimals(); uint8 fd=IAggregatorV3(feed).decimals(); if(td>36) revert InvalidDecimals(token,td); if(fd>36) revert InvalidDecimals(feed,fd); AssetConfig storage a=assets[token]; a.priceFeed=feed;a.tokenDecimals=td;a.priceFeedDecimals=fd;a.maxPriceAge=age;}
}

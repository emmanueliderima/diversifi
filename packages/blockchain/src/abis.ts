import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
]);

export const chainlinkAggregatorV3Abi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
]);

export const assetRegistryAbi = parseAbi([
  "function getAsset(address token) view returns ((bool exists, bool active, address priceFeed, uint8 tokenDecimals, uint8 priceFeedDecimals, uint32 maxPriceAge))",
  "function isActive(address token) view returns (bool)",
  "function isRegistered(address token) view returns (bool)"
]);

export const vaultFactoryAbi = parseAbi([
  "function createVault((address baseAsset, address executor, (uint16 maxAllocationPerAssetBps, uint16 maxSlippageBps, uint64 minRebalanceInterval) config, address[] allowedAssets) init) returns (address vault)",
  "function vaultOf(address owner) view returns (address)",
  "function isVault(address vault) view returns (bool)"
]);

export const vaultAbi = parseAbi([
  "function config() view returns (uint16 maxAllocationPerAssetBps, uint16 maxSlippageBps, uint64 minRebalanceInterval)",
  "function automationPaused() view returns (bool)",
  "function baseAsset() view returns (address)",
  "function executor() view returns (address)",
  "function lastRebalance() view returns (uint64)",
  "function owner() view returns (address)",
  "function allowedAssets() view returns (address[])",
  "function deposit(uint256 amount)",
  "function withdraw(address asset, uint256 amount)",
  "function addAllowedAsset(address asset)",
  "function removeAllowedAsset(address asset)",
  "function updateConfig((uint16 maxAllocationPerAssetBps, uint16 maxSlippageBps, uint64 minRebalanceInterval) config)",
  "function pauseAutomation()",
  "function unpauseAutomation()",
  "function setExecutor(address executor)"
]);

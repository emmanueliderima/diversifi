import type { Address } from "viem";

export interface ContractAddresses { vaultFactory: Address; assetRegistry: Address; }
export interface VaultConfig { maxAllocationPerAssetBps: number; maxSlippageBps: number; minRebalanceInterval: bigint; }
export interface VaultState extends VaultConfig { baseAsset: Address; executor: Address; owner: Address; automationPaused: boolean; lastRebalance: bigint; }
export interface RegisteredAsset { exists: boolean; active: boolean; priceFeed: Address; tokenDecimals: number; priceFeedDecimals: number; maxPriceAge: number; }
export interface VaultBalance { asset: Address; balance: bigint; }
export interface CreateVaultParams { baseAsset: Address; executor: Address; config: VaultConfig; allowedAssets: Address[]; }

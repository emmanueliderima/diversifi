export const BPS_DENOMINATOR = 10_000n;
/** All USD values in domain objects use this fixed-point precision. */
export const USD_VALUE_DECIMALS = 18;

export type Address = `0x${string}`;

export interface Asset {
  token: Address;
  symbol: string;
  decimals: number;
}

export interface VaultConstraints {
  allowedAssets: Address[];
  maxAllocationPerAssetBps: bigint;
  maxSlippageBps: bigint;
  minRebalanceInterval: bigint;
  paused: boolean;
}

export interface PortfolioPosition {
  asset: Asset;
  /** Raw ERC-20 base units, as returned by `balanceOf`. */
  balance: bigint;
  /** Token/USD oracle answer in `priceDecimals` fixed-point units. */
  priceUsd: bigint;
  priceDecimals: number;
  /** USD value scaled by `USD_VALUE_DECIMALS`. */
  usdValue: bigint;
  allocationBps: bigint;
}

export interface PortfolioSnapshot {
  vaultAddress: Address;
  positions: PortfolioPosition[];
  /** Total USD value scaled by `USD_VALUE_DECIMALS`. */
  totalValueUsd: bigint;
  constraints: VaultConstraints;
}

export interface AllocationDecision {
  shouldRebalance: boolean;
  targetAllocationBps: Record<Address, bigint>;
  reasoning: string;
  confidence: "low" | "medium" | "high";
}

export interface TradeInstruction {
  sellAsset: Address;
  buyAsset: Address;
  sellUsdValue: bigint;
}

export interface TradePlan {
  vaultAddress: Address;
  trades: TradeInstruction[];
}

export type RebalanceJobStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "NO_ACTION";

export interface RebalanceJob {
  id: string;
  vaultAddress: Address;
  status: RebalanceJobStatus;
  createdAt: Date;
}

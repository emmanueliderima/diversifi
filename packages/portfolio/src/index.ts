import {
  BPS_DENOMINATOR,
  USD_VALUE_DECIMALS,
  type Address,
  type AllocationDifference,
  type PortfolioPosition,
  type PortfolioSnapshot,
  type TradePlan,
  type VaultConstraints
} from "@diversifi/types";

export { BPS_DENOMINATOR, USD_VALUE_DECIMALS };

export interface PricedBalance {
  asset: PortfolioPosition["asset"];
  balance: bigint;
  priceUsd: bigint;
  priceDecimals: number;
}

export interface TradeThresholds {
  /** Ignore a proposed asset change smaller than this 18-decimal USD amount. */
  minTradeUsdValue?: bigint;
  /** Ignore an asset whose allocation drift is smaller than this BPS amount. */
  rebalanceThresholdBps?: bigint;
}

function powerOfTen(decimals: number): bigint {
  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    throw new RangeError(`Invalid decimal precision: ${decimals}`);
  }
  return 10n ** BigInt(decimals);
}

/**
 * Converts raw ERC-20 base units and a raw token/USD oracle answer to the
 * common 18-decimal USD representation. Division intentionally rounds down.
 */
export function calculateUsdValue(
  balance: bigint,
  tokenDecimals: number,
  priceUsd: bigint,
  priceDecimals: number
): bigint {
  if (balance < 0n) throw new RangeError("Token balance cannot be negative");
  if (priceUsd < 0n) throw new RangeError("USD price cannot be negative");
  return (balance * priceUsd * powerOfTen(USD_VALUE_DECIMALS)) /
    (powerOfTen(tokenDecimals) * powerOfTen(priceDecimals));
}

export function calculateAllocationBps(value: bigint, totalValue: bigint): bigint {
  if (value < 0n || totalValue < 0n) throw new RangeError("Portfolio values cannot be negative");
  if (totalValue === 0n) return 0n;
  return (value * BPS_DENOMINATOR) / totalValue;
}

export function calculateTargetValue(totalValue: bigint, allocationBps: bigint): bigint {
  if (totalValue < 0n) throw new RangeError("Portfolio value cannot be negative");
  if (allocationBps < 0n || allocationBps > BPS_DENOMINATOR) {
    throw new RangeError("Target allocation must be between 0 and 10,000 BPS");
  }
  return (totalValue * allocationBps) / BPS_DENOMINATOR;
}

export function calculatePortfolioValue(positions: Pick<PortfolioPosition, "usdValue">[]): bigint {
  return positions.reduce((total, position) => {
    if (position.usdValue < 0n) throw new RangeError("Portfolio values cannot be negative");
    return total + position.usdValue;
  }, 0n);
}

/** Returns each known asset's current allocation, including zero-value positions. */
export function calculateCurrentAllocations(
  positions: Pick<PortfolioPosition, "asset" | "usdValue">[]
): Map<Address, bigint> {
  const totalValue = calculatePortfolioValue(positions);
  return new Map(positions.map((position) => [
    position.asset.token,
    calculateAllocationBps(position.usdValue, totalValue)
  ]));
}

export function assertValidTargetAllocation(targetAllocationBps: Record<Address, bigint>): void {
  const allocations = Object.values(targetAllocationBps);
  const total = allocations.reduce((sum, allocation) => {
    if (allocation < 0n || allocation > BPS_DENOMINATOR) {
      throw new RangeError("Target allocation must be between 0 and 10,000 BPS");
    }
    return sum + allocation;
  }, 0n);
  if (total !== BPS_DENOMINATOR) {
    throw new RangeError("Target allocations must sum to 10,000 BPS");
  }
}

/** Converts a valid BPS target into 18-decimal USD values, rounding down per asset. */
export function calculateTargetValues(
  totalValue: bigint,
  targetAllocationBps: Record<Address, bigint>
): Map<Address, bigint> {
  assertValidTargetAllocation(targetAllocationBps);
  return new Map(Object.entries(targetAllocationBps).map(([asset, allocation]) => [
    asset as Address,
    calculateTargetValue(totalValue, allocation)
  ]));
}

/** Builds the normalized, deterministic portion of a vault portfolio snapshot. */
export function buildPortfolioSnapshot(input: {
  vaultAddress: Address;
  constraints: VaultConstraints;
  balances: PricedBalance[];
}): PortfolioSnapshot {
  const values = input.balances.map((position) => ({
    ...position,
    usdValue: calculateUsdValue(
      position.balance,
      position.asset.decimals,
      position.priceUsd,
      position.priceDecimals
    )
  }));
  const totalValueUsd = calculatePortfolioValue(values);

  return {
    vaultAddress: input.vaultAddress,
    constraints: input.constraints,
    totalValueUsd,
    positions: values.map((position) => ({
      ...position,
      allocationBps: calculateAllocationBps(position.usdValue, totalValueUsd)
    }))
  };
}

export function calculateTargetDeltas(
  positions: Pick<PortfolioPosition, "asset" | "usdValue">[],
  targetAllocationBps: Record<Address, bigint>
): Map<Address, bigint> {
  assertValidTargetAllocation(targetAllocationBps);
  const totalValue = calculatePortfolioValue(positions);
  const current = new Map(positions.map((position) => [position.asset.token, position.usdValue]));
  const assets = new Set<Address>([...current.keys(), ...Object.keys(targetAllocationBps) as Address[]]);
  return new Map([...assets].map((asset) => [asset, calculateTargetValue(totalValue, targetAllocationBps[asset] ?? 0n) - (current.get(asset) ?? 0n)]));
}

/**
 * Compares current holdings with a complete target. The output order is stable:
 * current positions first, then target-only assets in target object order.
 */
export function calculateAllocationDifferences(
  positions: Pick<PortfolioPosition, "asset" | "usdValue">[],
  targetAllocationBps: Record<Address, bigint>
): AllocationDifference[] {
  assertValidTargetAllocation(targetAllocationBps);
  const totalValue = calculatePortfolioValue(positions);
  const currentAllocations = calculateCurrentAllocations(positions);
  const currentValues = new Map(positions.map((position) => [position.asset.token, position.usdValue]));
  const assets = new Set<Address>([
    ...positions.map((position) => position.asset.token),
    ...Object.keys(targetAllocationBps) as Address[]
  ]);

  return [...assets].map((asset) => {
    const currentUsdValue = currentValues.get(asset) ?? 0n;
    const targetAllocation = targetAllocationBps[asset] ?? 0n;
    const targetUsdValue = calculateTargetValue(totalValue, targetAllocation);
    return {
      asset,
      currentUsdValue,
      targetUsdValue,
      deltaUsdValue: targetUsdValue - currentUsdValue,
      currentAllocationBps: currentAllocations.get(asset) ?? 0n,
      targetAllocationBps: targetAllocation
    };
  });
}

/** Applies minimum USD trade size and allocation-drift policies without mutating input. */
export function filterAllocationDifferences(
  differences: AllocationDifference[],
  thresholds: TradeThresholds = {}
): AllocationDifference[] {
  const minTradeUsdValue = thresholds.minTradeUsdValue ?? 0n;
  const rebalanceThresholdBps = thresholds.rebalanceThresholdBps ?? 0n;
  if (minTradeUsdValue < 0n || rebalanceThresholdBps < 0n) {
    throw new RangeError("Trade thresholds cannot be negative");
  }
  return differences.filter((difference) => {
    const absoluteDelta = difference.deltaUsdValue < 0n ? -difference.deltaUsdValue : difference.deltaUsdValue;
    const allocationDrift = difference.currentAllocationBps >= difference.targetAllocationBps
      ? difference.currentAllocationBps - difference.targetAllocationBps
      : difference.targetAllocationBps - difference.currentAllocationBps;
    return absoluteDelta >= minTradeUsdValue && allocationDrift >= rebalanceThresholdBps;
  });
}

/**
 * Greedily pairs deterministic sells with buys. It only emits fully-funded
 * swaps; rounding dust and threshold-filtered residuals stay in the vault.
 */
export function createTradePlan(
  vaultAddress: Address,
  differences: AllocationDifference[]
): TradePlan {
  const sells = differences
    .filter((difference) => difference.deltaUsdValue < 0n)
    .map((difference) => ({ asset: difference.asset, remaining: -difference.deltaUsdValue }));
  const buys = differences
    .filter((difference) => difference.deltaUsdValue > 0n)
    .map((difference) => ({ asset: difference.asset, remaining: difference.deltaUsdValue }));
  const trades: TradePlan["trades"] = [];
  let sellIndex = 0;
  let buyIndex = 0;

  while (sellIndex < sells.length && buyIndex < buys.length) {
    const sell = sells[sellIndex]!;
    const buy = buys[buyIndex]!;
    const sellUsdValue = sell.remaining < buy.remaining ? sell.remaining : buy.remaining;
    if (sellUsdValue > 0n) trades.push({ sellAsset: sell.asset, buyAsset: buy.asset, sellUsdValue });
    sell.remaining -= sellUsdValue;
    buy.remaining -= sellUsdValue;
    if (sell.remaining === 0n) sellIndex += 1;
    if (buy.remaining === 0n) buyIndex += 1;
  }

  return { vaultAddress, trades };
}

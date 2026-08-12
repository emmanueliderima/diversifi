import {
  BPS_DENOMINATOR,
  USD_VALUE_DECIMALS,
  type Address,
  type PortfolioPosition,
  type PortfolioSnapshot,
  type VaultConstraints
} from "@diversifi/types";

export { BPS_DENOMINATOR, USD_VALUE_DECIMALS };

export interface PricedBalance {
  asset: PortfolioPosition["asset"];
  balance: bigint;
  priceUsd: bigint;
  priceDecimals: number;
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
  if (totalValue === 0n) return 0n;
  return (value * BPS_DENOMINATOR) / totalValue;
}

export function calculateTargetValue(totalValue: bigint, allocationBps: bigint): bigint {
  return (totalValue * allocationBps) / BPS_DENOMINATOR;
}

export function calculatePortfolioValue(positions: Pick<PortfolioPosition, "usdValue">[]): bigint {
  return positions.reduce((total, position) => total + position.usdValue, 0n);
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
  const totalValue = calculatePortfolioValue(positions);
  const current = new Map(positions.map((position) => [position.asset.token, position.usdValue]));
  const assets = new Set<Address>([...current.keys(), ...Object.keys(targetAllocationBps) as Address[]]);
  return new Map([...assets].map((asset) => [asset, calculateTargetValue(totalValue, targetAllocationBps[asset] ?? 0n) - (current.get(asset) ?? 0n)]));
}

import { BPS_DENOMINATOR, type Address, type PortfolioPosition } from "@diversifi/types";

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

export function calculateTargetDeltas(
  positions: Pick<PortfolioPosition, "asset" | "usdValue">[],
  targetAllocationBps: Record<Address, bigint>
): Map<Address, bigint> {
  const totalValue = calculatePortfolioValue(positions);
  const current = new Map(positions.map((position) => [position.asset.token, position.usdValue]));
  const assets = new Set<Address>([...current.keys(), ...Object.keys(targetAllocationBps) as Address[]]);
  return new Map([...assets].map((asset) => [asset, calculateTargetValue(totalValue, targetAllocationBps[asset] ?? 0n) - (current.get(asset) ?? 0n)]));
}


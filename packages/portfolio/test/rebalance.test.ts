import { describe, expect, test } from "bun:test";
import {
  assertValidTargetAllocation,
  calculateAllocationDifferences,
  calculateCurrentAllocations,
  calculatePortfolioValue,
  calculateTargetDeltas,
  calculateTargetValues,
  createTradePlan,
  filterAllocationDifferences
} from "../src/index.js";
import type { Address, PortfolioPosition } from "@diversifi/types";

const usd = 10n ** 18n;
const vault = "0x0000000000000000000000000000000000000001" as Address;
const btc = "0x0000000000000000000000000000000000000002" as Address;
const eth = "0x0000000000000000000000000000000000000003" as Address;
const usdc = "0x0000000000000000000000000000000000000004" as Address;
const rwa = "0x0000000000000000000000000000000000000005" as Address;

function position(token: Address, value: bigint): PortfolioPosition {
  return {
    asset: { token, symbol: "TEST", decimals: 18 }, balance: value,
    priceUsd: usd, priceDecimals: 18, usdValue: value, allocationBps: 0n
  };
}

const portfolio = [position(btc, 200n * usd), position(eth, 300n * usd), position(usdc, 500n * usd)];
const target = { [btc]: 4000n, [eth]: 3000n, [usdc]: 2000n, [rwa]: 1000n };

describe("portfolio valuation and allocation", () => {
  test("sums position values exactly", () => {
    expect(calculatePortfolioValue(portfolio)).toBe(1_000n * usd);
  });

  test("derives current allocations for every held asset", () => {
    expect([...calculateCurrentAllocations(portfolio)]).toEqual([
      [btc, 2000n], [eth, 3000n], [usdc, 5000n]
    ]);
  });

  test("returns zero allocation for every asset in an empty portfolio", () => {
    expect(calculatePortfolioValue([])).toBe(0n);
    expect([...calculateCurrentAllocations([position(btc, 0n), position(usdc, 0n)])]).toEqual([
      [btc, 0n], [usdc, 0n]
    ]);
  });

  test("rejects invalid negative portfolio values", () => {
    expect(() => calculatePortfolioValue([position(btc, -1n)])).toThrow("cannot be negative");
  });
});

describe("target allocation", () => {
  test("converts target BPS to deterministic USD values", () => {
    expect([...calculateTargetValues(1_000n * usd, target)]).toEqual([
      [btc, 400n * usd], [eth, 300n * usd], [usdc, 200n * usd], [rwa, 100n * usd]
    ]);
  });

  test("floors target-value remainder rather than inventing value", () => {
    const thirds = { [btc]: 3333n, [eth]: 3333n, [usdc]: 3334n };
    const values = calculateTargetValues(10n, thirds);
    expect([...values.values()]).toEqual([3n, 3n, 3n]);
    expect([...values.values()].reduce((sum, value) => sum + value, 0n)).toBe(9n);
  });

  test("requires a complete valid 10,000 BPS target", () => {
    expect(() => assertValidTargetAllocation({ [btc]: 9_999n })).toThrow("sum to 10,000");
    expect(() => assertValidTargetAllocation({ [btc]: 10_001n, [eth]: -1n })).toThrow("between 0 and 10,000");
  });
});

describe("allocation differences", () => {
  test("identifies required BTC/RWA buys and USDC sale", () => {
    const differences = calculateAllocationDifferences(portfolio, target);
    expect(differences).toEqual([
      { asset: btc, currentUsdValue: 200n * usd, targetUsdValue: 400n * usd, deltaUsdValue: 200n * usd, currentAllocationBps: 2000n, targetAllocationBps: 4000n },
      { asset: eth, currentUsdValue: 300n * usd, targetUsdValue: 300n * usd, deltaUsdValue: 0n, currentAllocationBps: 3000n, targetAllocationBps: 3000n },
      { asset: usdc, currentUsdValue: 500n * usd, targetUsdValue: 200n * usd, deltaUsdValue: -300n * usd, currentAllocationBps: 5000n, targetAllocationBps: 2000n },
      { asset: rwa, currentUsdValue: 0n, targetUsdValue: 100n * usd, deltaUsdValue: 100n * usd, currentAllocationBps: 0n, targetAllocationBps: 1000n }
    ]);
  });

  test("keeps backward-compatible target deltas consistent with differences", () => {
    const deltas = calculateTargetDeltas(portfolio, target);
    expect(deltas.get(btc)).toBe(200n * usd);
    expect(deltas.get(usdc)).toBe(-300n * usd);
    expect(deltas.get(rwa)).toBe(100n * usd);
  });

  test("includes a target-only asset at zero current allocation", () => {
    const differences = calculateAllocationDifferences([], { [btc]: 10_000n });
    expect(differences).toEqual([{
      asset: btc, currentUsdValue: 0n, targetUsdValue: 0n, deltaUsdValue: 0n,
      currentAllocationBps: 0n, targetAllocationBps: 10_000n
    }]);
  });
});

describe("threshold filtering", () => {
  const differences = calculateAllocationDifferences(portfolio, target);

  test("filters insignificant USD changes but keeps values exactly at the threshold", () => {
    expect(filterAllocationDifferences(differences, { minTradeUsdValue: 200n * usd }).map(({ asset }) => asset))
      .toEqual([btc, usdc]);
    expect(filterAllocationDifferences(differences, { minTradeUsdValue: 301n * usd })).toEqual([]);
  });

  test("filters by allocation drift BPS independently of USD value", () => {
    expect(filterAllocationDifferences(differences, { rebalanceThresholdBps: 2_000n }).map(({ asset }) => asset))
      .toEqual([btc, usdc]);
    expect(filterAllocationDifferences(differences, { rebalanceThresholdBps: 3_001n })).toEqual([]);
  });

  test("combines both thresholds and rejects negative policies", () => {
    expect(filterAllocationDifferences(differences, { minTradeUsdValue: 150n * usd, rebalanceThresholdBps: 1_500n }).map(({ asset }) => asset))
      .toEqual([btc, usdc]);
    expect(() => filterAllocationDifferences(differences, { minTradeUsdValue: -1n })).toThrow("cannot be negative");
  });
});

describe("trade-plan creation", () => {
  test("pairs the USDC sale with BTC and RWA buys deterministically", () => {
    const plan = createTradePlan(vault, calculateAllocationDifferences(portfolio, target));
    expect(plan).toEqual({ vaultAddress: vault, trades: [
      { sellAsset: usdc, buyAsset: btc, sellUsdValue: 200n * usd },
      { sellAsset: usdc, buyAsset: rwa, sellUsdValue: 100n * usd }
    ] });
  });

  test("creates no swap for a portfolio already at target", () => {
    const atTarget = [position(btc, 400n * usd), position(eth, 300n * usd), position(usdc, 200n * usd), position(rwa, 100n * usd)];
    expect(createTradePlan(vault, calculateAllocationDifferences(atTarget, target)).trades).toEqual([]);
  });

  test("never emits an unfunded trade when target rounding leaves dust", () => {
    const differences = calculateAllocationDifferences(
      [position(usdc, 10n)],
      { [btc]: 3333n, [eth]: 3333n, [rwa]: 3334n }
    );
    const plan = createTradePlan(vault, differences);
    expect(plan.trades).toEqual([
      { sellAsset: usdc, buyAsset: btc, sellUsdValue: 3n },
      { sellAsset: usdc, buyAsset: eth, sellUsdValue: 3n },
      { sellAsset: usdc, buyAsset: rwa, sellUsdValue: 3n }
    ]);
    expect(plan.trades.reduce((sum, trade) => sum + trade.sellUsdValue, 0n)).toBe(9n);
  });

  test("can use filtered differences as a conservative no-op plan", () => {
    const filtered = filterAllocationDifferences(calculateAllocationDifferences(portfolio, target), { minTradeUsdValue: 301n * usd });
    expect(createTradePlan(vault, filtered).trades).toEqual([]);
  });
});

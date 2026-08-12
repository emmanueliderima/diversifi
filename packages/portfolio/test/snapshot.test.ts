import { describe, expect, test } from "bun:test";
import {
  USD_VALUE_DECIMALS,
  buildPortfolioSnapshot,
  calculateAllocationBps,
  calculateUsdValue
} from "../src/index.js";
import type { Address, VaultConstraints } from "@diversifi/types";

const vault = "0x0000000000000000000000000000000000000001" as Address;
const usdc = "0x0000000000000000000000000000000000000002" as Address;
const weth = "0x0000000000000000000000000000000000000003" as Address;

const constraints: VaultConstraints = {
  allowedAssets: [usdc, weth],
  maxAllocationPerAssetBps: 10_000n,
  maxSlippageBps: 100n,
  minRebalanceInterval: 0n,
  paused: false
};

describe("calculateUsdValue", () => {
  test("normalizes six-decimal tokens and eight-decimal prices to 18-decimal USD", () => {
    expect(calculateUsdValue(500_000_000n, 6, 100_000_000n, 8)).toBe(500n * 10n ** 18n);
  });

  test("normalizes 18-decimal tokens without floating point loss", () => {
    // 0.25 WETH at $2,345.67890123
    expect(calculateUsdValue(250_000_000_000_000_000n, 18, 234_567_890_123n, 8))
      .toBe(586_419_725_307_500_000_000n);
  });

  test("supports feeds with 18 decimals", () => {
    expect(calculateUsdValue(2_500_000n, 6, 1_234_567_890_123_456_789n, 18))
      .toBe(3_086_419_725_308_641_972n);
  });

  test("rounds fractional USD values down deterministically", () => {
    // One smallest token unit worth $0.12345678 / 1e6.
    expect(calculateUsdValue(1n, 6, 12_345_678n, 8)).toBe(123_456_780_000n);
    // This value has more precision than the fixed-point USD representation.
    expect(calculateUsdValue(1n, 18, 1n, 8)).toBe(0n);
  });

  test("handles zero balances and rejects invalid signed inputs", () => {
    expect(calculateUsdValue(0n, 18, 2_000_000_00000n, 8)).toBe(0n);
    expect(() => calculateUsdValue(-1n, 18, 1n, 8)).toThrow("Token balance cannot be negative");
    expect(() => calculateUsdValue(1n, 18, -1n, 8)).toThrow("USD price cannot be negative");
  });
});

describe("buildPortfolioSnapshot", () => {
  test("derives total and floor-rounded allocation BPS", () => {
    const snapshot = buildPortfolioSnapshot({
      vaultAddress: vault,
      constraints,
      balances: [
        { asset: { token: usdc, symbol: "USDC", decimals: 6 }, balance: 500_000_000n, priceUsd: 100_000_000n, priceDecimals: 8 },
        { asset: { token: weth, symbol: "WETH", decimals: 18 }, balance: 250_000_000_000_000_000n, priceUsd: 2_000_000_00000n, priceDecimals: 8 }
      ]
    });

    expect(snapshot.totalValueUsd).toBe(1_000n * 10n ** BigInt(USD_VALUE_DECIMALS));
    expect(snapshot.positions.map((position) => position.allocationBps)).toEqual([5000n, 5000n]);
  });

  test("keeps zero-balance allowed assets and produces a safe empty-vault snapshot", () => {
    const snapshot = buildPortfolioSnapshot({
      vaultAddress: vault,
      constraints,
      balances: [
        { asset: { token: usdc, symbol: "USDC", decimals: 6 }, balance: 0n, priceUsd: 100_000_000n, priceDecimals: 8 },
        { asset: { token: weth, symbol: "WETH", decimals: 18 }, balance: 0n, priceUsd: 2_000_000_00000n, priceDecimals: 8 }
      ]
    });

    expect(snapshot.totalValueUsd).toBe(0n);
    expect(snapshot.positions).toHaveLength(2);
    expect(snapshot.positions.map((position) => position.allocationBps)).toEqual([0n, 0n]);
  });

  test("allocation uses integer floor rounding", () => {
    expect(calculateAllocationBps(1n, 3n)).toBe(3333n);
    expect(calculateAllocationBps(0n, 0n)).toBe(0n);
  });
});

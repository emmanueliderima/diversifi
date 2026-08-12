import { describe, expect, test } from "bun:test";
import { parseAllocationDecision } from "../src/index.js";
import type { Address, PortfolioSnapshot } from "@diversifi/types";

const usdc = "0x0000000000000000000000000000000000000001" as Address;
const weth = "0x0000000000000000000000000000000000000002" as Address;
const unapproved = "0x0000000000000000000000000000000000000003" as Address;
const snapshot = { constraints: { allowedAssets: [usdc, weth] } } as Pick<PortfolioSnapshot, "constraints">;

describe("parseAllocationDecision", () => {
  test("accepts only a valid allowed-asset allocation intent", () => {
    expect(parseAllocationDecision(snapshot, {
      shouldRebalance: true,
      targetAllocationBps: { [usdc]: "4000", [weth]: 6000 },
      explanation: "Increase the WETH allocation.",
      confidence: "medium"
    })).toEqual({
      shouldRebalance: true,
      targetAllocationBps: { [usdc]: 4000n, [weth]: 6000n },
      explanation: "Increase the WETH allocation.",
      confidence: "medium"
    });
  });

  test("allows no-action responses with no target and optional confidence", () => {
    expect(parseAllocationDecision(snapshot, {
      shouldRebalance: false,
      targetAllocationBps: {},
      explanation: "Current allocations remain within policy."
    })).toEqual({
      shouldRebalance: false,
      targetAllocationBps: {},
      explanation: "Current allocations remain within policy."
    });
  });

  test("rejects target allocations for assets outside the vault universe", () => {
    expect(() => parseAllocationDecision(snapshot, {
      shouldRebalance: true,
      targetAllocationBps: { [usdc]: 4000, [unapproved]: 6000 },
      explanation: "Buy an unapproved asset."
    })).toThrow("not allowed by this vault");
  });

  test("rejects malformed, fractional, out-of-range, and non-total targets", () => {
    const valid = { shouldRebalance: true, targetAllocationBps: { [usdc]: 4000, [weth]: 6000 }, explanation: "Valid." };
    expect(() => parseAllocationDecision(snapshot, { ...valid, targetAllocationBps: { [usdc]: 4000.5, [weth]: 5999.5 } })).toThrow();
    expect(() => parseAllocationDecision(snapshot, { ...valid, targetAllocationBps: { [usdc]: -1, [weth]: 10001 } })).toThrow();
    expect(() => parseAllocationDecision(snapshot, { ...valid, targetAllocationBps: { [usdc]: 4000, [weth]: 5000 } })).toThrow("sum to 10,000");
  });

  test("rejects execution instructions and all unknown fields", () => {
    expect(() => parseAllocationDecision(snapshot, {
      shouldRebalance: true,
      targetAllocationBps: { [usdc]: 4000, [weth]: 6000 },
      explanation: "Execute this.",
      calldata: "0xdeadbeef"
    })).toThrow();
    expect(() => parseAllocationDecision(snapshot, {
      shouldRebalance: true,
      targetAllocationBps: { [usdc]: 4000, [weth]: 6000 },
      explanation: "Execute this.",
      trades: [{ tokenIn: usdc, amountIn: "1000000" }]
    })).toThrow();
  });

  test("requires an empty target for no-action output", () => {
    expect(() => parseAllocationDecision(snapshot, {
      shouldRebalance: false,
      targetAllocationBps: { [usdc]: 10000 },
      explanation: "No action."
    })).toThrow("No-action decisions cannot include target allocations");
  });
});

import { describe, expect, test } from "bun:test";
import { AllocationAgentError, createMockAllocationAgent, createOpenRouterAllocationAgent, createOpenRouterAllocationAgentFromEnv } from "../src/index.js";
import type { Address, PortfolioSnapshot } from "@diversifi/types";

const usdc = "0x0000000000000000000000000000000000000001" as Address;
const weth = "0x0000000000000000000000000000000000000002" as Address;
const snapshot = {
  vaultAddress: "0x0000000000000000000000000000000000000003",
  positions: [], totalValueUsd: 1_000n,
  constraints: { allowedAssets: [usdc, weth], maxAllocationPerAssetBps: 10_000n, maxSlippageBps: 100n, minRebalanceInterval: 0n, paused: false }
} as PortfolioSnapshot;

describe("allocation agent adapters", () => {
  test("mock agent is deterministic but runs strict decision validation", async () => {
    const agent = createMockAllocationAgent({ shouldRebalance: true, targetAllocationBps: { [usdc]: 4000, [weth]: 6000 }, explanation: "Test allocation." });
    expect(await agent.analyze(snapshot)).toEqual({ shouldRebalance: true, targetAllocationBps: { [usdc]: 4000n, [weth]: 6000n }, explanation: "Test allocation." });
  });

  test("environment factory requires configured provider credentials and accepts a valid timeout", () => {
    expect(() => createOpenRouterAllocationAgentFromEnv({ OPENROUTER_MODEL: "free-model" })).toThrow("OPENROUTER_API_KEY is required");
    expect(() => createOpenRouterAllocationAgentFromEnv({ OPENROUTER_API_KEY: "test", OPENROUTER_MODEL: "free-model", OPENROUTER_TIMEOUT_MS: "zero" })).toThrow("positive integer");
    expect(createOpenRouterAllocationAgentFromEnv({ OPENROUTER_API_KEY: "test", OPENROUTER_MODEL: "free-model", OPENROUTER_TIMEOUT_MS: "20000" })).toBeDefined();
  });

  test("OpenRouter adapter serializes bigint snapshot values and validates its response", async () => {
    let request: unknown;
    const agent = createOpenRouterAllocationAgent({
      apiKey: "test-key", model: "provider/free-model", siteName: "Diversifi local",
      client: { chat: { send: async (value: unknown) => {
        request = value;
        return { choices: [{ finishReason: "stop", index: 0, message: { role: "assistant", content: JSON.stringify({ shouldRebalance: true, targetAllocationBps: { [usdc]: 4000, [weth]: 6000 }, explanation: "Increase WETH." }) } }], id: "test", created: 0, model: "test", object: "chat.completion" };
      } } } as never
    });
    expect((await agent.analyze(snapshot)).targetAllocationBps).toEqual({ [usdc]: 4000n, [weth]: 6000n });
    const sdkRequest = request as { responseFormat: { type: string }; messages: Array<{ content: string }> };
    expect(sdkRequest.responseFormat).toEqual({ type: "json_object" });
    expect(sdkRequest.messages[1]!.content).toContain('"totalValueUsd":"1000"');
  });

  test("fails closed on an OpenRouter refusal, malformed JSON, or invalid execution-shaped output", async () => {
    const clientFor = (content: string | null, refusal?: string) => ({ chat: { send: async () => ({ choices: [{ finishReason: "stop", index: 0, message: { role: "assistant", content, refusal } }], id: "test", created: 0, model: "test", object: "chat.completion" }) } }) as never;
    const refused = createOpenRouterAllocationAgent({ apiKey: "key", model: "free", client: clientFor(null, "No") });
    await expect(refused.analyze(snapshot)).rejects.toBeInstanceOf(AllocationAgentError);
    const malformed = createOpenRouterAllocationAgent({ apiKey: "key", model: "free", client: clientFor("not JSON") });
    await expect(malformed.analyze(snapshot)).rejects.toThrow("invalid JSON");
    const unsafe = createOpenRouterAllocationAgent({ apiKey: "key", model: "free", client: clientFor(JSON.stringify({ shouldRebalance: true, targetAllocationBps: { [usdc]: 4000, [weth]: 6000 }, explanation: "Bad", calldata: "0x1234" })) });
    await expect(unsafe.analyze(snapshot)).rejects.toThrow();
  });
});

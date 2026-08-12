import type { AllocationAgent, AllocationDecision, PortfolioSnapshot } from "@diversifi/types";
import { parseAllocationDecision } from "@diversifi/validation";
import { OpenRouter } from "@openrouter/sdk";

export type { AllocationAgent, AllocationDecision } from "@diversifi/types";

/**
 * Wrap an arbitrary AI-provider call with the only permitted agent boundary.
 * The provider gets a snapshot and may return allocation intent—never execution.
 */
export function createAllocationAgent(
  requestDecision: (snapshot: PortfolioSnapshot) => Promise<unknown>
): AllocationAgent {
  return {
    async analyze(snapshot: PortfolioSnapshot): Promise<AllocationDecision> {
      return parseAllocationDecision(snapshot, await requestDecision(snapshot));
    }
  };
}

export class AllocationAgentError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AllocationAgentError";
  }
}

export interface OpenRouterAllocationAgentOptions {
  apiKey: string;
  /** Configure a currently available free model in the environment; never hardcode it in domain code. */
  model: string;
  timeoutMs?: number;
  siteUrl?: string;
  siteName?: string;
  /** Injectable only for tests; production creates the official SDK client. */
  client?: Pick<OpenRouter, "chat">;
}

export interface OpenRouterEnvironment {
  [name: string]: string | undefined;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_SITE_NAME?: string;
  OPENROUTER_TIMEOUT_MS?: string;
}

const ALLOCATION_AGENT_INSTRUCTIONS = `You are Diversifi's allocation-proposal agent.
Return JSON only with shouldRebalance, targetAllocationBps, explanation, and optional confidence.
You may propose target allocation percentages only. Never return trades, token amounts, calldata, contract addresses, router choices, transaction data, approvals, signatures, withdrawals, or execution instructions.
If no change is appropriate, return shouldRebalance=false and an empty targetAllocationBps object.
If shouldRebalance=true, allocate only among the snapshot's allowed assets and make integer basis points sum to exactly 10000.`;

function jsonSafeSnapshot(snapshot: PortfolioSnapshot): unknown {
  return JSON.parse(JSON.stringify(snapshot, (_, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value
  ));
}

/**
 * Development-only hosted model adapter. It has no blockchain credentials and
 * returns only an allocation proposal after strict local validation.
 */
export function createOpenRouterAllocationAgent(options: OpenRouterAllocationAgentOptions): AllocationAgent {
  if (!options.apiKey) throw new AllocationAgentError("OPENROUTER_API_KEY is required");
  if (!options.model) throw new AllocationAgentError("OPENROUTER_MODEL is required");
  const timeoutMs = options.timeoutMs ?? 20_000;
  const client = options.client ?? new OpenRouter({
    apiKey: options.apiKey,
    httpReferer: options.siteUrl,
    xTitle: options.siteName,
    timeoutMs
  });

  return createAllocationAgent(async (snapshot) => {
    try {
      const response = await client.chat.send({
        model: options.model,
        temperature: 0,
        stream: false,
        responseFormat: { type: "json_object" },
        messages: [
          { role: "system", content: ALLOCATION_AGENT_INSTRUCTIONS },
          { role: "user", content: `Analyze this normalized vault snapshot:\n${JSON.stringify(jsonSafeSnapshot(snapshot))}` }
        ]
      });
      const choice = response.choices[0];
      if (choice?.message.refusal) throw new AllocationAgentError("Allocation model refused the request");
      if (choice?.finishReason !== "stop" || typeof choice.message.content !== "string" || !choice.message.content) {
        throw new AllocationAgentError("Allocation model returned no complete response");
      }
      try {
        return JSON.parse(choice.message.content);
      } catch (error) {
        throw new AllocationAgentError("Allocation model returned invalid JSON", error);
      }
    } catch (error) {
      if (error instanceof AllocationAgentError) throw error;
      throw new AllocationAgentError("OpenRouter allocation request failed", error);
    }
  });
}

/**
 * Runtime configuration entry point. Pass `process.env` from the worker; do
 * not load or expose provider credentials in browser code.
 */
export function createOpenRouterAllocationAgentFromEnv(environment: OpenRouterEnvironment): AllocationAgent {
  const timeout = environment.OPENROUTER_TIMEOUT_MS === undefined
    ? undefined
    : Number(environment.OPENROUTER_TIMEOUT_MS);
  if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout <= 0)) {
    throw new AllocationAgentError("OPENROUTER_TIMEOUT_MS must be a positive integer");
  }
  return createOpenRouterAllocationAgent({
    apiKey: environment.OPENROUTER_API_KEY ?? "",
    model: environment.OPENROUTER_MODEL ?? "",
    siteUrl: environment.OPENROUTER_SITE_URL,
    siteName: environment.OPENROUTER_SITE_NAME,
    timeoutMs: timeout
  });
}

/** A deterministic development/test double that still runs all response validation. */
export function createMockAllocationAgent(response: unknown): AllocationAgent {
  return createAllocationAgent(async () => response);
}

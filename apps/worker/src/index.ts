import { createOpenRouterAllocationAgentFromEnv, type OpenRouterEnvironment } from "@diversifi/ai";
import type { AllocationAgent, RebalanceJob } from "@diversifi/types";

/** A queue adapter will be selected once persistence and hosting are decided. */
export interface RebalanceJobProcessor {
  process(job: RebalanceJob): Promise<void>;
}

/** Server-only composition root for the development AI provider. */
export function createWorkerAllocationAgent(environment: OpenRouterEnvironment = process.env): AllocationAgent {
  return createOpenRouterAllocationAgentFromEnv(environment);
}

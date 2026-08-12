import { z } from "zod";
import type { Address, AllocationDecision, PortfolioSnapshot } from "@diversifi/types";

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");
export const basisPointsSchema = z.coerce.bigint().min(0n).max(10_000n);

/**
 * The provider response is deliberately strict: no unknown fields means an AI
 * cannot smuggle calldata, router addresses, or token amounts across this API.
 */
export const allocationDecisionSchema = z.object({
  shouldRebalance: z.boolean(),
  targetAllocationBps: z.record(addressSchema, basisPointsSchema),
  explanation: z.string().min(1).max(2_000),
  confidence: z.enum(["low", "medium", "high"]).optional()
}).strict().superRefine((decision, context) => {
  const total = Object.values(decision.targetAllocationBps).reduce((sum, allocation) => sum + allocation, 0n);
  if (decision.shouldRebalance && total !== 10_000n) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Target allocations must sum to 10,000 BPS" });
  }
  if (!decision.shouldRebalance && Object.keys(decision.targetAllocationBps).length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "No-action decisions cannot include target allocations" });
  }
});

/** Validates an untrusted provider response against this vault's allowed assets. */
export function parseAllocationDecision(
  snapshot: Pick<PortfolioSnapshot, "constraints">,
  response: unknown
): AllocationDecision {
  const decision = allocationDecisionSchema.parse(response);
  const allowedAssets = new Set(snapshot.constraints.allowedAssets.map((asset) => asset.toLowerCase()));
  for (const asset of Object.keys(decision.targetAllocationBps)) {
    if (!allowedAssets.has(asset.toLowerCase())) {
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ["targetAllocationBps", asset],
        message: "Target allocation contains an asset not allowed by this vault"
      }]);
    }
  }
  return decision as AllocationDecision;
}

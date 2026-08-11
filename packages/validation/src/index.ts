import { z } from "zod";

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");
export const basisPointsSchema = z.coerce.bigint().min(0n).max(10_000n);

export const allocationDecisionSchema = z.object({
  shouldRebalance: z.boolean(),
  targetAllocationBps: z.record(addressSchema, basisPointsSchema),
  reasoning: z.string().max(2_000),
  confidence: z.enum(["low", "medium", "high"])
}).superRefine((decision, context) => {
  const total = Object.values(decision.targetAllocationBps).reduce((sum, allocation) => sum + allocation, 0n);
  if (decision.shouldRebalance && total !== 10_000n) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Target allocations must sum to 10,000 BPS" });
  }
  if (!decision.shouldRebalance && Object.keys(decision.targetAllocationBps).length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "No-action decisions cannot include target allocations" });
  }
});


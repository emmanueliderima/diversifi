import type { RebalanceJob } from "@diversifi/types";

/** A queue adapter will be selected once persistence and hosting are decided. */
export interface RebalanceJobProcessor {
  process(job: RebalanceJob): Promise<void>;
}


/**
 * CRE owns scheduling and eligibility dispatch. Per-vault execution stays in
 * the worker; a real CRE workflow is added after its target runtime is chosen.
 */
export interface EligibleVaultScheduler {
  enqueueEligibleVaults(): Promise<void>;
}


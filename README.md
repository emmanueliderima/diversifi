# Diversifi

AI-proposed, deterministic, non-custodial investment vaults for OKX X Layer.

## Phase-one workspace

- `contracts`: vault security boundary and local mocks.
- `apps/web`: user-facing vault dashboard.
- `apps/api`: short-lived HTTP/application operations.
- `apps/worker`: independent rebalance-job processing.
- `apps/cre`: Chainlink CRE scheduling/orchestration boundary.
- `packages/types`, `validation`, `portfolio`, `blockchain`: shared domain and deterministic logic.

The initial flow is local-first. Chain-specific addresses, DEX routing, AI providers, persistence, and relaying remain configuration/adapters to be chosen before their implementation.

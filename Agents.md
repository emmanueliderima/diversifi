# PROJECT CONTEXT — AI-POWERED NON-CUSTODIAL INVESTMENT VAULTS ON X LAYER

You are joining an existing project as a senior full-stack/Web3 engineer and technical collaborator.

Before making architectural changes or writing substantial code, read this entire document carefully.

Your job is not merely to generate code. You should understand the system architecture, preserve its security assumptions, point out genuine architectural problems, and help us ship a functional hackathon MVP.

When something is unclear, do not silently invent a major architectural decision. Ask or explicitly state your assumption.

==================================================
1. PROJECT OVERVIEW
==================================================

We are building an AI-powered, on-chain portfolio management platform on OKX X Layer.

The project is being built for the BuildX AI Season Hackathon.

The fundamental product idea is:

Users create their own non-custodial smart-contract vaults.

Users deposit supported assets into their own vaults.

An AI agent analyzes each user's portfolio, market information, and user-defined risk constraints and proposes a target portfolio allocation.

Example:

Current:
USDC: 50%
BTC: 20%
ETH: 30%

AI target:
USDC: 20%
BTC: 40%
ETH: 30%
RWA: 10%

The AI DOES NOT directly control funds.

A deterministic rebalancing layer converts the target allocation into required trades.

The vault contract enforces the user's hard constraints on-chain.

Trades are executed using a DEX integration, with OKX DEX Aggregator currently intended as the primary execution venue.

Chainlink CRE is intended to provide automation/orchestration.

The core security principle is:

    AI proposes.
    Deterministic code calculates.
    Vault validates.
    DEX executes.

The AI must never be the final authority over user funds.


==================================================
2. NON-CUSTODIAL VAULT MODEL
==================================================

DO NOT implement a single pooled investment fund.

Each user must have their own isolated smart-contract vault.

Example:

User A
  -> Vault A
  -> $1,000 equivalent assets

User B
  -> Vault B
  -> $300 equivalent assets

User C
  -> Vault C
  -> $800 equivalent assets

Funds must NEVER be pooled between these users.

Vault A owns A's assets.
Vault B owns B's assets.
Vault C owns C's assets.

A failure affecting Vault A should not automatically affect B or C.

We intend to use a factory pattern:

VaultFactory
    |
    +-- Vault A
    +-- Vault B
    +-- Vault C
    +-- ...

A clone/minimal-proxy pattern such as OpenZeppelin Clones is a possible implementation to make per-user vault deployment inexpensive.

Do not assume this implementation is immutable if you identify a safer/better approach, but preserve the per-user vault isolation model.


==================================================
3. VAULT OWNERSHIP
==================================================

Each vault has one owner.

The owner should ultimately control:

- withdrawals
- vault risk configuration
- pausing/unpausing automated management
- allowed assets

Automation infrastructure and the AI must NOT be able to withdraw arbitrary funds.

The vault contract is the ultimate authority regarding whether a proposed rebalance is permitted.


==================================================
4. DEPOSIT MODEL
==================================================

The blockchain does not hold "$1,000".

Vaults hold actual blockchain tokens.

For the MVP, USDC is intended to be the primary/base deposit asset.

Example:

User deposits:

    1,000 USDC

not:

    "$1,000"

The UI may display:

    1,000 USDC
    ≈ $1,000

After rebalancing, the vault may hold multiple supported assets.

Example:

Vault A:

    400 USDC
    some WETH
    some WBTC
    some supported RWA asset

The exact initial supported asset universe has NOT yet been finalized.

Do NOT hardcode USDC/WETH/WBTC throughout the architecture.


==================================================
5. ERC-20 BALANCE MODEL
==================================================

Remember that ERC-20 balances are maintained by each ERC-20 contract.

The Vault should NOT maintain duplicate internal balance variables such as:

    usdcBalance
    wethBalance
    wbtcBalance

as the source of truth.

Instead:

    IERC20(token).balanceOf(vaultAddress)

is the source of truth for ERC-20 holdings.

For example:

USDC.balanceOf(VaultA)
WETH.balanceOf(VaultA)
WBTC.balanceOf(VaultA)

The vault stores configuration and authorization information.

Token contracts store actual ERC-20 balances.


==================================================
6. NATIVE TOKEN
==================================================

The project deploys on OKX X Layer.

The native gas token and gas-payment architecture must be treated separately from portfolio assets.

Do not assume the vault's investment portfolio must consist of the native token.

Users can deposit ERC-20 tokens such as USDC.

We still need to finalize exactly how gas for automated rebalance transactions will be funded/relayed.

Do not build a deeply coupled gas architecture without discussing it first.


==================================================
7. ASSET REGISTRY
==================================================

The system must be designed to support additional assets in the future.

DO NOT hardcode:

    USDC
    WETH
    WBTC

into the fundamental Vault architecture.

Introduce the concept of a platform-level Asset Registry.

There are TWO different concepts:

A. Platform Supported Assets

Assets that the platform has approved and knows how to:

- hold
- price
- buy
- sell
- route through a DEX
- safely expose to automated management

B. Vault Allowed Assets

A subset of platform-supported assets selected/approved by the individual user.

Example:

Platform supports:

USDC
WETH
WBTC
LINK
RWA1

User A allows:

USDC
WETH
WBTC

User B allows:

USDC
WETH
LINK

The AI may ONLY allocate to assets permitted by that vault.

The Vault must reject unsupported assets even if a user attempts to add them.


==================================================
8. ASSET REGISTRY CONTRACT
==================================================

We currently expect something conceptually similar to:

struct AssetConfig {
    bool supported;
    address token;
    address priceFeed;
    uint8 decimals;
}

This is NOT necessarily the final struct.

Potential future metadata includes:

- price feed
- decimals
- DEX availability
- risk classification
- buy enabled
- sell enabled

Do not overengineer the MVP.

The important architectural property is:

    Platform registry
        ->
    Approved assets
        ->
    User allowed-assets subset
        ->
    AI allocation universe


==================================================
9. USD VALUATION
==================================================

Vaults hold tokens, not dollar values.

USD values are derived.

For an asset:

    USD value = token balance × trusted token/USD price

Example:

0.25 WETH
× WETH/USD price
= USD value

Portfolio USD value is therefore derived from all supported token balances.

Chainlink price infrastructure should be used where appropriate and available.

Do not store a mutable "portfolioValueUSD" as the canonical source of truth.

It can be calculated/cached off-chain for application purposes.

The underlying token balances remain authoritative.


==================================================
10. VAULT STATE SNAPSHOT
==================================================

The AI needs a snapshot of a vault before making a decision.

A normal backend worker is capable of constructing this snapshot.

The worker can:

1. Read the vault configuration.
2. Determine the vault's allowed assets.
3. Query ERC-20 balances.
4. Retrieve relevant prices/market information.
5. Calculate USD valuations.
6. Calculate current portfolio percentages.
7. Build a normalized portfolio snapshot.
8. Send that snapshot to the AI service.

Example conceptual snapshot:

{
  "vaultAddress": "0x...",
  "portfolio": {
    "USDC": {
      "balance": "500",
      "usdValue": "500",
      "allocationBps": 5000
    },
    "WETH": {
      "balance": "0.1",
      "usdValue": "300",
      "allocationBps": 3000
    },
    "WBTC": {
      "balance": "...",
      "usdValue": "200",
      "allocationBps": 2000
    }
  },
  "totalValueUsd": "1000",
  "constraints": {
      ...
  }
}

Use integer/fixed-point representations for financial values where appropriate.

DO NOT use floating-point arithmetic for authoritative financial calculations.


==================================================
11. USER / VAULT CONFIGURATION
==================================================

Current configuration concepts:

1. allowedAssets
   Assets this particular vault permits the AI to allocate into.

2. maxAllocationPerAssetBps
   Example:
   6000 = maximum 60% of portfolio in one asset.

3. maxSlippageBps
   Example:
   100 = maximum 1% slippage.

4. maxTradeAmount
   Limits the maximum size of an individual rebalance trade.

   Exact denomination/enforcement strategy still needs to be finalized because USD limits require trusted pricing.

5. minTradeAmount
   Prevents tiny uneconomical trades.

6. minRebalanceInterval
   Minimum time between successful rebalances.

7. rebalanceThreshold / portfolio drift threshold
   Potentially prevents trades when current allocation is already sufficiently close to target.

8. paused
   Allows the owner to disable automated rebalancing.

Important:

Users should eventually be able to modify appropriate risk settings.

Do not assume all settings must remain immutable after vault creation.

Withdrawals should remain possible even when automated rebalancing is paused.


==================================================
12. REBALANCE INTERVAL
==================================================

minRebalanceInterval does NOT necessarily mean:

"Trade every 7 days."

It means:

"The vault cannot be rebalanced more frequently than this."

Example:

CRE evaluates vault daily.

Vault A:
last rebalance = 8 days ago
min interval = 7 days

Eligible for evaluation.

Vault B:
last rebalance = 2 days ago
min interval = 7 days

Not eligible.

Even when a vault is eligible, the AI may decide:

    shouldRebalance = false

No trade occurs.


==================================================
13. VAULT ELIGIBILITY
==================================================

Eligibility must be deterministic.

DO NOT ask the AI whether a vault is operationally eligible.

A vault is currently considered eligible for rebalance evaluation when:

- vault is active
- vault is not paused
- vault has sufficient funds
- portfolio value meets any configured platform minimum
- minRebalanceInterval has elapsed
- no rebalance job for that vault is already pending/processing

The exact minimum portfolio-value policy is still open.

Eligibility answers:

    "May we evaluate this vault?"

The AI answers:

    "Should this eligible portfolio be rebalanced, and what should the target allocation be?"

The Vault answers:

    "Is the proposed rebalance permitted?"


==================================================
14. AI AGENT RESPONSIBILITY
==================================================

The AI receives:

- current portfolio
- USD valuations
- current allocations
- user's allowed assets
- user risk parameters
- relevant market data

It should return structured output.

Conceptually:

{
  "shouldRebalance": true,
  "targetAllocation": {
    "USDC": 2000,
    "BTC": 4000,
    "ETH": 3000,
    "RWA": 1000
  },
  "reasoning": "...",
  "confidence": "..."
}

Allocation values above are basis points.

10000 = 100%.

The response MUST be schema validated.

The target allocation MUST sum to 10000 BPS when shouldRebalance=true.

The AI should NOT:

- construct transactions
- generate arbitrary calldata
- directly withdraw funds
- decide what contracts to call
- bypass user constraints
- perform authoritative financial arithmetic
- be trusted as the final validator

The AI proposes portfolio intent.


==================================================
15. REBALANCE CALCULATOR
==================================================

A deterministic Rebalance Calculator converts:

    Current portfolio
        +
    Target allocation
        +
    Prices
        +
    Thresholds
        ↓
    Trade plan

Example:

Portfolio value:

$1,000

Current:

BTC   $200 = 20%
ETH   $300 = 30%
USDC  $500 = 50%
RWA   $0   = 0%

AI target:

BTC   40%
ETH   30%
USDC  20%
RWA   10%

Target values:

BTC   $400
ETH   $300
USDC  $200
RWA   $100

Difference:

BTC   +$200 -> BUY
ETH   $0    -> NOTHING
USDC  -$300 -> SELL
RWA   +$100 -> BUY

Trade plan:

SELL:
    $300 equivalent USDC

BUY:
    $200 equivalent BTC
    $100 equivalent RWA

The AI DOES NOT calculate this trade plan.

Deterministic application logic does.


==================================================
16. DEX EXECUTION
==================================================

OKX DEX Aggregator is currently our preferred primary execution layer.

Reasons:

- aligned with the OKX/X Layer ecosystem
- allows routing across liquidity sources
- avoids tightly coupling the system to one AMM
- potentially allows adding assets without implementing a new DEX integration per asset

The expected conceptual flow is:

TradePlan
    ->
OKX quote/routing
    ->
validated swap information
    ->
Vault
    ->
DEX execution

Do not blindly trust calldata/router addresses returned by external APIs.

The final design needs appropriate contract-level restrictions and validation.

Security is more important than blindly making arbitrary external calls.


==================================================
17. VAULT SECURITY BOUNDARY
==================================================

The Vault contract is the final authority.

Even if:

- the AI is wrong
- our backend is compromised
- the worker has a bug
- CRE sends an invalid proposal

the vault should enforce user-defined hard limits.

Conceptually, rebalance execution should verify things such as:

- caller authorization
- vault isn't paused
- minimum interval
- asset is supported
- asset is allowed by user
- allocation limits
- trade limits
- slippage constraints
- other invariants

Example:

User maximum BTC allocation = 60%

AI proposes:

BTC = 75%

The vault MUST reject the rebalance.

Never rely exclusively on off-chain validation for safety-critical constraints.


==================================================
18. JOB-BASED PROCESSING
==================================================

The architecture should be capable of scaling to hundreds of vaults.

Do NOT design one enormous:

    rebalanceAllVaults()

transaction.

Each vault rebalance should be an independent unit of work.

Conceptually:

Vault A -> Job A
Vault B -> Job B
Vault C -> Job C

Each job can independently:

- succeed
- fail
- retry
- no-op

Failure for Vault C should not prevent Vault A from succeeding.

A conceptual job may contain:

{
  "id": "...",
  "type": "REBALANCE",
  "vaultAddress": "0x...",
  "status": "PENDING"
}

Possible statuses may include:

PENDING
PROCESSING
SUCCESS
FAILED
NO_ACTION

Avoid duplicate concurrent jobs for the same vault.


==================================================
19. WORKER
==================================================

We currently expect a normal backend worker application.

Its responsibilities may include:

- consuming rebalance jobs
- reading vault state
- reading token balances
- gathering market data
- calculating portfolio valuation
- building AI snapshots
- calling the AI agent
- validating AI responses
- running deterministic rebalance calculations
- obtaining DEX quotes
- coordinating execution
- recording job results

The worker is NOT inherently a Chainlink CRE workflow.

It is ordinary backend infrastructure.

The exact boundary between CRE and the worker is still being finalized.

Do not duplicate responsibilities unnecessarily.


==================================================
20. CHAINLINK CRE
==================================================

We intend to integrate Chainlink CRE (Chainlink Runtime Environment).

The project originally considered Chainlink Functions + Automation, but those were replaced in the architecture with CRE.

CRE is intended as the automation/orchestration layer.

Conceptually:

CRE cron
    ->
check/schedule eligible vaults
    ->
rebalance processing

However:

The exact production boundary between:

    CRE
    vs
    backend worker

has NOT been finalized.

Possible designs include:

A.
CRE performs most of the workflow itself.

B.
CRE handles scheduling/orchestration and backend workers perform per-vault jobs.

For the MVP, prefer the simplest architecture that demonstrates meaningful CRE integration without creating redundant infrastructure.

Do not remove CRE from the project without discussion because Chainlink integration is part of the project's hackathon story.


==================================================
21. SCALABILITY TARGET
==================================================

We want the architecture to comfortably support at least hundreds of users/vaults.

200 users means approximately:

200 independent vault contracts.

This itself is not considered a problem.

The bigger scalability concern is:

- AI request volume
- rebalance frequency
- blockchain transaction volume
- DEX execution
- scheduling
- retries

Per-vault processing should remain isolated.

Do not process every vault inside one blockchain transaction.


==================================================
22. THREE-USER EXAMPLE
==================================================

Use this mental model when reasoning about the architecture.

User A:
deposit = 1,000 USDC
Vault A

User B:
deposit = 300 USDC
Vault B

User C:
deposit = 800 USDC
Vault C

Suppose CRE runs daily.

A:
last rebalance = 8 days ago
interval = 7 days
=> eligible

B:
last rebalance = 2 days ago
interval = 7 days
=> not eligible

C:
last rebalance = 9 days ago
interval = 7 days
=> eligible

Jobs:

Job A -> Vault A
Job C -> Vault C

No job for B.

Worker processes A independently.

Worker:

1. Reads Vault A configuration.
2. Gets allowed assets.
3. Queries ERC-20 balances.
4. Gets price/market information.
5. Builds portfolio snapshot.
6. Sends snapshot to AI.
7. AI decides shouldRebalance.
8. If false -> NO_ACTION.
9. If true -> AI returns target allocation.
10. Validate AI output.
11. Deterministic calculator creates trade plan.
12. Obtain OKX DEX quote/routing.
13. Submit authorized rebalance.
14. Vault validates all hard constraints.
15. DEX executes swaps.
16. Assets remain in Vault A.
17. Record successful rebalance and update lastRebalance.

Vault C can be processed independently.

Vault A failure must not automatically affect Vault C.


==================================================
23. HIGH-LEVEL COMPONENT MODEL
==================================================

Conceptually:

                         USER
                           |
                     VaultFactory
                           |
               +-----------+-----------+
               |           |           |
             Vault A     Vault B     Vault C
               |           |           |
               +-----------+-----------+
                           |
                    Asset Registry


                   Chainlink CRE
                         |
                  Eligibility /
                   Scheduling
                         |
                     Job Queue
                         |
                    Worker(s)
                         |
              +----------+----------+
              |          |          |
          Blockchain   Market     Database
              |          Data
              |
              +----------+
                         |
                  Vault Snapshot
                         |
                         v
                     AI Agent
                         |
                  Target Allocation
                         |
                         v
                Rebalance Calculator
                         |
                     Trade Plan
                         |
                         v
                 OKX DEX Aggregator
                         |
                  quote / routing
                         |
                         v
                  Vault.rebalance()
                         |
                 On-chain validation
                         |
                         v
                    DEX execution


This diagram is conceptual.

Do not treat every arrow as already-finalized implementation detail.


==================================================
24. MONOREPO
==================================================

We want a monorepo.

Tooling preference:

- Bun
- Turborepo
- TypeScript
- Hardhat for Solidity development

Proposed structure:

/
├── apps/
│   ├── web/
│   ├── api/
│   ├── worker/
│   └── cre/
│
├── contracts/
│   ├── contracts/
│   │   ├── Vault.sol
│   │   ├── VaultFactory.sol
│   │   └── AssetRegistry.sol
│   ├── test/
│   ├── ignition/
│   │   └── modules/
│   ├── scripts/
│   ├── hardhat.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── packages/
│   ├── ai/
│   ├── assets/
│   ├── blockchain/
│   ├── config/
│   ├── db/
│   ├── okx/
│   ├── portfolio/
│   ├── types/
│   └── validation/
│
├── package.json
├── turbo.json
├── tsconfig.json
├── bun.lock
└── .env.example

Do not create unnecessary packages before they're needed.

Shared packages must not depend on applications.

Applications may depend on shared packages.


==================================================
25. FRONTEND
==================================================

Expected frontend:

Next.js
TypeScript

We want a modern, clean Web3 application.

Likely screens eventually include:

- landing/auth
- dashboard
- create vault
- vault detail
- deposit
- withdraw
- vault configuration
- portfolio allocation
- AI decision/explanation
- rebalance history
- transaction history

Do NOT prioritize building all UI immediately.

The critical MVP is a working end-to-end system.


==================================================
26. BACKEND
==================================================

apps/api is responsible for normal HTTP/application concerns.

Likely domains:

- users
- vaults
- assets
- portfolio
- jobs
- authentication

Do not put long-running rebalance execution directly inside request handlers.

Long-running work belongs in worker/job infrastructure.


==================================================
27. DATABASE
==================================================

A database will be used for off-chain application state.

Likely entities include:

User
Vault
RebalanceJob
RebalanceDecision
Transaction / RebalanceHistory
possibly Asset metadata/cache

The blockchain remains authoritative for:

- vault ownership
- actual token balances
- enforceable vault constraints
- on-chain transactions

The DB can index/cache this information for application convenience.

Do not create two competing sources of truth.


==================================================
28. BLOCKCHAIN PACKAGE
==================================================

packages/blockchain should centralize TypeScript blockchain interaction.

Likely responsibilities:

- X Layer chain configuration
- public clients
- wallet clients where appropriate
- contract ABIs
- deployed addresses
- Vault reads
- Factory reads/writes
- AssetRegistry reads
- ERC-20 balance queries

Use viem unless there is a strong reason otherwise.

Avoid scattering ABIs and contract addresses throughout applications.

Hardhat-generated artifacts/ABIs should feed into the TypeScript integration cleanly.


==================================================
29. PORTFOLIO PACKAGE
==================================================

packages/portfolio contains deterministic financial/domain calculations.

Examples:

calculatePortfolioValue()
calculateCurrentAllocation()
calculateTargetValues()
calculateRebalance()
buildTradePlan()

This package should have strong unit-test coverage.

It should not depend on:

- AI
- HTTP
- databases
- UI

It should ideally behave like pure deterministic business logic.


==================================================
30. AI PACKAGE
==================================================

packages/ai isolates AI-provider interaction.

Responsibilities:

- prompt construction
- AI calls
- response schema validation
- normalized agent interface

The rest of the application should not be tightly coupled to a specific model/provider.

Conceptually:

interface AllocationAgent {
    analyze(snapshot: PortfolioSnapshot): Promise<AllocationDecision>;
}

Use strict structured output.

Never trust arbitrary free-form model output for execution.


==================================================
31. OKX PACKAGE
==================================================

packages/okx isolates OKX DEX integration.

Likely responsibilities:

- API client
- quote retrieval
- swap route retrieval
- response validation
- normalization into internal types

Application/domain code should not be littered with raw OKX API response shapes.


==================================================
32. DATABASE PACKAGE
==================================================

packages/db centralizes:

- DB client
- schema
- migrations
- repository helpers where appropriate

Both:

apps/api
apps/worker

may use this package.

Drizzle ORM is a reasonable/default choice for the project.


==================================================
33. TYPES AND VALIDATION
==================================================

Shared domain types should exist for concepts such as:

Vault
VaultConfig
SupportedAsset
PortfolioSnapshot
AllocationDecision
TradePlan
RebalanceJob

Use runtime validation at external boundaries.

Zod is preferred for TypeScript validation.

Do not assume TypeScript types make external data safe.


==================================================
34. SMART CONTRACTS
==================================================

Initial expected contracts:

Vault.sol
VaultFactory.sol
AssetRegistry.sol

Potential conceptual Vault functionality:

initialize(...)
deposit(...)
withdraw(...)
setConfig(...)
pause()
unpause()
rebalance(...)

Potential Factory functionality:

createVault(...)
getVaults(...)
getVaultByOwner(...)

Potential AssetRegistry functionality:

addAsset(...)
updateAsset(...)
disableAsset(...)
getAsset(...)

These are conceptual APIs, NOT mandatory final signatures.

Design them carefully before implementation.


==================================================
35. SMART CONTRACT SECURITY
==================================================

Treat this as financial software.

At minimum consider:

- access control
- reentrancy
- arbitrary external calls
- malicious ERC-20 behavior
- SafeERC20
- checks-effects-interactions
- pause behavior
- upgradeability implications
- clone initialization attacks
- price-feed freshness
- oracle decimals
- slippage
- token decimals
- stale quotes
- replayed rebalance instructions
- duplicate jobs
- DEX/router allowlisting
- allowance management
- unauthorized automation callers
- withdrawal safety
- emergency recovery

Do not sacrifice obvious security invariants simply to make the demo work.


==================================================
36. BASIS POINTS
==================================================

Use basis points for percentage-based on-chain configuration where practical.

Example:

10000 = 100%
6000  = 60%
100   = 1%

Avoid Solidity floating-point assumptions.


==================================================
37. FINANCIAL MATH
==================================================

Be extremely careful with:

- decimals
- price-feed decimals
- token decimals
- rounding
- multiplication/division order
- overflow assumptions
- integer truncation

Avoid JavaScript Number for authoritative high-precision blockchain amounts.

Prefer bigint / appropriate fixed-point utilities.


==================================================
38. HARDHAT
==================================================

Use Hardhat rather than Foundry.

We prefer TypeScript-based tooling.

Expected:

contracts/
    contracts/
    test/
    ignition/modules/
    hardhat.config.ts

Use TypeScript for:

- tests
- deployment modules/scripts
- integration tooling

Solidity remains Solidity, obviously.


==================================================
39. X LAYER
==================================================

Contracts will be deployed to OKX X Layer.

We need:

- testnet configuration
- mainnet configuration eventually
- correct RPC/chain IDs
- deployment configuration
- explorer verification if supported

Do not guess addresses or chain configuration.

Use official/current documentation when integrating chain-specific infrastructure.


==================================================
40. HACKATHON CONSTRAINT
==================================================

This is a hackathon MVP.

We want good architecture, but SHIPPING matters.

Prefer:

working end-to-end flow

over:

20 half-finished abstractions.

MVP should demonstrate:

User
  ->
creates vault
  ->
deposits supported asset
  ->
vault becomes eligible
  ->
AI receives portfolio snapshot
  ->
AI returns allocation
  ->
deterministic trade plan generated
  ->
DEX integration executes/meaningfully demonstrates swap
  ->
vault receives resulting assets
  ->
UI shows updated portfolio + AI reasoning

Keep the architecture extensible without building every production feature now.


==================================================
41. KNOWN OPEN QUESTIONS
==================================================

The following are intentionally NOT finalized.

Do not silently make permanent decisions around them.

1. Exact initial supported asset list.

2. Exact RWA asset integration.

3. Exact CRE vs backend-worker responsibility boundary.

4. Exact job queue implementation.

5. Exact gas sponsorship/relayer strategy.

6. Exact OKX DEX execution contract/API architecture.

7. Exact AI provider/model.

8. Exact market-data sources beyond trusted on-chain pricing.

9. Exact database/provider.

10. Exact authentication/wallet stack.

11. Whether vault clones should be upgradeable and, if so, under what trust/security model.

12. Exact mechanism for enforcing USD-denominated max/min trade limits on-chain.

13. Exact rebalance drift/threshold policy.

Raise these questions when they become relevant rather than hiding assumptions.


==================================================
42. DEVELOPMENT PHILOSOPHY
==================================================

When implementing:

1. Understand the existing architecture first.

2. Keep components narrowly responsible.

3. Prefer deterministic logic over AI whenever deterministic logic can solve the problem.

4. Treat AI output as untrusted input.

5. Treat external API responses as untrusted input.

6. Keep the Vault contract as the final security boundary.

7. Avoid duplicated sources of truth.

8. Keep blockchain balances authoritative.

9. Make each vault independently processable.

10. Optimize for a working hackathon MVP without creating architectural dead ends.


==================================================
43. HOW YOU SHOULD WORK WITH US
==================================================

You are not expected to blindly obey implementation suggestions if they are technically flawed.

If you identify:

- a security issue
- incorrect Web3 assumptions
- unnecessary complexity
- a simpler architecture
- scalability concerns
- unsafe contract behavior

explain it before proceeding.

When proposing a meaningful architectural change, explain:

1. What's wrong with the existing approach.
2. What you recommend.
3. Why.
4. What tradeoffs it introduces.

For normal implementation details, proceed without excessive questioning.


==================================================
44. FIRST TASK
==================================================

Do NOT immediately implement the entire product.

First:

1. Inspect the existing repository if one exists.

2. Compare it against the architecture above.

3. Propose the minimum monorepo structure needed to begin development.

4. Identify any dependencies/packages that are actually needed initially.

5. Identify architectural decisions that block initial development versus those that can safely wait.

6. Propose an implementation order for the MVP.

7. Highlight any flaws, contradictions, or security concerns you see in this specification.

Then wait for approval before making large structural or architectural changes.

Once approved, begin by scaffolding the monorepo and establishing the contract/shared-package boundaries.

Do not generate placeholder complexity just to fill every directory listed above.


==================================================
45. DEVELOPMENT & DEPLOYMENT ENVIRONMENTS
==================================================

Development follows three stages:

    Local Hardhat Network
        ↓
    X Layer Testnet
        ↓
    X Layer Mainnet

Do not skip directly to mainnet.

------------------------------
LOCAL DEVELOPMENT
------------------------------

The primary development environment is a persistent local Hardhat blockchain.

During initial development, the complete core vault flow should be testable locally without depending on X Layer, live DEX liquidity, external faucets, or other production infrastructure.

Local contracts should include the real application contracts:

- Vault
- VaultFactory
- AssetRegistry

and mock external dependencies where necessary, potentially including:

- MockUSDC / mock ERC-20 assets
- Mock price feeds
- Mock DEX / swap router

The goal of the local environment is to validate:

- vault creation
- deposits
- withdrawals
- asset registration
- allowed-asset configuration
- ERC-20 balance tracking
- portfolio-state construction
- AI allocation handling
- deterministic rebalance calculations
- rebalance authorization
- vault constraint enforcement
- swap execution behavior
- pause/unpause behavior
- failure/revert scenarios

External services should be accessed through abstractions/adapters where practical so that local implementations can be replaced by real integrations without changing core domain logic.

For example:

    Rebalance Calculator
            |
        DEX Adapter
        /         \
    MockDEX       OKX DEX
    (local)       (testnet/mainnet)

Do not distort production contract architecture merely to make local mocks easier to use.

------------------------------
X LAYER TESTNET
------------------------------

Once the core end-to-end flow works locally, deploy to X Layer testnet.

At this stage, progressively replace mocks with real ecosystem integrations where available.

Testnet is intended to validate:

- X Layer RPC/network behavior
- real deployed contract interaction
- wallet transaction flows
- gas behavior
- real token contracts
- OKX DEX integration
- Chainlink/CRE integration
- available oracle/price infrastructure
- frontend → backend → blockchain integration
- worker execution against real network state

Do not assume a service available locally has an equivalent X Layer testnet deployment. Verify network-specific addresses and capabilities using current official documentation.

------------------------------
X LAYER MAINNET
------------------------------

Mainnet deployment occurs only after the relevant flows have been validated locally and on X Layer testnet.

Mainnet configuration must use explicit production addresses and configuration.

Never reuse mock/test addresses in production.

------------------------------
NETWORK CONFIGURATION
------------------------------

Network-specific values must be configuration-driven rather than hardcoded throughout the codebase.

This includes:

- chain IDs
- RPC URLs
- deployed contract addresses
- token addresses
- oracle addresses
- DEX/router addresses
- explorer URLs
- CRE configuration

The application should be able to select the appropriate environment without changing core business logic.

Never guess chain-specific addresses or configuration.

------------------------------
IMPORTANT DISTINCTION
------------------------------

Local Hardhat testing answers:

    "Does our system and contract logic work?"

X Layer testnet testing answers:

    "Does our system work with the real X Layer ecosystem and integrations?"

Mainnet deployment is:

    "Run the validated system with real economic value."

Mocks are acceptable and encouraged locally for external infrastructure, but production security assumptions must not depend on mock-specific behavior.
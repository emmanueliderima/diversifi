# Diversifi MVP Contract Design

## Decision summary

The MVP uses three application contracts—`AssetRegistry`, `VaultFactory`, and a non-upgradeable cloneable `Vault`—plus a necessary, separately reviewed `ISwapAdapter` boundary. The adapter is necessary because accepting arbitrary OKX aggregator calldata in a vault would make the vault's executor an effective custodian. The adapter is an allowlisted, immutable per-vault dependency that accepts explicit swaps only; its production implementation is deliberately out of scope for this design step.

The MVP accepts deposits only in a vault's configurable base asset. A vault may hold several user-allowed assets after rebalancing. The base asset is not hardcoded: it is selected at creation and must be active in the registry and in the vault's allowed asset set.

To make `maxSlippageBps` enforceable against a compromised executor, every asset tradable by the MVP must have a fresh trusted USD price feed. Accordingly, price-feed metadata and decimal normalizers are required in the registry. If a reliable price feed is unavailable on a deployment network, that asset cannot be rebalance-traded on that network. It can still be held and withdrawn if it was previously supported.

## Responsibility and trust map

| Component | Owns | Does | Explicitly does not do | Trusted by |
| --- | --- | --- | --- | --- |
| `AssetRegistry` | Platform asset metadata and active status | Defines assets safe to newly acquire/deposit and the oracle metadata used by vault checks | Custody, user policy, balances, execution, prices themselves | Factory and vaults |
| `VaultFactory` | Canonical vault implementation, registry, adapter, `owner => vault`, vault recognition | Atomically creates and initializes one isolated vault per wallet | Holds user funds, performs rebalances, enumerates all vaults | Frontend/indexer for canonical vault discovery |
| `Vault` | One owner's policy, allowed-asset set, base asset, executor, pause state, last qualifying rebalance | Custodies that vault's ERC-20s; enforces user limits; invokes only its immutable adapter | AI calls, jobs, route discovery, USD portfolio caching, general arbitrary calls | Owner for custody; executor only within stated limits |
| `ISwapAdapter` implementation | Router allowlist and protocol-specific routing validation | Executes one explicit swap and returns output to the caller vault | Decides portfolio intent, owns user policy, receives open-ended approval | Vault, only for the exact approved input amount |
| Worker / CRE / AI | Off-chain data, job lifecycle, decision, allocation calculation, quote/route data | Proposes and submits a bounded rebalance | Change policy, withdraw, bypass vault validation | **Not trusted** for fund safety |
| Price feed | Price answer and timestamp | Supports oracle floor checks and final concentration validation | Guarantees execution price or quote availability | Registry/vault only when configured and fresh |

The adapter and price feeds are deliberate trust dependencies. A vault never trusts an AI decision, a worker quote, or arbitrary calldata.

## Common values and data model

`BPS_DENOMINATOR` is `10_000`. All percentage values are `uint16` basis points. All token quantities are native ERC-20 units. No contract stores ERC-20 balances or mutable USD portfolio value.

```solidity
struct VaultConfig {
    uint16 maxAllocationPerAssetBps; // 1..10_000
    uint16 maxSlippageBps;           // 0..MAX_MVP_SLIPPAGE_BPS (recommended 1_000)
    uint64 minRebalanceInterval;     // seconds; 0 is allowed
}

struct Allocation {
    address asset;
    uint16 targetBps;
}

struct Trade {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minAmountOut;
    bytes routeData; // adapter-specific, never interpreted or forwarded by Vault
}

struct AssetConfig {
    bool exists;                  // registration is retained forever while referenced
    bool active;                  // permits new deposits and acquisitions
    address priceFeed;            // trusted token/USD feed; non-zero for tradable assets
    uint8 tokenDecimals;          // verified at registration against IERC20Metadata
    uint8 priceFeedDecimals;      // verified at registration against AggregatorV3Interface
    uint32 maxPriceAge;           // maximum accepted answer age in seconds
}
```

`exists` and `active` must be separate. Deleting registry metadata on disable would break valuation and exit paths for tokens already held by a vault.

The registry stores decimal normalizers rather than querying them during every rebalance. This avoids making every vault action depend on a token/feed metadata call that may revert or change behavior, and makes math inputs explicit and auditable. Registration verifies supplied decimals against both contracts once. The registry rejects decimals greater than a conservative implementation-defined bound (recommended `36`) and `maxPriceAge == 0`.

The MVP intentionally omits `minTradeAmount`, `maxTradeAmount`, and drift thresholds from `VaultConfig`. Token-native trade limits need per-token policy; USD limits need the same oracle machinery and introduce incomplete rounding/oracle policy. The worker can apply these economic filters deterministically, but they are not claimed as on-chain guarantees in this phase.

## AssetRegistry

### Owned state, responsibility, and limits

The registry owns `mapping(address => AssetConfig) assets`. It is the platform's source of truth for whether an asset is registered and whether it may be newly acquired. It neither enumerates assets nor stores balances. Applications should index registration events; on-chain enumeration is not needed for the MVP because vaults enumerate their own allowed sets.

The registry is administered with `Ownable2Step`. A single platform admin is sufficient because the model has only one administrative authority. `AccessControl` adds roles without a current second caller class. Admin ownership transfer must use two steps.

The registry trusts the configured ERC-20's `decimals()` and price feed's `decimals()` only at registration/update validation time, and later trusts `latestRoundData()` only when a vault validates a trade. It does not trust a feed answer with `answer <= 0`, `updatedAt == 0`, a future timestamp, or an answer older than `maxPriceAge`.

### Proposed external surface

```solidity
interface IAssetRegistry {
    function getAsset(address token) external view returns (AssetConfig memory);
    function isRegistered(address token) external view returns (bool);
    function isActive(address token) external view returns (bool);

    function registerAsset(
        address token,
        address priceFeed,
        uint32 maxPriceAge
    ) external;
    function updateAsset(
        address token,
        address priceFeed,
        uint32 maxPriceAge
    ) external;
    function disableAsset(address token) external;
    function enableAsset(address token) external;
}
```

The register/update functions read and validate decimals themselves; callers do not supply cached decimal values. `registerAsset` rejects an already registered token. `updateAsset` retains `exists` and updates verified metadata. `disableAsset` only sets `active = false`, never erases metadata. `enableAsset` is included because an erroneous operational disable should be recoverable without registry migration; it must revalidate the existing or new feed details.

### Disable semantics

For an inactive but registered asset:

| Action | Result |
| --- | --- |
| New base-asset deposit | Reverts if it is the base asset, because deposits require `active` |
| Add to a vault's allowed assets | Reverts |
| Include as `tokenOut` or allocation target | Reverts |
| Sell it as `tokenIn` | Allowed, provided it remains allowed by that vault, has a fresh usable price feed, and all normal checks pass |
| Owner withdrawal | Allowed; withdrawals do not require registry status |

This allows a platform to stop new exposure while preserving a safe exit. If the price feed is also unusable, trading may be unavailable, but the owner can always withdraw the token. This is an important limitation: the registry must not claim it can guarantee liquidation of a disabled asset.

### Events and errors

```solidity
event AssetRegistered(address indexed token, address indexed priceFeed, uint32 maxPriceAge);
event AssetUpdated(address indexed token, address indexed priceFeed, uint32 maxPriceAge);
event AssetStatusChanged(address indexed token, bool active);

error Unauthorized();
error ZeroAddress();
error AssetAlreadyRegistered(address token);
error AssetNotRegistered(address token);
error InvalidPriceFeed(address feed);
error InvalidDecimals(address subject, uint8 decimals);
error InvalidPriceAge(uint32 maxPriceAge);
```

Registry invariants: a registered asset has non-zero token/feed addresses, validated decimal bounds, and non-zero `maxPriceAge`; inactive assets retain their metadata; only the registry owner changes configuration.

## VaultFactory

### Owned state, responsibility, and limits

```solidity
address public immutable vaultImplementation;
IAssetRegistry public immutable assetRegistry;
ISwapAdapter public immutable swapAdapter;
mapping(address owner => address vault) public vaultOf;
mapping(address vault => bool) public isVault;
```

The factory creates a clone and initializes it in the same transaction. It enforces one canonical vault per owner for the MVP. This is a product simplification, not a fundamental protocol restriction: future multiple-vault support should deploy a new factory/version with `mapping(owner => address[])`, while preserving the original vaults and their ownership.

The factory should use OpenZeppelin `Clones` because per-user vaults are a central requirement and clones materially lower deployment cost without introducing upgrade authority. The implementation address, registry, and adapter are immutable in this factory. Creating a new factory version is the explicit migration path for future contract changes.

The factory uses `Ownable2Step` only for operational ownership transfer; its owner has no required routine power in the MVP. There is intentionally no function to replace the implementation, registry, or adapter. A new deployment/factory is safer than silently changing dependencies for existing users.

### Proposed external surface

```solidity
struct VaultInit {
    address baseAsset;
    address executor; // zero disables automated rebalances initially
    VaultConfig config;
    address[] allowedAssets;
}

interface IVaultFactory {
    function createVault(VaultInit calldata init) external returns (address vault);
    function vaultOf(address owner) external view returns (address);
    function isVault(address vault) external view returns (bool);
}
```

`createVault` validates that the base asset is active and appears exactly once in allowed assets. The clone's `initialize` is called by the factory in the same transaction with `msg.sender` as owner and the factory's immutable registry/adapter. Initial allowed assets must be unique, active, and bounded by `MAX_ALLOWED_ASSETS` (recommended 16 for MVP). A clone initialized by the factory cannot be hijacked because no externally observable gap exists between clone creation and initialization. `Vault.initialize` nevertheless has an initializer guard and accepts initialization only from the canonical factory supplied by the factory creation flow.

Factory events/errors:

```solidity
event VaultCreated(address indexed owner, address indexed vault, address indexed baseAsset);
error DuplicateVault(address owner);
error InvalidVaultImplementation();
error InvalidBaseAsset(address asset);
error InitializationFailed(address vault);
```

The factory must never receive deposits, forward funds, or provide a withdrawal method.

## Vault

### Owned state and responsibility

```solidity
address public owner;
IAssetRegistry public immutable assetRegistry; // clone-safe equivalent: initialized once
ISwapAdapter public immutable swapAdapter;     // clone-safe equivalent: initialized once
address public baseAsset;
address public executor;                        // zero disables automation
VaultConfig public config;
bool public automationPaused;
uint64 public lastRebalance;

mapping(address asset => bool) private _allowed;
address[] private _allowedAssets;
mapping(address asset => uint256 indexPlusOne) private _allowedAssetIndex;
```

The vault owns its ERC-20 balances and user policy. ERC-20 contracts remain the sole balance source of truth. The vault does not cache balances, portfolio values, AI outputs, price data, a job status, or a target allocation.

For access control, the vault uses simple ownership plus one configurable executor. This is less error-prone than a role system for exactly two authority classes. The owner may transfer ownership with a two-step process; the pending owner has no authority until acceptance. Only the owner can manage policy, allowed assets, executor, pause state, and withdrawals. Only `executor` can call `rebalance`.

### Deposits and withdrawals

**Recommendation: base-asset-only deposits.** A `deposit(uint256 amount)` operation transfers only `baseAsset` from owner to vault. This produces a single clear onboarding/UX path and avoids treating arbitrary deposits as portfolio allocation input. The base asset is configured at creation, is still registry-driven, and is not a USDC constant. The tradeoff is users who already hold another asset must swap it themselves before deposit; multi-asset deposits can be added later as an explicit policy decision.

Deposits are owner-only in the MVP. This prevents accidental gifts and avoids ambiguous accounting before shares/beneficiaries exist. The vault calls `safeTransferFrom(owner, address(this), amount)` using `SafeERC20`, rejects zero amounts, and requires `baseAsset` to be active. Deposits remain available while automation is paused; pause controls automation, not owner custody.

**Recommendation: `withdraw(address asset, uint256 amount)`.** Funds always go to `owner`. A recipient parameter is useful for future smart-wallet migrations, but it turns a compromised owner key into a direct arbitrary-recipient transfer mechanism and makes UI confirmation more error-prone. With a single owner and no shares, owner-only receipt is the safest, clearest MVP. `withdrawTo` can be introduced later, ideally with an owner-controlled allowlist or an explicit user-confirmed flow.

Withdrawal accepts any ERC-20 address and never checks `active`, `allowed`, or feed health. This avoids trapping an inactive/removed/accidentally transferred token. It uses `nonReentrant`, rejects zero amount, and transfers with `SafeERC20`; ordinary insufficient-balance behavior comes from the token. Withdrawals remain available while paused.

### Allowed assets

The vault uses `mapping(address => bool)` for O(1) checks plus an `address[]` and `indexPlusOne` mapping for O(1) swap-and-pop removal and enumeration. This is the smallest practical enumerable set. The array is capped at `MAX_ALLOWED_ASSETS`; unbounded owner-controlled loops would let an owner accidentally make their own rebalance unaffordable.

`addAllowedAsset(asset)` requires `assetRegistry.isActive(asset)`. `removeAllowedAsset(asset)` requires it is allowed, is not `baseAsset`, and has a zero ERC-20 balance in the vault. Prohibiting removal with a balance preserves the ability to sell a disabled asset through the orderly exit path. `allowedAssets()` returns the bounded array and `isAssetAllowed(asset)` supplies the cheap test.

### Configuration and pause

The MVP uses `updateConfig(VaultConfig calldata newConfig)`, rather than three individual setters. Configuration is a cohesive risk policy; one event and atomic validation prevent temporary inconsistent combinations. The UI can still present individual inputs. Individual setters would be justified only if configuration changes become frequent or require distinct permissions.

Validation:

- `maxAllocationPerAssetBps`: `1..10_000`; values below 10,000 make a one-asset portfolio impossible, which is allowed but must be an explicit owner choice.
- `maxSlippageBps`: `0..1_000` for MVP (0–10%). A protocol constant prevents accidentally accepting a near-total-loss setting. This is only meaningful for assets with fresh registry feeds.
- `minRebalanceInterval`: `0..MAX_REBALANCE_INTERVAL` (recommended 365 days) to prevent unrealistic values and simplify UI; zero permits manual consecutive rebalances.

`pauseAutomation()` and `unpauseAutomation()` change only `automationPaused`. While paused: deposits, withdrawals, executor changes, ownership/configuration, and allowed-asset updates remain possible; `rebalance` always reverts. This guarantees automation pause cannot strand owner funds.

### Proposed external surface

```solidity
interface IVault {
    function initialize(
        address initialOwner,
        IAssetRegistry registry,
        ISwapAdapter adapter,
        VaultInit calldata init
    ) external;

    function deposit(uint256 amount) external;
    function withdraw(address asset, uint256 amount) external;

    function addAllowedAsset(address asset) external;
    function removeAllowedAsset(address asset) external;
    function isAssetAllowed(address asset) external view returns (bool);
    function allowedAssets() external view returns (address[] memory);

    function updateConfig(VaultConfig calldata newConfig) external;
    function setExecutor(address newExecutor) external;
    function pauseAutomation() external;
    function unpauseAutomation() external;

    function rebalance(
        Allocation[] calldata targets,
        Trade[] calldata trades
    ) external;
}
```

The concrete Solidity implementation should combine this with `Ownable2Step`, `ReentrancyGuard`, `SafeERC20`, OpenZeppelin `Math.mulDiv`, and an initializer guard.

### Rebalance design

`rebalance` is atomic, executor-only, `nonReentrant`, and requires: nonzero executor; `automationPaused == false`; nonempty trades; and `block.timestamp >= lastRebalance + minRebalanceInterval` (with overflow-safe comparison).

It has three distinct validation layers:

1. **Proposal validation.** `targets` are nonempty, unique, every asset is active and allowed, each target is no more than `maxAllocationPerAssetBps`, and their sum is exactly 10,000 BPS. This validates AI/worker intent, not the resulting portfolio.
2. **Trade execution safety.** Every trade has distinct non-zero tokens, `amountIn > 0`, and `minAmountOut > 0`. `tokenIn` must be registered and allowed; it may be inactive so an existing disabled position can be exited. `tokenOut` must be active and allowed. The vault validates fresh price inputs and requires `minAmountOut` to meet an oracle-derived floor based on `maxSlippageBps`. It gives the adapter exactly `amountIn` allowance, calls the adapter, verifies the vault's `tokenOut` balance increased by at least `minAmountOut`, then resets allowance to zero.
3. **Actual post-trade policy validation.** The vault values each allowed asset's actual `balanceOf(vault)` using fresh feeds, computes the total and each allocation with integer `mulDiv`, and rejects if any non-zero asset exceeds `maxAllocationPerAssetBps`. This enforces the user’s concentration ceiling, but does **not** prove the final allocation equals the submitted target.

The vault processes all trades before the final allocation check. If any adapter call, quote-floor check, transfer-delta check, or final policy check fails, the entire transaction reverts and all previous swaps in that call revert. The worker must construct each rebalance as a bounded per-vault job and must not submit a zero-trade no-op.

### Oracle floor and slippage meaning

The worker obtains a quote and calculates `minAmountOut`; the adapter returns actual output. Neither number is trusted by itself. For each trade, the vault derives an oracle expected output using the fresh USD feeds and cached decimals:

```text
oracleExpectedOut = tokenIn amount × tokenIn USD price / tokenOut USD price
                    normalized for both token decimals and feed decimals
oracleFloor = floor(oracleExpectedOut × (10,000 - maxSlippageBps) / 10,000)
require(minAmountOut >= oracleFloor)
require(actualReceived >= minAmountOut)
```

Implementation must use overflow-safe `Math.mulDiv`, conservative rounding in favor of the vault, and unit tests around mixed token/feed decimals. This does not guarantee a market price, and it inherits feed freshness/manipulation risk; it does ensure a compromised executor cannot set an arbitrarily low `minAmountOut` while feeds are sound. A zero-slippage configuration will often make real swaps fail because of fees/rounding; that is valid owner policy.

The `target` data is emitted/audited and constrained, but it is not evidence that trade output reached the AI allocation. Exact target matching is intentionally not an MVP invariant: it requires a tolerance policy, robust pricing for every position, and a clear treatment of fee-on-transfer/rebasing tokens. The on-chain MVP enforces bounded losses per trade and the maximum concentration limit; the deterministic worker assesses target drift off-chain.

### `lastRebalance` semantics

`lastRebalance` is updated to `uint64(block.timestamp)` only after the complete atomic call has successfully executed at least one non-zero `Trade`, passed final concentration checks, and emitted `Rebalanced`. Empty trades arrays are rejected; a worker no-action never calls the vault. A revert changes nothing, including `lastRebalance`. A trade that swaps but later fails final validation also reverts entirely and does not count.

### Events and custom errors

```solidity
event Deposited(address indexed owner, address indexed asset, uint256 amount);
event Withdrawn(address indexed owner, address indexed asset, uint256 amount);
event AllowedAssetAdded(address indexed asset);
event AllowedAssetRemoved(address indexed asset);
event ConfigUpdated(uint16 maxAllocationPerAssetBps, uint16 maxSlippageBps, uint64 minRebalanceInterval);
event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);
event AutomationPaused(address indexed owner);
event AutomationUnpaused(address indexed owner);
event TradeExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
event Rebalanced(address indexed executor, bytes32 indexed targetHash, uint256 tradeCount, uint64 timestamp);

error Unauthorized();
error AlreadyInitialized();
error InvalidInitializationCaller();
error ZeroAddress();
error ZeroAmount();
error VaultAutomationPaused();
error InvalidExecutor();
error RebalanceTooSoon(uint64 nextEligibleAt);
error EmptyRebalance();
error UnsupportedAsset(address asset);
error InactiveAsset(address asset);
error AssetNotAllowed(address asset);
error AssetAlreadyAllowed(address asset);
error AssetNotAllowedForRemoval(address asset);
error BaseAssetRemovalForbidden(address asset);
error AssetBalanceNotZero(address asset, uint256 balance);
error TooManyAllowedAssets();
error InvalidConfig();
error InvalidAllocation(address asset, uint16 bps);
error DuplicateAllocation(address asset);
error AllocationSumInvalid(uint256 actual);
error AllocationTooHigh(address asset, uint256 actualBps, uint256 maximumBps);
error InvalidTrade(address tokenIn, address tokenOut);
error OraclePriceUnavailable(address asset);
error OraclePriceStale(address asset, uint256 updatedAt);
error OracleSlippageExceeded(uint256 minAmountOut, uint256 oracleFloor);
error InsufficientOutput(uint256 received, uint256 minimum);
```

## ISwapAdapter boundary

### Recommendation

Use one immutable, platform-reviewed adapter for a factory version. Do **not** let `Vault` make an arbitrary call to an OKX router or accept router/address/calldata fields supplied by an executor. A direct allowlisted-router approach is only safer if the router exposes a stable explicit typed swap API. An aggregator route normally requires dynamic route data; passing that directly to a router recreates arbitrary-call risk.

```solidity
interface ISwapAdapter {
    /// @dev Called only by a vault. Adapter must pull no more than amountIn and
    /// deliver tokenOut directly to msg.sender (the vault).
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata routeData
    ) external returns (uint256 amountOut);
}
```

The adapter is a high-risk component, not a harmless convenience. Its implementation must restrict callable router(s), validate that route token endpoints match `tokenIn/tokenOut`, prohibit route recipients other than the calling vault, avoid native-asset paths in this MVP, and avoid retaining token balances. The vault’s exact-amount approval plus reset-to-zero limits a malicious adapter’s potential pull to the current trade amount; it cannot use a standing approval to drain all holdings. The adapter return value is informational only—the vault checks its own balance delta.

The adapter is not mutable per existing vault. Replacing it would create a platform-controlled upgrade path over user assets. A new vetted adapter requires a new factory/vault version and explicit user migration. Local testing implements the same interface with `MockSwapAdapter`; X Layer production gets an OKX-compatible implementation only after route-format/security review.

## Access-control matrix

| Operation | Registry admin | Factory admin | Vault owner | Vault executor | Anyone |
| --- | --- | --- | --- | --- | --- |
| Register/update/enable/disable asset | Yes | No | No | No | No |
| Create own vault | No | No | Caller becomes owner | No | Yes, once per caller |
| Deposit base asset | No | No | Yes | No | No |
| Withdraw to owner | No | No | Yes | No | No |
| Manage allowed assets/config/executor/pause | No | No | Yes | No | No |
| Rebalance | No | No | No | Configured only | No |
| Read state / balances | N/A | N/A | N/A | N/A | Yes |

The executor is set or disabled by the vault owner only. This avoids hard-coding CRE, a worker wallet, or an executor registry into the vault. The owner may set it to zero to stop execution even when not paused. A compromised executor cannot withdraw, configure, add/remove assets, or choose an unbounded call target; it can only propose bounded typed swaps subject to all vault checks.

## Formal invariants

1. A vault is isolated; it can only transfer balances held by its own address.
2. Only the current owner can withdraw, and withdrawal always transfers to that owner.
3. Automation pause never prevents owner withdrawal.
4. Automation pause always prevents rebalancing.
5. Only the owner changes vault policy, allowed assets, executor, and pause state.
6. The executor has no general withdrawal or configuration authority.
7. A new allowed asset and base asset are active registry assets; base asset is always allowed.
8. An asset with a vault balance cannot be removed from that vault's allowed set.
9. A disabled registry asset cannot be newly deposited, added, bought, or targeted, but remains withdrawable and may be sold under normal protections.
10. A target set is unique, contains only active allowed assets, sums to exactly 10,000 BPS, and no entry exceeds the owner maximum.
11. A rebalance cannot run before its interval, while paused, or with an empty trade list.
12. Each rebalance trade has explicit input/output tokens and exact input bound; the vault never forwards arbitrary router calldata.
13. The adapter has no standing allowance after each trade.
14. Every successful trade delivers at least `minAmountOut` to the vault and satisfies the fresh-oracle slippage floor.
15. A successful rebalance leaves every valued allowed asset at or below the configured maximum allocation; a failed validation reverts atomically.
16. `lastRebalance` changes only after a successful qualifying rebalance; failed/reverted/no-action attempts do not advance it.
17. Initialization occurs once, atomically within canonical factory creation.

## Threat model and mitigation ownership

| Threat | Primary mitigation |
| --- | --- |
| Malicious AI response | Worker schema validation; vault target allowlist/sum/max validation; vault execution constraints |
| Compromised worker/executor | Owner-only policy/withdrawals; executor-only typed actions; immutable adapter; fresh-oracle floors; final max-allocation check |
| Malicious/incorrect DEX route | Adapter router/recipient/token validation; explicit Vault trade fields; balance-delta and min-output checks |
| Compromised adapter | Exact per-trade approval and reset; immutable adapter; audited adapter; no arbitrary vault call path. This remains a material platform trust risk. |
| Compromised registry admin | Two-step owner; no deletion; cannot directly withdraw. Admin can harm new trading policy/feed choice, so admin key governance is an operational risk. |
| Stale/manipulated price feed | `updatedAt`/positive-answer checks and per-asset max age; use vetted feeds. Feed manipulation remains an oracle risk, not solved by contracts. |
| Malicious/rebasing/fee token | `SafeERC20`, `nonReentrant`, output balance delta. MVP registry must exclude fee-on-transfer, rebasing, callback-heavy, and nonstandard tokens. |
| Reentrancy | `ReentrancyGuard`, checks-effects-interactions, no arbitrary vault calls |
| Approval abuse | Exact adapter approval per trade and zero reset; adapter never gets infinite approval |
| Initialization attack | Factory clone+initialize atomically; one-time initializer; canonical factory tracking |
| Replayed/duplicate job | Vault interval + atomic state update; worker database queue lock is responsible for operational duplicate avoidance |
| Owner misconfiguration | Config bounds, base asset cannot be removed, explicit events/UI warnings. Owner may still choose risky settings within cap. |
| Disabled asset traps | Metadata retained; owner withdrawals unconditional; disabled token may be sold but not acquired |

## Explicitly deferred

- Actual OKX adapter implementation and route-data schema.
- Live X Layer price-feed availability and asset list; no asset is deployable until these are verified.
- USD min/max trade limits, minimum trade size, drift thresholds, and post-trade target tolerance.
- Multi-asset/public deposits, shares, multiple owners, and recipient withdrawals.
- Multiple vaults per owner and migration tooling.
- Vault/factory/adapter upgradeability and any admin upgrade path.
- Executor registry, multisig executor authorization, permits, relaying, and gas sponsorship.
- Native-token portfolio support; phase one is ERC-20 only.
- On-chain vault enumeration; event indexing is sufficient.
- Emergency arbitrary token rescue to third parties; owner withdrawal already prevents token trapping.

## Approval questions before implementation

1. Approve base-asset-only, owner-only deposits and owner-only `withdraw(asset, amount)` for MVP?
2. Approve requiring fresh USD feeds for every rebalance-tradable asset, meaning assets without verified X Layer feeds cannot be traded in the live MVP?
3. Approve the immutable `ISwapAdapter` boundary and a new factory/version—not an admin adapter replacement—for future adapter changes?
4. Approve one canonical vault per wallet and immutable (non-upgradeable) clones for MVP?
5. Approve the stated asset-disable exit semantics and prohibition on removing a nonzero-balance allowed asset?
6. Approve executor-only rebalancing with executor chosen/changed solely by each vault owner, rather than hard-coding CRE or a platform wallet?
7. Confirm the acceptable protocol cap for `maxSlippageBps` (recommended 1,000 BPS) and maximum allowed assets (recommended 16).

No production Solidity, mocks, deployment scripts, or tests are added until these decisions are approved.

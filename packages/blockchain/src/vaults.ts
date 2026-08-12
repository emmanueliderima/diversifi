import type { Address, PublicClient, WalletClient } from "viem";
import { buildPortfolioSnapshot } from "@diversifi/portfolio";
import type { PortfolioSnapshot } from "@diversifi/types";
import { assetRegistryAbi, chainlinkAggregatorV3Abi, erc20Abi, vaultAbi, vaultFactoryAbi } from "./abis.js";
import type { ContractAddresses, CreateVaultParams, RegisteredAsset, VaultBalance, VaultConfig, VaultState } from "./types.js";

export async function getVaultConfig(client: PublicClient, vault: Address): Promise<VaultConfig & Pick<VaultState, "automationPaused" | "baseAsset" | "executor" | "owner" | "lastRebalance">> {
  const [config, automationPaused, baseAsset, executor, owner, lastRebalance] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "config" }), client.readContract({ address: vault, abi: vaultAbi, functionName: "automationPaused" }), client.readContract({ address: vault, abi: vaultAbi, functionName: "baseAsset" }), client.readContract({ address: vault, abi: vaultAbi, functionName: "executor" }), client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }), client.readContract({ address: vault, abi: vaultAbi, functionName: "lastRebalance" })
  ]);
  return { maxAllocationPerAssetBps: config[0], maxSlippageBps: config[1], minRebalanceInterval: config[2], automationPaused, baseAsset, executor, owner, lastRebalance };
}

export async function getAllowedAssets(client: PublicClient, vault: Address): Promise<Address[]> { return [...await client.readContract({ address: vault, abi: vaultAbi, functionName: "allowedAssets" })]; }
export async function getVaultBalances(client: PublicClient, vault: Address, assets?: Address[]): Promise<VaultBalance[]> { const tokens = assets ?? await getAllowedAssets(client, vault); const balances = await Promise.all(tokens.map((asset) => client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [vault] }))); return tokens.map((asset, index) => ({ asset, balance: balances[index] })); }
export async function getRegisteredAsset(client: PublicClient, registry: Address, asset: Address): Promise<RegisteredAsset> { const result = await client.readContract({ address: registry, abi: assetRegistryAbi, functionName: "getAsset", args: [asset] }); return result; }
export async function getVaultForOwner(client: PublicClient, factory: Address, owner: Address): Promise<Address> { return client.readContract({ address: factory, abi: vaultFactoryAbi, functionName: "vaultOf", args: [owner] }); }

export class PortfolioSnapshotError extends Error {
  constructor(message: string, readonly asset?: Address) {
    super(message);
    this.name = "PortfolioSnapshotError";
  }
}

export interface GetVaultPortfolioSnapshotParams {
  vaultAddress: Address;
  assetRegistry: Address;
  /** Injectable for deterministic tests; Unix seconds. Defaults to the local clock. */
  now?: bigint;
}

/**
 * Reads the vault's managed asset universe and produces a fully normalized
 * portfolio snapshot. Registry decimals are used because they are the
 * platform-approved metadata captured when the asset was registered.
 */
export async function getVaultPortfolioSnapshot(
  client: PublicClient,
  params: GetVaultPortfolioSnapshotParams
): Promise<PortfolioSnapshot> {
  const [state, allowedAssets] = await Promise.all([
    getVaultConfig(client, params.vaultAddress),
    getAllowedAssets(client, params.vaultAddress)
  ]);
  const now = params.now ?? BigInt(Math.floor(Date.now() / 1_000));
  const balances = await Promise.all(allowedAssets.map(async (asset) => {
    const registered = await getRegisteredAsset(client, params.assetRegistry, asset);
    if (!registered.exists || !registered.active || registered.priceFeed === "0x0000000000000000000000000000000000000000") {
      throw new PortfolioSnapshotError("Allowed asset is not an active registered asset", asset);
    }

    const [balance, symbol, round] = await Promise.all([
      client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [params.vaultAddress] }),
      client.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address: registered.priceFeed, abi: chainlinkAggregatorV3Abi, functionName: "latestRoundData" })
    ]);
    const [roundId, answer, , updatedAt, answeredInRound] = round;
    if (answer <= 0n || updatedAt === 0n || updatedAt > now || now - updatedAt > BigInt(registered.maxPriceAge) || answeredInRound < roundId) {
      throw new PortfolioSnapshotError("Asset price is invalid or stale", asset);
    }
    return {
      asset: { token: asset, symbol, decimals: registered.tokenDecimals },
      balance,
      priceUsd: answer,
      priceDecimals: registered.priceFeedDecimals
    };
  }));

  return buildPortfolioSnapshot({
    vaultAddress: params.vaultAddress,
    balances,
    constraints: {
      allowedAssets,
      maxAllocationPerAssetBps: BigInt(state.maxAllocationPerAssetBps),
      maxSlippageBps: BigInt(state.maxSlippageBps),
      minRebalanceInterval: state.minRebalanceInterval,
      paused: state.automationPaused
    }
  });
}

type Writer = WalletClient<any, any, any>;
export function createVault(client: Writer, account: Address, addresses: ContractAddresses, params: CreateVaultParams) { return client.writeContract({ chain: null, account, address: addresses.vaultFactory, abi: vaultFactoryAbi, functionName: "createVault", args: [{ baseAsset: params.baseAsset, executor: params.executor, config: { maxAllocationPerAssetBps: params.config.maxAllocationPerAssetBps, maxSlippageBps: params.config.maxSlippageBps, minRebalanceInterval: params.config.minRebalanceInterval }, allowedAssets: params.allowedAssets }] }); }
export async function deposit(publicClient: PublicClient, walletClient: Writer, account: Address, vault: Address, baseAsset: Address, amount: bigint) { const allowance = await publicClient.readContract({ address: baseAsset, abi: erc20Abi, functionName: "allowance", args: [account, vault] }); if (allowance < amount) { const approval = await walletClient.writeContract({ chain: null, account, address: baseAsset, abi: erc20Abi, functionName: "approve", args: [vault, amount] }); await publicClient.waitForTransactionReceipt({ hash: approval }); } return walletClient.writeContract({ chain: null, account, address: vault, abi: vaultAbi, functionName: "deposit", args: [amount] }); }
export function withdraw(client: Writer, account: Address, vault: Address, asset: Address, amount: bigint) { return client.writeContract({ chain: null, account, address: vault, abi: vaultAbi, functionName: "withdraw", args: [asset, amount] }); }

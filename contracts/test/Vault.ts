import { expect } from "chai";
import hre from "hardhat";
import { calculateAllocationDifferences, createTradePlan } from "@diversifi/portfolio";
import type { Address, PortfolioPosition } from "@diversifi/types";

const { ethers } = hre;

const units = (value: string) => ethers.parseUnits(value, 6);
const weth = (value: string) => ethers.parseUnits(value, 18);
const usd = (value: string) => ethers.parseUnits(value, 18);
const USDC_USD_SCALE = 10n ** 12n;

function portfolioPosition(token: string, symbol: string, usdValue: bigint): PortfolioPosition {
  return {
    asset: { token: token as Address, symbol, decimals: 18 },
    balance: 0n,
    priceUsd: 0n,
    priceDecimals: 0,
    usdValue,
    allocationBps: 0n
  };
}

async function fixture() {
  const [admin, owner, executor, other] = await ethers.getSigners();
  const base = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const asset = await (await ethers.getContractFactory("MockWETH")).deploy();
  const rwa = await (await ethers.getContractFactory("MockRWA")).deploy();
  const Feed = await ethers.getContractFactory("MockPriceOracle");
  const baseFeed = await Feed.deploy(8, 100_000_000);
  const assetFeed = await Feed.deploy(8, 100_000_000);
  const rwaFeed = await Feed.deploy(8, 100_000_000);
  const Registry = await ethers.getContractFactory("AssetRegistry");
  const registry = await Registry.deploy(admin.address);
  await registry.registerAsset(await base.getAddress(), await baseFeed.getAddress(), 3600);
  await registry.registerAsset(await asset.getAddress(), await assetFeed.getAddress(), 3600);
  await registry.registerAsset(await rwa.getAddress(), await rwaFeed.getAddress(), 3600);
  const Router = await ethers.getContractFactory("MockSwapRouter");
  const router = await Router.deploy();
  await router.setRate(await base.getAddress(), await asset.getAddress(), 1_000_000_000_000_000_000_000_000_000_000n);
  await router.setRate(await asset.getAddress(), await base.getAddress(), 1_000_000n);
  await router.setRate(await base.getAddress(), await rwa.getAddress(), 1_000_000_000_000_000_000_000_000_000_000n);
  await router.setRate(await rwa.getAddress(), await base.getAddress(), 1_000_000n);
  await asset.mint(await router.getAddress(), ethers.parseUnits("10000", 18));
  await rwa.mint(await router.getAddress(), ethers.parseUnits("10000", 18));
  await base.mint(await router.getAddress(), units("10000"));
  const Adapter = await ethers.getContractFactory("MockSwapAdapter");
  const adapter = await Adapter.deploy(await router.getAddress());
  const Vault = await ethers.getContractFactory("Vault");
  const implementation = await Vault.deploy();
  const Factory = await ethers.getContractFactory("VaultFactory");
  const factory = await Factory.deploy(await implementation.getAddress(), await registry.getAddress(), await adapter.getAddress());
  const init = { baseAsset: await base.getAddress(), executor: executor.address, config: { maxAllocationPerAssetBps: 6000, maxSlippageBps: 100, minRebalanceInterval: 0 }, allowedAssets: [await base.getAddress(), await asset.getAddress()] };
  await factory.connect(owner).createVault(init);
  const vault = Vault.attach(await factory.vaultOf(owner.address));
  return { admin, owner, executor, other, base, asset, rwa, registry, adapter, router, factory, vault };
}

describe("Vault MVP", function () {
  it("creates an isolated canonical vault and deposits only for its owner", async function () {
    const { owner, other, base, factory, vault } = await fixture();
    await base.mint(owner.address, units("1000"));
    await base.connect(owner).approve(await vault.getAddress(), units("1000"));
    await vault.connect(owner).deposit(units("1000"));
    expect(await base.balanceOf(await vault.getAddress())).to.equal(units("1000"));
    expect(await factory.vaultOf(owner.address)).to.equal(await vault.getAddress());
    await expect(vault.connect(other).deposit(1)).to.be.revertedWithCustomError(vault, "Unauthorized");
  });

  it("keeps owner withdrawals available while automation is paused", async function () {
    const { owner, base, vault } = await fixture();
    await base.mint(owner.address, units("10")); await base.connect(owner).approve(await vault.getAddress(), units("10")); await vault.connect(owner).deposit(units("10"));
    await vault.connect(owner).pauseAutomation();
    await vault.connect(owner).withdraw(await base.getAddress(), units("4"));
    expect(await base.balanceOf(owner.address)).to.equal(units("4"));
  });

  it("prevents a disabled asset from being bought but permits owner withdrawal", async function () {
    const { owner, executor, base, asset, registry, vault } = await fixture();
    await base.mint(owner.address, units("1000")); await base.connect(owner).approve(await vault.getAddress(), units("1000")); await vault.connect(owner).deposit(units("1000"));
    await registry.disableAsset(await asset.getAddress());
    const targets = [{ asset: await base.getAddress(), targetBps: 4000 }, { asset: await asset.getAddress(), targetBps: 6000 }];
    const trades = [{ tokenIn: await base.getAddress(), tokenOut: await asset.getAddress(), amountIn: units("600"), minAmountOut: weth("600"), routeData: "0x" }];
    await expect(vault.connect(executor).rebalance(targets, trades)).to.be.revertedWithCustomError(vault, "InactiveAsset");
    await asset.mint(await vault.getAddress(), weth("1"));
    await vault.connect(owner).withdraw(await asset.getAddress(), weth("1"));
    expect(await asset.balanceOf(owner.address)).to.equal(weth("1"));
  });

  it("executes only a bounded typed trade and clears the adapter allowance", async function () {
    const { owner, executor, base, asset, vault, adapter } = await fixture();
    await base.mint(owner.address, units("1000")); await base.connect(owner).approve(await vault.getAddress(), units("1000")); await vault.connect(owner).deposit(units("1000"));
    const targets = [{ asset: await base.getAddress(), targetBps: 4000 }, { asset: await asset.getAddress(), targetBps: 6000 }];
    const trades = [{ tokenIn: await base.getAddress(), tokenOut: await asset.getAddress(), amountIn: units("600"), minAmountOut: weth("600"), routeData: "0x" }];
    await vault.connect(executor).rebalance(targets, trades);
    expect(await asset.balanceOf(await vault.getAddress())).to.equal(weth("600"));
    expect(await base.allowance(await vault.getAddress(), await adapter.getAddress())).to.equal(0);
    expect(await vault.lastRebalance()).to.be.greaterThan(0);
  });

  it("executes deposit -> calculate -> MockSwapRouter quote -> rebalance with real vault balance changes", async function () {
    const { owner, executor, base, asset, router, vault } = await fixture();
    const vaultAddress = await vault.getAddress();
    const baseAddress = await base.getAddress();
    const assetAddress = await asset.getAddress();
    await base.mint(owner.address, units("1000"));
    await base.connect(owner).approve(vaultAddress, units("1000"));
    await vault.connect(owner).deposit(units("1000"));

    // The calculator receives only the current USD state and hard-coded target intent.
    const target = { [baseAddress as Address]: 4000n, [assetAddress as Address]: 6000n };
    const differences = calculateAllocationDifferences([
      portfolioPosition(baseAddress, "USDC", usd("1000")),
      portfolioPosition(assetAddress, "WETH", 0n)
    ], target);
    const plan = createTradePlan(vaultAddress as Address, differences);
    expect(plan.trades).to.deep.equal([{ sellAsset: baseAddress, buyAsset: assetAddress, sellUsdValue: usd("600") }]);

    // The local execution adapter obtains its instruction from the router quote.
    const instruction = plan.trades[0]!;
    const amountIn = instruction.sellUsdValue / USDC_USD_SCALE;
    const quotedAmountOut = await router.quote(instruction.sellAsset, instruction.buyAsset, amountIn);
    const targets = [{ asset: baseAddress, targetBps: 4000 }, { asset: assetAddress, targetBps: 6000 }];
    const trades = [{ tokenIn: instruction.sellAsset, tokenOut: instruction.buyAsset, amountIn, minAmountOut: quotedAmountOut, routeData: "0x" }];

    await vault.connect(executor).rebalance(targets, trades);

    expect(await base.balanceOf(vaultAddress)).to.equal(units("400"));
    expect(await asset.balanceOf(vaultAddress)).to.equal(weth("600"));
    expect(await base.balanceOf(await router.getAddress())).to.equal(units("10600"));
    expect(await asset.balanceOf(await router.getAddress())).to.equal(weth("9400"));
  });

  it("rejects a rebalance from an unauthorized executor", async function () {
    const { owner, other, base, asset, vault } = await fixture();
    await base.mint(owner.address, units("1000")); await base.connect(owner).approve(await vault.getAddress(), units("1000")); await vault.connect(owner).deposit(units("1000"));
    const targets = [{ asset: await base.getAddress(), targetBps: 4000 }, { asset: await asset.getAddress(), targetBps: 6000 }];
    const trades = [{ tokenIn: await base.getAddress(), tokenOut: await asset.getAddress(), amountIn: units("600"), minAmountOut: weth("600"), routeData: "0x" }];
    await expect(vault.connect(other).rebalance(targets, trades)).to.be.revertedWithCustomError(vault, "Unauthorized");
  });

  it("rejects rebalances while automation is paused", async function () {
    const { owner, executor, base, asset, vault } = await fixture();
    await base.mint(owner.address, units("1000")); await base.connect(owner).approve(await vault.getAddress(), units("1000")); await vault.connect(owner).deposit(units("1000"));
    await vault.connect(owner).pauseAutomation();
    const targets = [{ asset: await base.getAddress(), targetBps: 4000 }, { asset: await asset.getAddress(), targetBps: 6000 }];
    const trades = [{ tokenIn: await base.getAddress(), tokenOut: await asset.getAddress(), amountIn: units("600"), minAmountOut: weth("600"), routeData: "0x" }];
    await expect(vault.connect(executor).rebalance(targets, trades)).to.be.revertedWithCustomError(vault, "VaultPaused");
  });

  it("rejects targets above the owner-configured allocation ceiling", async function () {
    const { owner, executor, base, asset, vault } = await fixture();
    await base.mint(owner.address, units("1000")); await base.connect(owner).approve(await vault.getAddress(), units("1000")); await vault.connect(owner).deposit(units("1000"));
    const targets = [{ asset: await base.getAddress(), targetBps: 3000 }, { asset: await asset.getAddress(), targetBps: 7000 }];
    const trades = [{ tokenIn: await base.getAddress(), tokenOut: await asset.getAddress(), amountIn: units("600"), minAmountOut: weth("600"), routeData: "0x" }];
    await expect(vault.connect(executor).rebalance(targets, trades)).to.be.revertedWithCustomError(vault, "AllocationTooHigh");
  });

  it("rejects swaps to a registered but vault-disallowed asset", async function () {
    const { owner, executor, base, rwa, vault } = await fixture();
    await base.mint(owner.address, units("1000")); await base.connect(owner).approve(await vault.getAddress(), units("1000")); await vault.connect(owner).deposit(units("1000"));
    const targets = [{ asset: await base.getAddress(), targetBps: 4000 }, { asset: await rwa.getAddress(), targetBps: 6000 }];
    const trades = [{ tokenIn: await base.getAddress(), tokenOut: await rwa.getAddress(), amountIn: units("600"), minAmountOut: weth("600"), routeData: "0x" }];
    await expect(vault.connect(executor).rebalance(targets, trades)).to.be.revertedWithCustomError(vault, "InactiveAsset");
  });

  it("rejects quotes whose minimum output violates the on-chain oracle slippage floor", async function () {
    const { owner, executor, base, asset, vault } = await fixture();
    await base.mint(owner.address, units("1000")); await base.connect(owner).approve(await vault.getAddress(), units("1000")); await vault.connect(owner).deposit(units("1000"));
    const targets = [{ asset: await base.getAddress(), targetBps: 4000 }, { asset: await asset.getAddress(), targetBps: 6000 }];
    const trades = [{ tokenIn: await base.getAddress(), tokenOut: await asset.getAddress(), amountIn: units("600"), minAmountOut: weth("593"), routeData: "0x" }];
    await expect(vault.connect(executor).rebalance(targets, trades)).to.be.revertedWithCustomError(vault, "OracleSlippageExceeded");
  });

  it("enforces the minimum rebalance interval after a successful rebalance", async function () {
    const { owner, executor, base, asset, vault } = await fixture();
    await vault.connect(owner).updateConfig({ maxAllocationPerAssetBps: 6000, maxSlippageBps: 100, minRebalanceInterval: 3600 });
    await base.mint(owner.address, units("1000")); await base.connect(owner).approve(await vault.getAddress(), units("1000")); await vault.connect(owner).deposit(units("1000"));
    const targets = [{ asset: await base.getAddress(), targetBps: 4000 }, { asset: await asset.getAddress(), targetBps: 6000 }];
    const trades = [{ tokenIn: await base.getAddress(), tokenOut: await asset.getAddress(), amountIn: units("600"), minAmountOut: weth("600"), routeData: "0x" }];
    await vault.connect(executor).rebalance(targets, trades);
    await expect(vault.connect(executor).rebalance(targets, trades)).to.be.revertedWithCustomError(vault, "RebalanceTooSoon");
  });

  it("enforces actual post-trade concentration instead of trusting targets", async function () {
    const { owner, executor, base, asset, vault } = await fixture();
    await base.mint(owner.address, units("1000")); await base.connect(owner).approve(await vault.getAddress(), units("1000")); await vault.connect(owner).deposit(units("1000"));
    const targets = [{ asset: await base.getAddress(), targetBps: 4000 }, { asset: await asset.getAddress(), targetBps: 6000 }];
    const trades = [{ tokenIn: await base.getAddress(), tokenOut: await asset.getAddress(), amountIn: units("700"), minAmountOut: weth("700"), routeData: "0x" }];
    await expect(vault.connect(executor).rebalance(targets, trades)).to.be.revertedWithCustomError(vault, "AllocationTooHigh");
    expect(await base.balanceOf(await vault.getAddress())).to.equal(units("1000"));
    expect(await asset.balanceOf(await vault.getAddress())).to.equal(0);
  });
});

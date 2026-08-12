import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
const USDC = 1_000_000n, UNIT = 10n ** 18n, PRICE = 100_000_000n;
export default buildModule("LocalMvp", (m) => {
  const usdc=m.contract("MockUSDC"), weth=m.contract("MockWETH"), rwa=m.contract("MockRWA");
  const usdcOracle=m.contract("MockPriceOracle",[8,PRICE],{id:"UsdcOracle"}), wethOracle=m.contract("MockPriceOracle",[8,PRICE],{id:"WethOracle"}), rwaOracle=m.contract("MockPriceOracle",[8,PRICE],{id:"RwaOracle"});
  const registry=m.contract("AssetRegistry",[m.getAccount(0)]), router=m.contract("MockSwapRouter"), adapter=m.contract("MockSwapAdapter",[router]), implementation=m.contract("Vault"), factory=m.contract("VaultFactory",[implementation,registry,adapter]);
  m.call(registry,"registerAsset",[usdc,usdcOracle,3600],{id:"RegisterUsdc"}); m.call(registry,"registerAsset",[weth,wethOracle,3600],{id:"RegisterWeth"}); m.call(registry,"registerAsset",[rwa,rwaOracle,3600],{id:"RegisterRwa"});
  m.call(router,"setRate",[usdc,weth,10n**30n],{id:"UsdcToWethRate"}); m.call(router,"setRate",[weth,usdc,USDC],{id:"WethToUsdcRate"}); m.call(router,"setRate",[usdc,rwa,10n**30n],{id:"UsdcToRwaRate"}); m.call(router,"setRate",[rwa,usdc,USDC],{id:"RwaToUsdcRate"});
  m.call(usdc,"mint",[router,1_000_000n*USDC],{id:"SeedRouterUsdc"}); m.call(weth,"mint",[router,1_000_000n*UNIT],{id:"SeedRouterWeth"}); m.call(rwa,"mint",[router,1_000_000n*UNIT],{id:"SeedRouterRwa"});
  m.call(usdc,"mint",["0x70997970C51812dc3A010C7d01b50e0d17dc79C8",10_000n*USDC],{id:"MintSampleUserA"}); m.call(usdc,"mint",["0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",5_000n*USDC],{id:"MintSampleUserB"});
  return {usdc,weth,rwa,usdcOracle,wethOracle,rwaOracle,registry,router,adapter,implementation,factory};
});

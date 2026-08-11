import { defineChain, http, createPublicClient } from "viem";

export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://testrpc.xlayer.tech/terigon"] } },
  blockExplorers: { default: { name: "OKX Explorer", url: "https://www.okx.com/web3/explorer/xlayer-test" } }
});

/** Network endpoints are supplied by configuration; no production endpoints or addresses live here. */
export function createXLayerPublicClient(rpcUrl: string) {
  return createPublicClient({ chain: xLayerTestnet, transport: http(rpcUrl) });
}

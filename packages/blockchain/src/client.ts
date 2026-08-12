import { createPublicClient, createWalletClient, custom, http, type EIP1193Provider, type PublicClient, type WalletClient } from "viem";
import { chainFor, type NetworkName } from "./chains.js";

export function createDiversifiPublicClient(network: NetworkName, rpcUrl?: string): PublicClient {
  const chain = chainFor(network);
  return createPublicClient({ chain, transport: http(rpcUrl ?? chain.rpcUrls.default.http[0]) });
}

/** Browser-only wallet client. Server code should construct its wallet client from an account separately. */
export function createDiversifiBrowserWalletClient(network: NetworkName, provider: EIP1193Provider): WalletClient {
  return createWalletClient({ chain: chainFor(network), transport: custom(provider) });
}

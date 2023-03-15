import type { BytesLike, BigNumber, providers } from "ethers";

export type BlockHash = string;

export type ContractAddress = string;

export type ReturnData = BytesLike;

export type Success = boolean;

export type CallResult = [Success, ReturnData];

export type CallResultWithAddress = [ContractAddress, Success, ReturnData];

export type AggregateResponse = [BigNumber, BlockHash, CallResult[]];

export type Balances = string[];

export type BalancesByContract = Record<string, TokenInfo>;

export interface Call {
  target: string;
  callData: string;
}

export interface CallContext {
  contractAddress: string;
  methodName: string;
}

export interface SingleTokenRequest {
  userAddresses: string[];
  contractToken: string;
  rpcUrl: string;
}

export interface RawSingleTokenRequest {
  userAddresses: string[];
  contractToken: string;
  functionName: string,
  provider: providers.Provider;
  chunkSize?: number
}

export interface RawMultipleTokensRequest {
  contractTokens: string[];
  functionName: string;
  callData: string[];
  provider: providers.Provider;
  chunkSize?: number;
}

export interface MultipleTokensRequest {
  userAddress: string;
  contractTokens: string[];
  rpcUrl: string;
}

export type TokenInfo = Record<
  "symbol" | "decimals" | "name" | "balance" | "weiBalance",
  string | number
>;

export type TokenInfoWithoutBalance = Record<
  "symbol" | "decimals" | "name",
  string | number
>;

export type MetaByContract = Record<string, TokenInfoWithoutBalance>;

export type Network = {
  name: string,
  chainId: number,
  ensAddress?: string,
  _defaultProvider?: (providers: any, options?: any) => any
}
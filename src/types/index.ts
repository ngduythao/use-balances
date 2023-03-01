import type { BytesLike, Provider } from "ethers";

export type BlockHash = string;

export type ContractAddress = string;

export type ReturnData = BytesLike;

export type Success = boolean;

export type CallResult = [Success, ReturnData];

export type CallResultWithAddress = [ContractAddress, Success, ReturnData];

export type AggregateResponse = [bigint, BlockHash, CallResult[]];

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

export interface MultipleAccountsSingleTokenRequest {
  userAddresses: string[];
  contractToken: string;
  rpcUrl: string;
}

export interface RawMultipleAccountsSingleTokenRequest {
  userAddresses: string[];
  contractToken: string;
  provider: Provider;
}

export interface RawSingleAccountsMultipleTokensRequest {
  userAddress: string;
  contractTokens: string[];
  provider: Provider;
}

export interface SingleAccountMultipleTokensRequest {
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
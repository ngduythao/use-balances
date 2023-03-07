import {
  AbiCoder,
  Contract,
  decodeBytes32String,
  getAddress,
  formatUnits,
  parseUnits,
  Interface,
  JsonRpcProvider,
} from "ethers";

import { Network, Provider } from "ethers";

import {
  AggregateResponse,
  CallResultWithAddress,
  Balances,
  BalancesByContract,
  Call,
  CallContext,
  CallResult,
  MetaByContract,
  SingleTokenRequest,
  RawSingleTokenRequest,
  RawMultipleTokensRequest,
  ReturnData,
  MultipleTokensRequest,
  TokenInfo,
} from "./types";

import { WNATIVE_ADDRESS, WNATIVE_PRCE_FEEDS_ADDRESS, V2_ROUTER_ADDRESS, MULTICALL, AddressMap } from './constants'

import erc20Abi from "./abi/erc20.json";
import v2RouterAbi from './abi/v2Router.json'
import multicallAbi from "./abi/multicall.json";
import aggregatorV3Abi from "./abi/aggregatorV3.json";

const ONE_ETHER = parseUnits('1', 'ether');

const abiCoder = AbiCoder.defaultAbiCoder();

export async function getNativePrice(rpcUrl: string) : Promise<bigint> {
  const provider = new JsonRpcProvider(rpcUrl);
  const chainId: string = await getChainId(provider);
  return nativePrice(provider, chainId);
}

export async function getTokenPrice(tokenAddress: string, rpcUrl: string) : Promise<bigint> {
  const provider = new JsonRpcProvider(rpcUrl);
  const rawChainId = await getChainId(provider);
  const chainId = Number(rawChainId) as keyof AddressMap;
  const path = [tokenAddress, WNATIVE_ADDRESS[chainId]];

  const routerContract = new Contract(V2_ROUTER_ADDRESS[chainId], v2RouterAbi, provider);
  const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

  const [decimals, price] = await Promise.all([tokenContract.decimals(), nativePrice(provider, rawChainId)]);
  const [, tokenInNative] = await routerContract.getAmountsOut(parseUnits('1', decimals), path);
  return tokenInNative * price / ONE_ETHER;
}

export async function getBalancesSingleToken({
  userAddresses,
  contractToken,
  rpcUrl,
  chunkSize = 500,
}: SingleTokenRequest & {
  chunkSize?: number;
}): Promise<Balances> {
  const provider = new JsonRpcProvider(rpcUrl);
  const addresses = userAddresses.map((addr) => getAddress(addr));
  const chunked = chunk(addresses, chunkSize);
  const chunkedResults = await Promise.all(
    chunked.map((chunk) =>
      fetchRawBalancesMultipleAccounts({
        userAddresses: chunk,
        contractToken: getAddress(contractToken),
        provider,
      })
    )
  );

  const combineChunks: CallResult[] = chunkedResults.reduce((acc, res) => [...acc, ...res], []);

  return combineChunks.map(result => {
    const decoded = abiCoder.decode(["uint256"], result[1]);
    return decoded.toString();
  });
}

export async function getBalanceMultipleTokens({
  userAddress,
  contractTokens,
  rpcUrl,
  chunkSize = 500,
}: MultipleTokensRequest & {
  chunkSize?: number;
}): Promise<BalancesByContract> {
  const provider = new JsonRpcProvider(rpcUrl);
  const address = getAddress(userAddress);
  const chunked = chunk(contractTokens, chunkSize);
  
  const chunkedResults = await Promise.all(
    chunked.map((chunk) =>
      fetchRawBalancesMultipleTokens({
        userAddress: address,
        contractTokens: chunk,
        provider,
      })
    )
  );
  const combineChunks = chunkedResults.reduce((acc, res) => [...acc, ...res], []);
  const rawBalances = resultDataByAddress(combineChunks);
  const { calls, context } = buildCallsContext(combineChunks);
  const metaResults = await aggregate(calls, provider);
  const decodedMetaResults = decodeMetaResults(metaResults, context);
  return balancesByContract(decodedMetaResults, rawBalances);
}

async function fetchRawBalancesMultipleAccounts({
  userAddresses,
  contractToken,
  provider,
}: RawSingleTokenRequest): Promise<CallResult[]> {
  const erc20Interface = new Interface(erc20Abi);
  const balanceCalls: Call[] = userAddresses.map((userAddress) => ({
    target: contractToken,
    callData: erc20Interface.encodeFunctionData("balanceOf", [userAddress]),
  }));
  const results: CallResult[] = await aggregate(balanceCalls, provider);
  return results;
}

async function fetchRawBalancesMultipleTokens({
  userAddress,
  contractTokens,
  provider,
}: RawMultipleTokensRequest): Promise<CallResultWithAddress[]> {
  const erc20Interface = new Interface(erc20Abi);
  const balanceCalls: Call[] = contractTokens.map((tokenAddress) => ({
    target: tokenAddress,
    callData: erc20Interface.encodeFunctionData("balanceOf", [userAddress]),
  }));
  const results = await aggregate(balanceCalls, provider);
  const finalResults = createTupleResultWithAddress(results, contractTokens);
  return finalResults;
}

function resultDataByAddress(
  callResultsWithAddress: CallResultWithAddress[]
) {
  return callResultsWithAddress.reduce<Record<string, ReturnData>>(
    (balances, result) => {
      const { 0: contractAddress, 2: data } = result;
      return {
        ...balances,
        [contractAddress]: data,
      };
    },
    {}
  );
}

function buildCallsContext(callResultWithAddress: CallResultWithAddress[]) {
  const calls: Call[] = [];
  const context: CallContext[] = [];
  const contractAddresses = callResultWithAddress.map((result) => result[0]);
  const erc20Interface = new Interface(erc20Abi);
  contractAddresses.forEach((contractAddress) => {
    ["symbol", "decimals", "name"].forEach((methodName) => {
      calls.push({
        target: contractAddress,
        callData: erc20Interface.encodeFunctionData(methodName),
      });
      context.push({
        contractAddress,
        methodName,
      });
    });
  });

  return { calls, context };
}

function decodeMetaResults(
  metaResults: CallResult[],
  context: CallContext[]
): MetaByContract {
  return metaResults.reduce((meta: BalancesByContract, result, index) => {
    let methodValue;
    const { 1: data } = result;
    const { contractAddress, methodName } = context[index];

    try {
      const type = fragmentTypes[methodName];
      [methodValue] = abiCoder.decode([type], data);
    } catch (error) {
      console.info(`Error ${methodName} - ${contractAddress}`);
      methodValue = decodeBytes32String(data);
    }

    if (methodName === "decimals") {
      methodValue = Number(methodValue);
    }

    return {
      ...meta,
      [contractAddress]: {
        ...meta[contractAddress],
        [methodName]: methodValue,
      },
    };
  }, {});
}

function balancesByContract(
  metaDataByContract: MetaByContract,
  balanceDataByContract: Record<string, ReturnData>
) {
  return Object.keys(metaDataByContract).reduce<Record<string, TokenInfo>>(
    (balances, contractAddress) => {
      const { decimals } = metaDataByContract[contractAddress];
      const balanceHexString = balanceDataByContract[contractAddress];
      const decoded = abiCoder.decode(["uint256"], balanceHexString);
      const weiBalance = decoded.toString();
      const balance = formatUnits(weiBalance, decimals);

      return {
        ...balances,
        [contractAddress]: {
          ...metaDataByContract[contractAddress],
          balance,
          weiBalance
        },
      };
    },
    {}
  );
}

async function aggregate(calls: Call[], provider: Provider) : Promise<CallResult[]> {
  const contract = new Contract(MULTICALL, multicallAbi, provider);
  const { 2: results } : AggregateResponse = await contract.tryBlockAndAggregate.staticCall(false, calls);
  return results;
}

async function getChainId(provider: Provider) : Promise<string> {
  return provider.getNetwork().then((network: Network) => network.chainId.toString());
}

async function nativePrice(provider: Provider, chainId: string) : Promise<bigint> {
  const priceFeedContract = new Contract(WNATIVE_PRCE_FEEDS_ADDRESS[Number(chainId) as keyof AddressMap], aggregatorV3Abi, provider);
  const [, price, , , ] = await priceFeedContract?.latestRoundData();
  return parseUnits(price.toString(), 10);
}

function chunk<T>(array: T[], size: number) {
  const chunked: T[][] = [];
  let chunk: T[] = [];
  array.forEach((item: T) => {
    if (chunk.length === size) {
      chunked.push(chunk);
      chunk = [item];
    } else {
      chunk.push(item);
    }
  });

  if (chunk.length) {
    chunked.push(chunk);
  }

  return chunked;
}

function createTupleResultWithAddress(results: CallResult[], contractTokens: string[]) {
  return results.map<CallResultWithAddress>((result, index) => [
    contractTokens[index],
    ...result,
  ]);
}

const fragmentTypes = erc20Abi.reduce<Record<string, string>>(
  (typesByName, abiItem) => {
    const { name, outputs } = abiItem;
    if (outputs) {
      return {
        ...typesByName,
        [name]: outputs[0].type,
      };
    }
    return typesByName;
  },
  {}
);

import {
  AbiCoder,
  Contract,
  decodeBytes32String,
  getAddress,
  formatUnits,
  Interface,
  JsonRpcProvider,
} from "ethers";

import type { Provider } from "ethers";

import {
  AggregateResponse,
  CallResultWithAddress,
  Balances,
  BalancesByContract,
  Call,
  CallContext,
  CallResult,
  MetaByContract,
  MultipleAccountsSingleTokenRequest,
  RawMultipleAccountsSingleTokenRequest,
  RawSingleAccountsMultipleTokensRequest,
  ReturnData,
  SingleAccountMultipleTokensRequest,
  TokenInfo,
} from "./types";

import erc20Abi from "./abi/erc20.json";
import multicallAbi from "./abi/multicall.json";

const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";

const abiCoder = AbiCoder.defaultAbiCoder();

export async function getBalancesMultipleAccountsSingleToken({
  userAddresses,
  contractToken,
  rpcUrl,
  chunkSize = 500,
}: MultipleAccountsSingleTokenRequest & {
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

export async function getBalancesSingleAccountMultipleTokens({
  userAddress,
  contractTokens,
  rpcUrl,
  chunkSize = 500,
}: SingleAccountMultipleTokensRequest & {
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
}: RawMultipleAccountsSingleTokenRequest): Promise<CallResult[]> {
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
}: RawSingleAccountsMultipleTokensRequest): Promise<CallResultWithAddress[]> {
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

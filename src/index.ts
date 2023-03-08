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

import {
  WNATIVE_ADDRESS,
  WNATIVE_PRCE_FEEDS_ADDRESS,
  V2_ROUTER_ADDRESS,
  MULTICALL,
  AddressMap,
} from "./constants";

import erc20Abi from "./abi/erc20.json";
import v2RouterAbi from "./abi/v2Router.json";
import multicallAbi from "./abi/multicall.json";
import aggregatorV3Abi from "./abi/aggregatorV3.json";

const ONE_ETHER = parseUnits("1", "ether");

const abiCoder = AbiCoder.defaultAbiCoder();

export async function getNativePrice(rpcUrl: string): Promise<bigint> {
  const provider = new JsonRpcProvider(rpcUrl);
  const chainId: string = await getChainId(provider);
  return nativePrice(provider, chainId);
}

export async function getTokensPrice(
  contractTokens: string[],
  rpcUrl: string
): Promise<bigint[]> {
  const provider = new JsonRpcProvider(rpcUrl);
  const rawChainId = await getChainId(provider);
  const chainId = Number(rawChainId) as keyof AddressMap;

  const routerContract = new Contract(
    V2_ROUTER_ADDRESS[chainId],
    v2RouterAbi,
    provider
  );

  const paths = contractTokens.map((tokenAddress) => [
    getAddress(tokenAddress),
    WNATIVE_ADDRESS[chainId],
  ]);

  const [price, callResults]: [bigint, CallResultWithAddress[]] =
    await Promise.all([
      nativePrice(provider, rawChainId),
      fetchRawInfoMultipleTokens({
        contractTokens,
        functionName: "decimals",
        callData: [],
        provider,
        chunkSize: 500,
      }),
    ]);

  const decimals = callResults.map((result) => {
    const decoded = abiCoder.decode(["uint256"], result[2]);
    return decoded.toString();
  });

  const results: [bigint, bigint][] = await Promise.all(
    paths.map((path, index) =>
      routerContract.getAmountsOut(
        parseUnits("1", Number(decimals[index])),
        path
      )
    )
  );

  return results.map(
    ([, tokenInNative]) => (tokenInNative * price) / ONE_ETHER
  );
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

  const callResults: CallResult[] = await fetchRawInfoAccounts({
    userAddresses,
    contractToken,
    functionName: "balanceOf",
    provider,
    chunkSize,
  });

  return callResults.map((result) => {
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
  const callResults: CallResultWithAddress[] = await fetchRawInfoMultipleTokens(
    {
      contractTokens,
      functionName: "balanceOf",
      callData: [getAddress(userAddress)],
      provider,
      chunkSize,
    }
  );
  const rawBalances = resultDataByAddress(callResults);
  const { calls, context } = buildCallsContext(callResults);
  const metaResults = await aggregate(calls, provider);
  const decodedMetaResults = decodeMetaResults(metaResults, context);
  return balancesByContract(decodedMetaResults, rawBalances);
}

async function fetchRawInfoAccounts({
  userAddresses,
  contractToken,
  functionName,
  provider,
  chunkSize = 500,
}: RawSingleTokenRequest): Promise<CallResult[]> {
  const addresses = userAddresses.map((addr) => getAddress(addr));
  const chunked = chunk(addresses, chunkSize);
  const erc20Interface = new Interface(erc20Abi);

  const chunkedResults = await Promise.all(
    chunked.map((chunk) => {
      const calls: Call[] = chunk.map((userAddress) => ({
        target: getAddress(contractToken),
        callData: erc20Interface.encodeFunctionData(functionName, [
          userAddress,
        ]),
      }));
      return aggregate(calls, provider);
    })
  );

  const combineChunks: CallResult[] = chunkedResults.reduce(
    (acc, res) => [...acc, ...res],
    []
  );

  return combineChunks;
}

async function fetchRawInfoMultipleTokens({
  contractTokens,
  functionName,
  callData,
  provider,
  chunkSize = 500,
}: RawMultipleTokensRequest): Promise<CallResultWithAddress[]> {
  const chunked = chunk(contractTokens, chunkSize);
  const erc20Interface = new Interface(erc20Abi);

  const chunkedResults = await Promise.all(
    chunked.map((chunk) => {
      const calls: Call[] = chunk.map((tokenAddress) => ({
        target: tokenAddress,
        callData: erc20Interface.encodeFunctionData(functionName, callData),
      }));
      return aggregate(calls, provider);
    })
  );

  const combineChunks = chunkedResults.reduce(
    (acc, res) => [...acc, ...res],
    []
  );

  const finalResults = createTupleResultWithAddress(
    combineChunks,
    contractTokens
  );
  return finalResults;
}

function resultDataByAddress(callResultsWithAddress: CallResultWithAddress[]) {
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
          weiBalance,
        },
      };
    },
    {}
  );
}

async function aggregate(
  calls: Call[],
  provider: Provider
): Promise<CallResult[]> {
  const contract = new Contract(MULTICALL, multicallAbi, provider);
  const { 2: results }: AggregateResponse =
    await contract.tryBlockAndAggregate.staticCall(false, calls);
  return results;
}

async function getChainId(provider: Provider): Promise<string> {
  return provider
    .getNetwork()
    .then((network: Network) => network.chainId.toString());
}

async function nativePrice(
  provider: Provider,
  chainId: string
): Promise<bigint> {
  const priceFeedContract = new Contract(
    WNATIVE_PRCE_FEEDS_ADDRESS[Number(chainId) as keyof AddressMap],
    aggregatorV3Abi,
    provider
  );
  const [, price, , ,] = await priceFeedContract?.latestRoundData();
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

function createTupleResultWithAddress(
  results: CallResult[],
  contractTokens: string[]
) {
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

# ⟠ use-balances ⟠

A library to get user [ERC-20](https://ethereum.org/en/developers/docs/standards/tokens/erc-20/) balances on EVM blockchains using the Multicall smart contract

## Installation

```
npm install @dapp-builder/use-balances

```

## Example

```typescript
import { 
  getBalancesMultipleAccountsSingleToken, getBalancesSingleAccountMultipleTokens 
} from "@dapp-builder/use-balances";

const BSC_RPC_URL = "https://bsc-dataseed1.ninicoin.io";

const userAddresses = [
    "0xF977814e90dA44bFA03b6295A0616a897441aceC", // Binance hot wallet
    "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3", // Binance hot wallet
  ]; 

const contractTokens = [
  "0x55d398326f99059fF775485246999027B3197955", // USDT
  "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
];

let balances;

balances = await getBalancesSingleAccountMultipleTokens({
  userAddress: userAddresses[0],
  contractTokens,
  rpcUrl: BSC_RPC_URL,
});

console.log(balances);

balances = await getBalancesMultipleAccountsSingleToken({
  userAddresses,
  contractToken: contractTokens[0],
  rpcUrl: BSC_RPC_URL
})

console.log(balances);

```

## Supports

The below networks are supported 

| Chain                   | Chain ID   |
| ----------------------- | ---------- |
| Mainnet                 | 1          |
| Kovan                   | 3          |
| Rinkeby                 | 4          |
| Görli                   | 5          |
| Ropsten                 | 10         |
| Sepolia                 | 42         |
| Optimism                | 137        |
| Optimism Kovan          | 69         |
| Optimism Görli          | 100        |
| Arbitrum                | 420        |
| Arbitrum Görli          | 42161      |
| Arbitrum Rinkeby        | 421611     |
| Polygon                 | 421613     |
| Mumbai                  | 80001      |
| Gnosis Chain (xDai)     | 11155111   |
| Avalanche               | 43114      |
| Avalanche Fuji          | 43113      |
| Fantom Testnet          | 4002       |
| Fantom Opera            | 250        |
| BNB Smart Chain         | 56         |
| BNB Smart Chain Testnet | 97         |
| Moonbeam                | 1284       |
| Moonriver               | 1285       |
| Moonbase Alpha Testnet  | 1287       |
| Harmony                 | 1666600000 |
| Cronos                  | 25         |
| Fuse                    | 122        |
| Songbird Canary Network | 19         |
| Coston Testnet          | 16         |
| Boba                    | 288        |
| Aurora                  | 1313161554 |
| Astar                   | 592        |
| OKC                     | 66         |
| Heco Chain              | 128        |
| Metis                   | 1088       |
| RSK                     | 30         |
| RSK Testnet             | 31         |
| Evmos                   | 9001       |
| Evmos Testnet           | 9000       |
| Thundercore             | 108        |
| Thundercore Testnet     | 18         |
| Oasis                   | 26863      |
| Celo                    | 42220      |
| Godwoken                | 71402      |
| Godwoken Testnet        | 71401      |
| Klatyn                  | 8217       |
| Milkomeda               | 2001       |
| KCC                     | 321        |
| Etherlite               | 111        |

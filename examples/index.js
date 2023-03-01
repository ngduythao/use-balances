const {
  getBalancesMultipleAccountsSingleToken,
  getBalancesSingleAccountMultipleTokens,
} = require("../dist/index.cjs");

const BSC_RPC_URL = "https://bsc-dataseed1.ninicoin.io";

const main = async () => {
  let balances;

  const userAddresses = [
    "0xF977814e90dA44bFA03b6295A0616a897441aceC", // Binance wallet
    "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3", // Binance wallet
  ]; 
  const contractTokens = [
    "0x55d398326f99059fF775485246999027B3197955", // USDT
    "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
  ];

  try {
    balances = await getBalancesSingleAccountMultipleTokens({
      userAddress: userAddresses[0],
      contractTokens,
      rpcUrl: BSC_RPC_URL,
    });
    console.log(`Balances for ${userAddresses[0]}: `, balances);

    balances = await getBalancesMultipleAccountsSingleToken({
      userAddresses,
      contractToken: contractTokens[0],
      rpcUrl: BSC_RPC_URL
    })

    console.log(`Balances for ${userAddresses}: `, balances);

  } catch (error) {
    console.error(error);
  }
};

main();

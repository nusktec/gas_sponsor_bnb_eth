import {
  FlashbotsBundleProvider, FlashbotsBundleRawTransaction,
  FlashbotsBundleResolution,
  FlashbotsBundleTransaction
} from "@flashbots/ethers-provider-bundle";
import { BigNumber, providers, Wallet} from "ethers";
import { Base } from "./engine/Base";
import { checkSimulation, gasPriceToGwei, printTransactions } from "./utils";
import { Approval721 } from "./engine/Approval721";
import {TransferERC20} from "./engine/TransferERC20";
require('log-timestamp');

//Compromise Wallet Phrase: year tag motion biology chuckle more wood minor miracle canal enlist assume
//Compromise Eth Pkey: 0x8461620dc685d4afcfc3d00ee7c20fd9fda11c1ffc281e230010219621ccdde7
//Compromise bsc Pkey: 0x8461620dc685d4afcfc3d00ee7c20fd9fda11c1ffc281e230010219621ccdde7

// BSC Spender PKey: 4528e43f1d9bb530597b341e255e79a1aaad810bedaa3ed34f9d086b6d2dc7ba
// SRC Spender PKey: 9ae64498f1b3634ae91ed4d9b407af84c14be9a4e4e4b3f0b4030af6c436d719

// BSC Collector: 0x0Cca1cC1DF22ca762ADb818Ed96097e269070e62

//bsc-url: https://bsc-dataseed.binance.org

const BLOCKS_IN_FUTURE =2;

const GWEI = BigNumber.from(10).pow(9);
const PRIORITY_GAS_PRICE = GWEI.mul(31)

const PRIVATE_KEY_EXECUTOR = "0x8461620dc685d4afcfc3d00ee7c20fd9fda11c1ffc281e230010219621ccdde7";
//const PRIVATE_KEY_SPONSOR = "0xcd1eda00ea7b602af74fbba0dcf450e7544d271c024fcdfbcedbaf6861b6c6af"; // FOR ERC
const PRIVATE_KEY_SPONSOR = "4528e43f1d9bb530597b341e255e79a1aaad810bedaa3ed34f9d086b6d2dc7ba";

const FLASHBOTS_RELAY_SIGNING_KEY = "4528e43f1d9bb530597b341e255e79a1aaad810bedaa3ed34f9d086b6d2dc7ba";
const RECIPIENT = "0x0Cca1cC1DF22ca762ADb818Ed96097e269070e62";


async function main() {
  const walletRelay = new Wallet(FLASHBOTS_RELAY_SIGNING_KEY)

  // ======= UNCOMMENT FOR GOERLI ==========
  //const provider = new providers.InfuraProvider(5, process.env.INFURA_API_KEY || '');
  //const flashbotsProvider = await FlashbotsBundleProvider.create(provider, walletRelay, 'https://relay-goerli.epheph.com/');
  // ======= UNCOMMENT FOR GOERLI ==========

  // ======= UNCOMMENT FOR MAINNET ==========
  // const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || "http://127.0.0.1:8545"
  //const provider = new providers.StaticJsonRpcProvider("https://rpc.ankr.com/eth"); //for erc
  const provider = new providers.StaticJsonRpcProvider("https://bsc-dataseed.binance.org");
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, walletRelay);
  // ======= UNCOMMENT FOR MAINNET ==========

  const walletExecutor = new Wallet(PRIVATE_KEY_EXECUTOR);
  const walletSponsor = new Wallet(PRIVATE_KEY_SPONSOR);

  const block = await provider.getBlock("pending")

  // ======= UNCOMMENT FOR ERC20 TRANSFER ==========
  const tokenAddress = "0x0b33542240d6fA323c796749F6D6869fdB7F13cA";
  const engine: Base = new TransferERC20(provider, walletExecutor.address, RECIPIENT, tokenAddress);
  // ======= UNCOMMENT FOR ERC20 TRANSFER ==========

  // ======= UNCOMMENT FOR 721 Approval ==========
 // const HASHMASKS_ADDRESS = "0xC2C747E0F7004F9E8817Db2ca4997657a7746928";
  //const engine: Base = new Approval721(RECIPIENT, [HASHMASKS_ADDRESS]);
  // ======= UNCOMMENT FOR 721 Approval ==========

  const sponsoredTransactions = await engine.getSponsoredTransactions();

  const gasEstimates = await Promise.all(sponsoredTransactions.map(tx =>
    provider.estimateGas({
      ...tx,
      from: tx.from === undefined ? walletExecutor.address : tx.from
    }))
  )
  const gasEstimateTotal = gasEstimates.reduce((acc, cur) => acc.add(cur), BigNumber.from(0))

  const gasPrice = PRIORITY_GAS_PRICE.add(block.baseFeePerGas || 0);
  const bundleTransactions: Array<FlashbotsBundleTransaction | FlashbotsBundleRawTransaction> = [
    {
      transaction: {
        to: walletExecutor.address,
        gasPrice: gasPrice,
        value: gasEstimateTotal.mul(gasPrice),
        gasLimit: 21000,
      },
      signer: walletSponsor
    },
    ...sponsoredTransactions.map((transaction, txNumber) => {
      return {
        transaction: {
          ...transaction,
          gasPrice: gasPrice,
          gasLimit: gasEstimates[txNumber],
        },
        signer: walletExecutor,
      }
    })
  ]
  const signedBundle = await flashbotsProvider.signBundle(bundleTransactions)
  await printTransactions(bundleTransactions, signedBundle);
  const simulatedGasPrice = await checkSimulation(flashbotsProvider, signedBundle);

  console.log(await engine.description())

  console.log(`Executor Account: ${walletExecutor.address}`)
  console.log(`Sponsor Account: ${walletSponsor.address}`)
  console.log(`Simulated Gas Price: ${gasPriceToGwei(simulatedGasPrice)} gwei`)
  console.log(`Gas Price: ${gasPriceToGwei(gasPrice)} gwei`)
  console.log(`Gas Used: ${gasEstimateTotal.toString()}`)

  provider.on('block', async (blockNumber) => {
    const simulatedGasPrice = await checkSimulation(flashbotsProvider, signedBundle);
    const targetBlockNumber = blockNumber + BLOCKS_IN_FUTURE;
    console.log(`Current Block Number: ${blockNumber},   Target Block Number:${targetBlockNumber},   gasPrice: ${gasPriceToGwei(simulatedGasPrice)} gwei`)
    const bundleResponse = await flashbotsProvider.sendBundle(bundleTransactions, targetBlockNumber);
    if ('error' in bundleResponse) {
      throw new Error(bundleResponse.error.message)
    }
    const bundleResolution = await bundleResponse.wait()
    if (bundleResolution === FlashbotsBundleResolution.BundleIncluded) {
      console.log(`Congrats, included in ${targetBlockNumber}`)
      process.exit(0)
    } else if (bundleResolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
      console.log(`Not included in ${targetBlockNumber}`)
    } else if (bundleResolution === FlashbotsBundleResolution.AccountNonceTooHigh) {
      console.log("Nonce too high, bailing")
      process.exit(1)
    }
  })
}

main()

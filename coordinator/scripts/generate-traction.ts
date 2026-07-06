import * as chain from '../src/chain';
import { parseUnits, toHex, type Hex } from 'viem';

const USE_TESTNET = true;
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;

async function main() {
  if (!PRIVATE_KEY) {
    console.error("❌ Missing PRIVATE_KEY. Please set it in your .env or environment.");
    process.exit(1);
  }
  if (!process.env.USDC_ADDRESS) {
    console.error("❌ Missing USDC_ADDRESS. Make sure it's set in your environment.");
    process.exit(1);
  }
  
  chain.configureTestnet(PRIVATE_KEY);
  
  console.log("\n🚀 Deploying RagentEscrow & Registry to Arc Testnet...");
  const contracts = await chain.deployContracts(USE_TESTNET);
  
  const provider = chain.getCurrentProviderAccount().address;
  // We'll use tiny amounts for the loop: 0.1 USDC price, 0.05 USDC penalty
  const price = parseUnits('0.1', 6); 
  const penalty = parseUnits('0.05', 6); 
  
  const ITERATIONS = 12; // 12 cycles * 5 txs = 60 txs. Plus 2 for deploy = 62 txs total.
  console.log(`\n🔥 Starting Traction Loop (${ITERATIONS} iterations) 🔥`);
  console.log(`Expected Transactions: ~${ITERATIONS * 5 + 2}\n`);
  
  for (let i = 0; i < ITERATIONS; i++) {
    console.log(`\n--- Cycle ${i + 1} of ${ITERATIONS} ---`);
    
    // Use a unique 32-byte hex for each escrow/intent
    const uniqueString = `ragent-traction-${Date.now()}-${i}`;
    const intentId = toHex(uniqueString.padEnd(32, '0').slice(0, 32));
    
    try {
      // 1. Create Escrow (This also does 2 USDC 'approve' txs behind the scenes)
      console.log(`[1/3] Creating Escrow (Intent ID: ${intentId})...`);
      await chain.createEscrow(contracts, intentId, provider, price, penalty, USE_TESTNET);
      
      // 2. Attest success
      console.log(`[2/3] Attesting successful execution...`);
      const proofHash = toHex(`proof-${Date.now()}`.padEnd(32, '0').slice(0, 32));
      await chain.attest(contracts, intentId, true, proofHash, USE_TESTNET);
      
      // 3. Release funds
      console.log(`[3/3] Releasing funds to provider...`);
      await chain.release(contracts, intentId, USE_TESTNET);
      
      console.log(`✅ Cycle ${i + 1} complete.`);
    } catch (err: any) {
      console.error(`❌ Cycle ${i + 1} failed:`, err.message);
      // We continue to the next cycle even if one fails
    }
  }
  
  console.log("\n🎉 Traction generation complete!");
  console.log(`Check your wallet address on ArcScan (https://testnet.arcscan.app/address/${chain.getCurrentAccount().address}) to see the wall of green!`);
}

main().catch(console.error);

/**
 * generate-traction.ts
 *
 * Generates 50+ real on-chain transactions on Arc Testnet by running
 * complete negotiation cycles through RagentEscrow.
 *
 * Each cycle: approve → createEscrow → attest → release = 3 txs
 * 20 cycles × 3 txs = 60 txs + 2 deploy txs = ~62 total
 *
 * Fix notes:
 * - Single wallet used for both requester + provider (same key for demo)
 * - Combined approve covers price + penalty in ONE call to avoid overwrite bug
 * - 3s delay between cycles to avoid txpool congestion on Arc testnet
 */

import * as chain from '../src/chain';
import { parseUnits, toHex, keccak256, encodePacked, type Hex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { setTimeout as sleep } from 'timers/promises';

const USE_TESTNET = true;
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;

// ERC20 approve ABI (works for Arc native USDC at 0x3600...)
const approveAbi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

async function main() {
  if (!PRIVATE_KEY) {
    console.error('❌ Missing PRIVATE_KEY in .env');
    process.exit(1);
  }

  chain.configureTestnet(PRIVATE_KEY);
  const { walletClient, publicClient } = chain.getClients(USE_TESTNET);
  const account = chain.getCurrentAccount();

  console.log('\n🚀 Deploying RagentEscrow & Registry to Arc Testnet...');
  const contracts = await chain.deployContracts(USE_TESTNET);

  const USDC = contracts.usdc as Address;
  const ESCROW = contracts.escrow as Address;

  // For traction demo: requester and provider are same wallet
  // We use a stable "provider" address (the wallet itself) for the escrow
  const providerAddr = account.address;

  // Amounts: 0.1 USDC price + 0.05 USDC penalty = 0.15 USDC total per cycle
  const price   = parseUnits('0.1',  6); // 100000 micro-USDC
  const penalty = parseUnits('0.05', 6); // 50000  micro-USDC
  const total   = price + penalty;       // 150000 micro-USDC — what we approve in ONE call

  const ITERATIONS = 20;
  console.log(`\n🔥 Starting Traction Loop (${ITERATIONS} cycles × 3 txs = ${ITERATIONS * 3} txs + 2 deploy = ${ITERATIONS * 3 + 2} total)\n`);

  let success = 0;
  let failed  = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    console.log(`\n--- Cycle ${i + 1} of ${ITERATIONS} ---`);

    // Unique 32-byte intent ID for this cycle
    const intentId = keccak256(encodePacked(
      ['string', 'uint256'],
      [`ragent-traction-${Date.now()}`, BigInt(i)]
    )) as Hex;

    try {
      // ── Step 1: Single combined approve (price + penalty) ─────────────────
      // Because requester == provider (same wallet), we approve the total in
      // ONE call. A second approve would overwrite the first, causing the
      // "transfer amount exceeds allowance" revert we saw before.
      console.log(`  [1/3] Approving ${total} micro-USDC to escrow...`);
      const approveTx = await walletClient.writeContract({
        address:      USDC,
        abi:          approveAbi,
        functionName: 'approve',
        args:         [ESCROW, total],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
      console.log(`  ✅ Approved. Tx: ${approveTx}`);

      // ── Step 2: createEscrow ───────────────────────────────────────────────
      console.log(`  [2/3] Creating Escrow...`);
      const escrowTx = await chain.createEscrow(
        contracts,
        intentId,
        providerAddr,
        price,
        penalty,
        USE_TESTNET
      );
      console.log(`  ✅ Escrow created. Tx: ${escrowTx}`);

      // ── Step 3: Attest + Release ───────────────────────────────────────────
      const proofHash = keccak256(encodePacked(['string'], [`proof-${Date.now()}-${i}`])) as Hex;
      console.log(`  [3/3] Attesting + Releasing...`);
      const attestTx = await chain.attest(contracts, intentId, true, proofHash, USE_TESTNET);
      const releaseTx = await chain.release(contracts, intentId, USE_TESTNET);
      console.log(`  ✅ Attested: ${attestTx}`);
      console.log(`  ✅ Released: ${releaseTx}`);
      console.log(`  🏆 Cycle ${i + 1} complete!`);
      success++;

    } catch (err: any) {
      console.error(`  ❌ Cycle ${i + 1} failed:`, err.shortMessage ?? err.message);
      failed++;
    }

    // Brief pause between cycles to avoid txpool congestion
    if (i < ITERATIONS - 1) {
      console.log(`  ⏳ Waiting 3s before next cycle...`);
      await sleep(3000);
    }
  }

  const txCount = (success * 4) + 2; // 4 txs per successful cycle (approve + create + attest + release) + 2 deploys
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`🎉 TRACTION GENERATION COMPLETE`);
  console.log(`   Successful cycles : ${success} / ${ITERATIONS}`);
  console.log(`   Failed cycles     : ${failed}`);
  console.log(`   Est. transactions : ~${txCount}`);
  console.log(`\n   🔗 View your wallet on ArcScan:`);
  console.log(`   https://testnet.arcscan.app/address/${account.address}`);
  console.log(`\n   📜 View RagentEscrow contract:`);
  console.log(`   https://testnet.arcscan.app/address/${ESCROW}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);

/**
 * generate-traction.ts
 *
 * Generates 50+ real on-chain transactions on Arc Testnet by running
 * complete negotiation cycles through RagentEscrow.
 *
 * Each cycle: approve → createEscrow → attest → release = 4 txs
 * 20 cycles × 4 txs = 80 txs + 2 deploy txs = ~82 total
 *
 * Key design decision:
 * - We call the contract directly (not via chain.createEscrow) so we control
 *   the approve flow. chain.createEscrow does two separate approves which
 *   overwrite each other when requester == provider (same wallet in demo).
 *   Instead we do ONE combined approve(price + penalty) then call createEscrow.
 */

import * as chain from '../src/chain';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  parseUnits,
  keccak256,
  encodePacked,
  type Hex,
  type Address,
} from 'viem';
import { setTimeout as sleep } from 'timers/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const USE_TESTNET = true;
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;

// Load compiled escrow ABI
const escrowArtifact = JSON.parse(
  fs.readFileSync(join(__dirname, '../artifacts/RagentEscrow.json'), 'utf8')
);

// Minimal ERC20 ABI (approve + allowance)
const erc20Abi = [
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
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner',   type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
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

  const USDC   = contracts.usdc   as Address;
  const ESCROW = contracts.escrow as Address;
  const ME     = account.address  as Address;

  // Check balance first
  const balance = await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ME],
  }) as bigint;
  console.log(`\n💰 Wallet balance: ${balance} micro-USDC (${Number(balance) / 1e6} USDC)`);

  if (balance === 0n) {
    console.error('❌ Wallet has 0 USDC. Get testnet USDC from https://faucet.circle.com (select Arc Testnet)');
    process.exit(1);
  }

  // Amounts per cycle: 0.1 USDC price + 0.05 USDC penalty = 0.15 USDC
  const price   = parseUnits('0.1',  6); // 100000 micro-USDC
  const penalty = parseUnits('0.05', 6); //  50000 micro-USDC
  const total   = price + penalty;       // 150000 micro-USDC per cycle

  const ITERATIONS = 20;
  console.log(`\n🔥 Starting Traction Loop (${ITERATIONS} cycles × 4 txs = ~${ITERATIONS * 4 + 2} total txs)\n`);

  let success = 0;
  let failed  = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    console.log(`\n--- Cycle ${i + 1} of ${ITERATIONS} ---`);

    // Unique 32-byte intent ID for this cycle
    const intentId = keccak256(encodePacked(
      ['string', 'uint256'],
      [`ragent-${Date.now()}`, BigInt(i)]
    )) as Hex;

    try {
      // ── Step 1: Single combined approve ─────────────────────────────────
      // One approve(price + penalty) so the allowance covers everything
      // the contract will pull. We do NOT call chain.createEscrow because
      // it internally does two separate approves that overwrite each other.
      console.log(`  [1/4] Approving ${total} micro-USDC (price + penalty)...`);
      const approveTx = await walletClient.writeContract({
        address:      USDC,
        abi:          erc20Abi,
        functionName: 'approve',
        args:         [ESCROW, total],
      });
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
      if (approveReceipt.status === 'reverted') throw new Error('Approve tx reverted');
      console.log(`  ✅ Approved. Tx: ${approveTx}`);

      // ── Step 2: createEscrow directly ───────────────────────────────────
      // Call the contract directly so there are no extra approves done behind
      // the scenes. provider == ME because it's a single-wallet demo.
      console.log(`  [2/4] Creating Escrow on-chain...`);
      const escrowTx = await walletClient.writeContract({
        address:      ESCROW,
        abi:          escrowArtifact.abi,
        functionName: 'createEscrow',
        args:         [intentId, ME, price, penalty, USDC],
      });
      const escrowReceipt = await publicClient.waitForTransactionReceipt({ hash: escrowTx });
      if (escrowReceipt.status === 'reverted') throw new Error('createEscrow tx reverted');
      console.log(`  ✅ Escrow created. Tx: ${escrowTx}`);

      // ── Step 3: Attest success ───────────────────────────────────────────
      const proofHash = keccak256(encodePacked(
        ['string'],
        [`proof-${Date.now()}-${i}`]
      )) as Hex;
      console.log(`  [3/4] Attesting...`);
      const attestTx = await walletClient.writeContract({
        address:      ESCROW,
        abi:          escrowArtifact.abi,
        functionName: 'attest',
        args:         [intentId, true, proofHash],
      });
      const attestReceipt = await publicClient.waitForTransactionReceipt({ hash: attestTx });
      if (attestReceipt.status === 'reverted') throw new Error('attest tx reverted');
      console.log(`  ✅ Attested. Tx: ${attestTx}`);

      // ── Step 4: Release funds ────────────────────────────────────────────
      console.log(`  [4/4] Releasing...`);
      const releaseTx = await walletClient.writeContract({
        address:      ESCROW,
        abi:          escrowArtifact.abi,
        functionName: 'release',
        args:         [intentId],
      });
      const releaseReceipt = await publicClient.waitForTransactionReceipt({ hash: releaseTx });
      if (releaseReceipt.status === 'reverted') throw new Error('release tx reverted');
      console.log(`  ✅ Released. Tx: ${releaseTx}`);
      console.log(`  🏆 Cycle ${i + 1} COMPLETE!`);
      success++;

    } catch (err: any) {
      const msg = err.shortMessage ?? err.message ?? String(err);
      console.error(`  ❌ Cycle ${i + 1} failed: ${msg}`);
      failed++;
    }

    // Brief pause between cycles to avoid txpool congestion
    if (i < ITERATIONS - 1) {
      await sleep(2000);
    }
  }

  const txCount = (success * 4) + 2; // 4 per cycle + 2 deploy
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`🎉 TRACTION GENERATION COMPLETE`);
  console.log(`   Successful cycles : ${success} / ${ITERATIONS}`);
  console.log(`   Failed cycles     : ${failed}`);
  console.log(`   Est. transactions : ~${txCount}`);
  console.log(`\n   🔗 Wallet on ArcScan:`);
  console.log(`   https://testnet.arcscan.app/address/${ME}`);
  console.log(`\n   📜 RagentEscrow contract on ArcScan:`);
  console.log(`   https://testnet.arcscan.app/address/${ESCROW}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);

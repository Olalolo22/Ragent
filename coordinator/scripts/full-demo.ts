/**
 * Ragent Full End-to-End Demo — All 3 Job Types
 *
 * Demonstrates the complete Ragent flow for:
 *   Round 1: API job    — Fetch USDC/ETH price from Binance (low latency, uptime)
 *   Round 2: Task job   — Summarize + classify a research document (capability, confidence)
 *   Round 3: Compute job — Route inference workload to a GPU provider (capacity, uptime)
 *
 * Each round:
 *   1. Agentic Requester creates a dynamic Intent with job-specific policy
 *   2. Provider agents (different personalities) submit EIP-712 signed bids
 *   3. Coordinator filters (hard constraints) + scores (job-type formula) → winner
 *   4. On-chain: escrow created, attested, released (local anvil or Arc testnet)
 *
 * Run: cd coordinator && npm run full-demo
 */

import {
  generateDynamicIntent,
  generateTaskIntent,
  generateComputeIntent,
  generateBid,
  getMockPersonalities,
  getTaskPersonalities,
  getComputePersonalities,
  AgentPersonality,
} from '../src/agents/llm-agent';
import { Intent, Bid } from '../src/schemas';
import { selectWinner, passesConstraints, scoreAndExplain } from '../src/algo';
import * as chain from '../src/chain';
import { signBid } from '../src/eip712';

const { getCurrentAccount, getClients } = chain;
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const USE_TESTNET  = process.env.USE_TESTNET  === 'true';
const PRIVATE_KEY  = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const DEMO_CHAIN_ID = USE_TESTNET ? 123456 : 31337;

// ─────────────────────────────────────────────────────────────────────────────
// Shared negotiation round (reused for all 3 job types)
// ─────────────────────────────────────────────────────────────────────────────

async function runNegotiationRound(
  roundLabel: string,
  intent: Intent,
  personalities: AgentPersonality[],
  providerWallet: ReturnType<typeof getClients>['providerWallet']
): Promise<Bid | null> {
  const jobEmoji: Record<string, string> = { api: '🌐', task: '🧠', compute: '⚡' };
  const emoji = jobEmoji[intent.job_type] ?? '🤖';

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`${emoji}  ROUND ${roundLabel} — ${intent.job_type.toUpperCase()} JOB`);
  console.log(`${'─'.repeat(64)}`);
  console.log(`   Intent: ${intent.task_payload.description ?? intent.intent_id}`);
  console.log(`   Weights:     ${JSON.stringify(intent.selection_policy.weights)}`);
  console.log(`   Constraints: ${JSON.stringify(intent.selection_policy.constraints)}\n`);

  // ── Provider agents bid ──────────────────────────────────────────────────
  const providerAddr = providerWallet.account!.address;
  const bids: Bid[] = [];

  for (let i = 0; i < personalities.length; i++) {
    const raw = await generateBid(intent, providerAddr, personalities[i], `agent-${i}`);
    const signed = await signBid(raw, providerWallet, DEMO_CHAIN_ID);
    bids.push(signed);

    const key = intent.job_type === 'api'
      ? `lat=${signed.terms.latency_ms}ms rep=${signed.terms.reputation}`
      : intent.job_type === 'task'
      ? `conf=${signed.terms.confidence} eta=${signed.terms.eta_seconds}s`
      : `cap=${signed.terms.capacity} up=${signed.terms.uptime}`;

    console.log(`   ${personalities[i].name.padEnd(14)} price=$${signed.terms.price_usdc} ${key} stake=$${signed.staked_penalty_usdc} sig=${signed.signature?.slice(0, 14)}... ✅`);
  }

  // ── Hard constraint filter ───────────────────────────────────────────────
  console.log('\n   Step 1: Hard Constraints');
  for (const bid of bids) {
    const valid = passesConstraints(intent, bid);
    const name  = personalities.find((_, i) => bids[i]?.bid_id === bid.bid_id)?.name
                  ?? personalities[bids.indexOf(bid)]?.name;
    console.log(`     ${(name ?? bid.bid_id).padEnd(14)} ${valid ? '✓ PASS' : '✗ FAIL'}`);
  }

  // ── Scoring ──────────────────────────────────────────────────────────────
  console.log('\n   Step 2: Scoring');
  const scored = bids
    .filter(b => passesConstraints(intent, b))
    .map(b    => scoreAndExplain(intent, b, bids))
    .sort((a, b) => b.score - a.score);

  scored.forEach((s, rank) => {
    const idx  = bids.indexOf(s.bid);
    const name = personalities[idx]?.name ?? s.bid.bid_id;
    console.log(`     ${rank + 1}. ${name.padEnd(14)} score=${s.score.toFixed(4)}`);
  });

  // ── Winner ───────────────────────────────────────────────────────────────
  const winner = selectWinner(intent, bids);
  if (!winner) {
    console.log('\n   ✗ No bids passed constraints — no winner this round.');
    return null;
  }

  const winnerIdx  = bids.indexOf(winner);
  const winnerName = personalities[winnerIdx]?.name ?? winner.bid_id;
  console.log(`\n   🏆 WINNER: ${winnerName} — $${winner.terms.price_usdc} USDC`);
  return winner;
}

// ─────────────────────────────────────────────────────────────────────────────
// On-chain settlement helper (shared across rounds)
// ─────────────────────────────────────────────────────────────────────────────

async function settleOnChain(
  contracts: chain.DeployedContracts,
  winner: Bid,
  intent: Intent
): Promise<void> {
  const escrowId = ('0x' + Buffer.from(intent.intent_id)
    .toString('hex').padEnd(64, '0').slice(0, 64)) as `0x${string}`;

  const price   = BigInt(Math.round(winner.terms.price_usdc * 1e6));
  const penalty = BigInt(Math.round(winner.staked_penalty_usdc * 1e6));
  const provider = USE_TESTNET
    ? getCurrentAccount().address
    : '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`;

  await chain.createEscrow(contracts, escrowId, provider, price, penalty, USE_TESTNET);

  const observedLatency = Math.floor((winner.terms.latency_ms ?? 400) * 0.88);
  const proofHash = ('0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')) as `0x${string}`;

  console.log(`   Observed latency: ${observedLatency}ms`);
  await chain.attest(contracts, escrowId, true, proofHash, USE_TESTNET);
  await chain.release(contracts, escrowId, USE_TESTNET);
  console.log(`   ✅ Escrow released to provider.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║          RAGENT — FULL MULTI-JOB END-TO-END DEMO          ║');
  console.log('║    Negotiation Layer for the Agentic Economy on Arc       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  if (USE_TESTNET && PRIVATE_KEY) chain.configureTestnet(PRIVATE_KEY);

  const { providerWallet } = getClients(USE_TESTNET);

  // ── ROUND 1: API job ──────────────────────────────────────────────────────
  const apiIntent = await generateDynamicIntent(
    'Fetch the current USDC/ETH price from Binance API with low latency and high reliability',
    { endpoint: 'https://api.binance.com/api/v3/ticker/price', symbol: 'ETHUSDC' }
  );
  const apiWinner = await runNegotiationRound('1/3', apiIntent, getMockPersonalities(), providerWallet);

  // ── ROUND 2: Task job ─────────────────────────────────────────────────────
  const taskIntent = await generateTaskIntent(
    'Summarize and classify a 10-page DeFi research paper into structured JSON',
    ['nlp', 'summarize', 'classify'],
    { source: 'arxiv', domain: 'defi' }
  );
  const taskWinner = await runNegotiationRound('2/3', taskIntent, getTaskPersonalities(), providerWallet);

  // ── ROUND 3: Compute job ──────────────────────────────────────────────────
  const computeIntent = await generateComputeIntent(
    'Route a 7B parameter LLM inference workload to an available GPU provider',
    { model: 'llama-3-7b', tokens: 2048 }
  );
  const computeWinner = await runNegotiationRound('3/3', computeIntent, getComputePersonalities(), providerWallet);

  // ── ON-CHAIN SETTLEMENT ───────────────────────────────────────────────────
  const chainLabel = USE_TESTNET ? '🌐 Arc Testnet + ERC-8004' : '🔧 Local Anvil';
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`⛓️  ON-CHAIN SETTLEMENT — ${chainLabel}`);
  console.log(`${'─'.repeat(64)}`);

  let anvilProcess: ReturnType<typeof spawn> | null = null;
  const ANVIL_BIN = `${process.env.HOME}/.foundry/bin/anvil`;

  try {
    if (!USE_TESTNET) {
      try {
        await chain.publicClient.getBlockNumber();
        console.log('   Anvil already running on :8545');
      } catch {
        console.log('   Starting temporary anvil...');
        anvilProcess = spawn(ANVIL_BIN, ['--block-time', '1', '--silent'], {
          stdio: 'ignore', detached: true,
        });
        await sleep(1800);
      }
    }

    const contracts = await chain.deployContracts(USE_TESTNET);
    console.log('   Contracts deployed.\n');

    // Settle each winning bid on-chain
    const rounds: Array<[string, Bid | null, Intent]> = [
      ['API',     apiWinner,     apiIntent    ],
      ['Task',    taskWinner,    taskIntent   ],
      ['Compute', computeWinner, computeIntent],
    ];

    for (const [label, winner, intent] of rounds) {
      if (!winner) {
        console.log(`   ${label}: no winner — skipping settlement.`);
        continue;
      }
      console.log(`   Settling ${label} job (winner: $${winner.terms.price_usdc})...`);
      await settleOnChain(contracts, winner, intent);
    }

    // ERC-8004 reputation update on testnet (for API round winner as demo)
    if (USE_TESTNET && apiWinner?.agent_id) {
      const agentId = BigInt(apiWinner.agent_id);
      await chain.giveFeedback(agentId, 92, 'sla_met', true);
      console.log(`\n   ✅ ERC-8004 reputation recorded for agentId=${agentId}`);
    }

    if (USE_TESTNET) console.log(`   Explorer: https://testnet.arcscan.app`);

  } catch (err: any) {
    console.log('\n   ⚠ On-chain execution failed — chain not available.');
    console.log('  ', err.message ?? err);
    if (USE_TESTNET) console.log('   Tip: Set PRIVATE_KEY + USDC_ADDRESS for Arc testnet.');
  } finally {
    if (anvilProcess) {
      console.log('\n   Cleaning up anvil...');
      anvilProcess.kill('SIGTERM');
    }
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                ✅ RAGENT FULL FLOW COMPLETE                ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Round 1 — API     winner: ${(apiWinner ? '$' + apiWinner.terms.price_usdc + ' USDC' : 'none').padEnd(30)}║`);
  console.log(`║  Round 2 — Task    winner: ${(taskWinner ? '$' + taskWinner.terms.price_usdc + ' USDC' : 'none').padEnd(30)}║`);
  console.log(`║  Round 3 — Compute winner: ${(computeWinner ? '$' + computeWinner.terms.price_usdc + ' USDC' : 'none').padEnd(30)}║`);
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  Each winner: EIP-712 signed bid, hard constraint filter,  ║');
  console.log('║  job-specific scoring, on-chain escrow + attest + release  ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  Arc testnet: USE_TESTNET=true PRIVATE_KEY=0x... npm run full-demo ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

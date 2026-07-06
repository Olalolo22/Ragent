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
 * Video mode (cleaner for recordings): VIDEO=1 npm run full-demo   or   npm run full-demo -- --video
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
import { buildDemoProof, verifyWork } from '../src/agents/verifier-agent';

const { getCurrentAccount, getClients } = chain;
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const USE_TESTNET  = process.env.USE_TESTNET  === 'true';
const PRIVATE_KEY  = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const DEMO_CHAIN_ID = USE_TESTNET ? 5042002 : 31337; // Arc Testnet chain ID = 5042002

// Video mode: cleaner, less noisy output + final structured JSON (great for recording)
const VIDEO_MODE = process.env.VIDEO === '1' || process.env.VIDEO_MODE === '1' || process.argv.includes('--video');

// ─────────────────────────────────────────────────────────────────────────────
// Shared negotiation round (reused for all 3 job types)
// ─────────────────────────────────────────────────────────────────────────────

async function runNegotiationRound(
  roundLabel: string,
  intent: Intent,
  personalities: AgentPersonality[],
  providerWallet: ReturnType<typeof getClients>['providerWallet'],
  liveReps?: number[],       // raw scores from chain (e.g. 91), will be normalized to 0-1
  liveAgentIds?: string[]
): Promise<Bid | null> {
  const jobEmoji: Record<string, string> = { api: '🌐', task: '🧠', compute: '⚡' };
  const emoji = jobEmoji[intent.job_type] ?? '🤖';

  const sep = VIDEO_MODE ? '─'.repeat(40) : '─'.repeat(64);
  console.log(`\n${sep}`);
  console.log(`${emoji}  ROUND ${roundLabel} — ${intent.job_type.toUpperCase()} JOB${liveReps ? ' (live on-chain rep)' : ''}`);
  if (!VIDEO_MODE) {
    console.log(sep);
    console.log(`   Intent: ${intent.task_payload.description ?? intent.intent_id}`);
    console.log(`   Weights:     ${JSON.stringify(intent.selection_policy.weights)}`);
    console.log(`   Constraints: ${JSON.stringify(intent.selection_policy.constraints)}\n`);
  } else {
    console.log(`   ${intent.task_payload.description ?? intent.intent_id}\n`);
  }

  // ── Provider agents bid ──────────────────────────────────────────────────
  const providerAddr = providerWallet.account!.address;
  const bids: Bid[] = [];

  for (let i = 0; i < personalities.length; i++) {
    const agentIdForBid = liveAgentIds?.[i] ?? `agent-${i}`;
    const raw = await generateBid(intent, providerAddr, personalities[i], agentIdForBid);

    // Inject live on-chain reputation (from ERC-8004 pull) if provided (testnet path)
    if (liveReps && typeof liveReps[i] === 'number') {
      raw.terms.reputation = Math.max(0.55, Math.min(0.98, liveReps[i] / 100));
    }

    const signed = await signBid(raw, providerWallet, DEMO_CHAIN_ID);
    bids.push(signed);

    const repVal = signed.terms.reputation ?? 0;
    const repNote = liveReps ? ` (live-rep=${repVal.toFixed(2)})` : '';
    const key = intent.job_type === 'api'
      ? `lat=${signed.terms.latency_ms}ms rep=${repVal}${repNote}`
      : intent.job_type === 'task'
      ? `conf=${signed.terms.confidence} eta=${signed.terms.eta_seconds}s`
      : `cap=${signed.terms.capacity} up=${signed.terms.uptime}`;

    console.log(`   ${personalities[i].name.padEnd(14)} price=$${signed.terms.price_usdc} ${key} stake=$${signed.staked_penalty_usdc} sig=${signed.signature?.slice(0, 14)}... ✅`);
  }

  // ── Hard constraint filter + Scoring ───────────────────────────────────
  if (VIDEO_MODE) {
    console.log('   Bids (constraints + score):');
  } else {
    console.log('\n   Step 1: Hard Constraints');
  }
  const scored = bids
    .filter(b => passesConstraints(intent, b))
    .map(b    => scoreAndExplain(intent, b, bids))
    .sort((a, b) => b.score - a.score);

  for (const bid of bids) {
    const valid = passesConstraints(intent, bid);
    const idx = bids.indexOf(bid);
    const name = personalities[idx]?.name ?? bid.bid_id;
    const sc = scored.find(s => s.bid === bid);
    const scoreStr = sc ? ` score=${sc.score.toFixed(3)}` : '';
    const mark = valid ? '✓' : '✗';
    console.log(`     ${mark} ${name.padEnd(14)}${scoreStr}`);
  }

  if (!VIDEO_MODE) {
    console.log('\n   Step 2: Scoring (valid bids)');
    scored.forEach((s, rank) => {
      const idx  = bids.indexOf(s.bid);
      const name = personalities[idx]?.name ?? s.bid.bid_id;
      console.log(`     ${rank + 1}. ${name.padEnd(14)} score=${s.score.toFixed(4)}`);
    });
  }

  // Show explicit why for the top bid (price, latency/rep contribution etc)
  if (scored.length > 0) {
    const top = scored[0];
    const n = top.normalized;
    console.log(`   Why: price=${(n.price ?? 0).toFixed(2)} latency=${(n.latency ?? n.eta ?? 0).toFixed(2)} rep=${(top.bid.terms.reputation ?? 0).toFixed(2)}`);
  }

  // ── Winner ───────────────────────────────────────────────────────────────
  const winner = selectWinner(intent, bids);
  if (!winner) {
    console.log('\n   ✗ No bids passed constraints — no winner this round.');
    return null;
  }

  const winnerIdx  = bids.indexOf(winner);
  const winnerName = personalities[winnerIdx]?.name ?? winner.bid_id;
  const repLabel = liveReps ? 'on-chain rep' : 'rep';
  const repInfo = winner.terms.reputation !== undefined ? ` | ${repLabel} ${winner.terms.reputation.toFixed(2)}` : '';
  console.log(`\n   🏆 WINNER: ${winnerName} — $${winner.terms.price_usdc} USDC${repInfo}`);
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

  // Simulate provider execution + build realistic proof (use verifier agent)
  const promisedLatency = winner.terms.latency_ms ?? winner.terms.eta_seconds ?? 500;
  const observedLatency = Math.floor(promisedLatency * 0.82); // "better than promised" for happy path

  // Build job-appropriate response data for hash verification
  let responseData: any = { ok: true, observedAt: Date.now() };
  if (intent.job_type === 'api') {
    responseData = { price: 3412.5, symbol: 'ETHUSDC', source: 'binance', latency: observedLatency };
  } else if (intent.job_type === 'task') {
    responseData = { summary: 'DeFi paper summary...', classification: 'defi', confidence: winner.terms.confidence ?? 0.9 };
  } else {
    responseData = { model: 'llama-3-7b', tokens: 2048, routedTo: 'gpu-node' };
  }

  const proof = buildDemoProof(winner.bid_id, intent.intent_id, observedLatency, responseData);
  const vResult = await verifyWork(proof, intent);

  console.log(`   Verifier: ${vResult.verdict} — ${vResult.reason}`);
  console.log(`   Observed latency: ${observedLatency}ms (promised ~${Math.round(promisedLatency)})`);

  const proofHash = proof.response_hash as `0x${string}`;
  const slaSuccess = vResult.verified;

  await chain.attest(contracts, escrowId, slaSuccess, proofHash, USE_TESTNET);

  if (slaSuccess) {
    await chain.release(contracts, escrowId, USE_TESTNET);
    console.log(`   ✅ Escrow released to provider (SLA met).`);
  } else {
    await chain.slash(contracts, escrowId, USE_TESTNET);
    console.log(`   ⛔ Escrow slashed (SLA breach per verifier).`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const videoTag = VIDEO_MODE ? '  🎥 VIDEO MODE' : '';
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log(`║          RAGENT — FULL MULTI-JOB END-TO-END DEMO${videoTag}          ║`);
  console.log('║    Negotiation Layer for the Agentic Economy on Arc       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  if (VIDEO_MODE) {
    console.log('   (Clean output enabled — final structured JSON at end)\n');
  }

  if (USE_TESTNET && PRIVATE_KEY) chain.configureTestnet(PRIVATE_KEY);

  const { providerWallet } = getClients(USE_TESTNET);

  // ── Testnet: register agents + seed reputation + pull live values (high-prio ERC-8004 demo) ──
  let apiLiveReps: number[] | undefined;
  let apiLiveAgentIds: string[] | undefined;

  if (USE_TESTNET) {
    console.log('\n🌐  TESTNET: Registering provider agents on ERC-8004 + seeding live reputation...');
    const apiPers = getMockPersonalities();
    apiLiveReps = [];
    apiLiveAgentIds = [];
    // Seed deliberately varied scores so reputation visibly influences selection vs pure mock
    const seedScores = [65, 93, 78];

    for (let i = 0; i < apiPers.length; i++) {
      const meta = `https://ragent-demo.example/agent/${apiPers[i].name.toLowerCase()}`;
      const reg = await chain.registerAgent(meta, true);
      const agentId = reg.agentId;
      await chain.giveFeedback(agentId, seedScores[i], 'seeded_for_demo', true);
      const pulled = await chain.getRecentReputation(agentId, true);
      apiLiveReps.push(pulled);
      apiLiveAgentIds.push(agentId.toString());
      console.log(`    ${apiPers[i].name}: agentId=${agentId} seeded=${seedScores[i]} pulled=${pulled} (from ERC-8004 logs)`);
    }
    console.log('    → Using these live-pulled reputation values in bids for scoring.\n');
  }

  // ── ROUND 1: API job ──────────────────────────────────────────────────────
  const apiIntent = await generateDynamicIntent(
    'Fetch the current USDC/ETH price from Binance API with low latency and high reliability',
    { endpoint: 'https://api.binance.com/api/v3/ticker/price', symbol: 'ETHUSDC' }
  );
  const apiWinner = await runNegotiationRound('1/3', apiIntent, getMockPersonalities(), providerWallet, apiLiveReps, apiLiveAgentIds);

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
  const onchainSep = VIDEO_MODE ? '─'.repeat(40) : '─'.repeat(64);
  console.log(`\n${onchainSep}`);
  console.log(`⛓️  ON-CHAIN SETTLEMENT — ${chainLabel}`);
  if (!VIDEO_MODE) console.log(onchainSep);

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

  // ── Structured summary (especially useful in VIDEO_MODE) ─────────────────
  const videoSummary = {
    timestamp: new Date().toISOString(),
    mode: USE_TESTNET ? 'testnet' : 'local',
    video: VIDEO_MODE,
    rounds: [
      {
        job_type: 'api',
        winner: apiWinner ? {
          price_usdc: apiWinner.terms.price_usdc,
          reputation: apiWinner.terms.reputation,
          provider: apiWinner.provider_address,
          agent_id: apiWinner.agent_id,
        } : null,
      },
      {
        job_type: 'task',
        winner: taskWinner ? {
          price_usdc: taskWinner.terms.price_usdc,
          reputation: taskWinner.terms.reputation,
          provider: taskWinner.provider_address,
        } : null,
      },
      {
        job_type: 'compute',
        winner: computeWinner ? {
          price_usdc: computeWinner.terms.price_usdc,
          reputation: computeWinner.terms.reputation,
          provider: computeWinner.provider_address,
        } : null,
      },
    ],
    note: 'EIP-712 signed bids • hard constraints • job-specific scoring • verifier + on-chain escrow/attest/release',
  };

  if (VIDEO_MODE) {
    console.log('=== RAGENT_VIDEO_SUMMARY ===');
    console.log(JSON.stringify(videoSummary, null, 2));
    console.log('=== END_VIDEO_SUMMARY ===\n');
  } else if (!VIDEO_MODE) {
    // In normal mode still print a one-liner machine friendly line at the very end
    console.log('SUMMARY_JSON:', JSON.stringify(videoSummary));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

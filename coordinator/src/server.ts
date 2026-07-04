/**
 * Ragent Coordinator — Full Implementation
 * Negotiation rails + discovery + on-chain settlement.
 *
 * Hybrid discovery: REST + (future) onchain events.
 *
 * Endpoints:
 *   GET  /              — health / status
 *   GET  /health        — detailed status (contracts, mode)
 *   POST /intent        — register a new intent (requester agent)
 *   GET  /open-intents  — list open intents (provider discovery)
 *   POST /bid           — submit a bid (provider agent; EIP-712 signed)
 *   POST /select        — run selection algo + create on-chain escrow
 *   POST /verify        — run verifier agent check on a proof (standalone)
 *   POST /submit-proof  — verify + attest outcome + release/slash + ERC-8004
 *
 * Run: cd coordinator && npm run dev
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  Intent,
  Bid,
  ProofSubmission,
  isValidIntent,
  isValidBid,
  isValidProof,
} from './schemas.js';
import { selectWinner } from './algo.js';
import {
  deployContracts,
  createEscrow,
  attest,
  release,
  slash,
  giveFeedback,
  configureTestnet,
  type DeployedContracts,
} from './chain.js';
import { verifyBidSignature } from './eip712.js';
import { verifyWork } from './agents/verifier-agent.js';
import type { Hex, Address } from 'viem';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const USE_TESTNET = process.env.USE_TESTNET === 'true';
const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
const PORT = Number(process.env.PORT ?? 8787);

// Chain IDs: 31337 = anvil local, 123456 = Arc testnet placeholder
const CHAIN_ID = USE_TESTNET ? 123456 : 31337;

// Require signatures in production; accept unsigned bids in local demo mode
// Default ON — disable only explicitly (e.g. STRICT_SIGNATURES=false for local script testing)
const STRICT_SIGNATURES = process.env.STRICT_SIGNATURES !== 'false';

if (USE_TESTNET && PRIVATE_KEY) {
  configureTestnet(PRIVATE_KEY);
}

// ---------------------------------------------------------------------------
// In-memory state (sufficient for hackathon demo)
// ---------------------------------------------------------------------------

const intents      = new Map<string, Intent>();
const bidsByIntent = new Map<string, Bid[]>();
const winners      = new Map<string, Bid>();           // intent_id → winning bid

/** bid_id → escrow tx hash (returned by createEscrow) */
const activeEscrows = new Map<string, Hex>();

/** Lazy-deployed contracts (set on first /select call) */
let deployedContracts: DeployedContracts | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getContracts(): Promise<DeployedContracts> {
  if (!deployedContracts) {
    console.log('[Coordinator] Deploying contracts (lazy init)...');
    deployedContracts = await deployContracts(USE_TESTNET);
    console.log('[Coordinator] Contracts ready:', deployedContracts);
  }
  return deployedContracts;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();

// ---------------------------------------------------------------------------
// Security headers middleware (CSP, clickjacking, sniff protection)
// ---------------------------------------------------------------------------
app.use('*', async (c, next) => {
  await next();
  // Content-Security-Policy: only allow self-hosted assets + Google Fonts
  c.res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self'",
      "img-src 'self' data:",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

app.use('*', cors({ origin: 'http://localhost:8787', allowMethods: ['GET', 'POST'] }));

// ---------------------------------------------------------------------------
// Serve static files from public/ (the dashboard)
// ---------------------------------------------------------------------------
app.use('/public/*', serveStatic({ root: './' }));

// ---------------------------------------------------------------------------
// GET /  — Redirect to dashboard
// ---------------------------------------------------------------------------
app.get('/', (c) => c.redirect('/public/index.html', 302));

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get('/health', (c) =>
  c.json({
    ok:                true,
    mode:              USE_TESTNET ? 'testnet' : 'local',
    chain_id:          CHAIN_ID,
    strict_signatures: STRICT_SIGNATURES,
    contracts:         deployedContracts ?? 'not yet deployed (lazy — happens on first /select)',
    intents_open:      intents.size,
    active_escrows:    activeEscrows.size,
  })
);

// ---------------------------------------------------------------------------
// GET /demo/run?job_type=api|task|compute
// Runs a complete mock negotiation round in-process and returns full results.
// Used by the dashboard UI — no chain interaction (pure negotiation demo).
// ---------------------------------------------------------------------------
app.get('/demo/run', async (c) => {
  const jobType = c.req.query('job_type') ?? 'api';
  if (!['api', 'task', 'compute'].includes(jobType)) {
    return c.json({ error: 'job_type must be api, task, or compute' }, 400);
  }

  // Inline mock data so the endpoint has no side-effects on server state
  const { generateDynamicIntent, generateTaskIntent, generateComputeIntent,
          generateBid, getMockPersonalities, getTaskPersonalities, getComputePersonalities
        } = await import('./agents/llm-agent.js');
  const { selectWinner, passesConstraints, scoreAndExplain } = await import('./algo.js');

  const intentFns: Record<string, () => Promise<any>> = {
    api:     () => generateDynamicIntent('Fetch USDC/ETH price from Binance API', { symbol: 'ETHUSDC' }),
    task:    () => generateTaskIntent('Summarize a 10-page DeFi research paper into structured JSON', ['nlp','summarize','classify']),
    compute: () => generateComputeIntent('Route a 7B LLM inference workload to a GPU provider', { model: 'llama-3-7b' }),
  };

  const personalityFns: Record<string, () => any[]> = {
    api:     getMockPersonalities,
    task:    getTaskPersonalities,
    compute: getComputePersonalities,
  };

  const intent = await intentFns[jobType]();
  const personalities = personalityFns[jobType]();

  // Generate bids (no signing in demo mode — STRICT_SIGNATURES skipped for UI demo)
  const dummyAddr = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const bids = await Promise.all(
    personalities.map((p: any, i: number) => generateBid(intent, dummyAddr, p, String(i)))
  );

  // Evaluate each bid
  const results = bids.map((bid: any, i: number) => {
    const passes = passesConstraints(intent, bid);
    const scored = passes ? scoreAndExplain(intent, bid, bids) : null;
    return {
      name:         personalities[i].name,
      style:        personalities[i].style,
      bid,
      passes_constraints: passes,
      score:        scored?.score ?? null,
      breakdown:    scored?.normalized ?? null,
    };
  });

  const winner = selectWinner(intent, bids);
  const winnerIdx = winner ? bids.indexOf(winner) : -1;

  return c.json({
    job_type:   jobType,
    intent,
    providers:  results,
    winner:     winner ? { ...winner, name: personalities[winnerIdx]?.name } : null,
    winner_idx: winnerIdx,
  });
});

// ---------------------------------------------------------------------------
// POST /intent
// ---------------------------------------------------------------------------
app.post('/intent', async (c) => {
  const body = await c.req.json();
  if (!isValidIntent(body)) {
    return c.json({ error: 'Invalid Intent schema' }, 400);
  }
  intents.set(body.intent_id, body);
  bidsByIntent.set(body.intent_id, []);
  console.log('[Coordinator] New Intent:', body.intent_id, body.job_type);
  return c.json({ ok: true, intent_id: body.intent_id });
});

// ---------------------------------------------------------------------------
// GET /open-intents
// ---------------------------------------------------------------------------
app.get('/open-intents', (c) => {
  const jobType = c.req.query('job_type');
  let list = Array.from(intents.values());
  if (jobType) list = list.filter((i) => i.job_type === jobType);
  return c.json({ intents: list });
});

// ---------------------------------------------------------------------------
// POST /bid
// ---------------------------------------------------------------------------
app.post('/bid', async (c) => {
  const body = await c.req.json();
  if (!isValidBid(body)) return c.json({ error: 'Invalid Bid schema' }, 400);

  const intent = intents.get(body.intent_id);
  if (!intent) return c.json({ error: 'Unknown intent_id' }, 404);

  // ── EIP-712 Signature Verification ──────────────────────────────────────
  let signatureStatus: 'verified' | 'unsigned' | 'invalid';

  if (body.signature) {
    const valid = await verifyBidSignature(body, CHAIN_ID);
    if (!valid) {
      // Signature present but wrong — always reject
      return c.json(
        { error: 'Invalid EIP-712 signature — signer does not match provider_address' },
        403
      );
    }
    signatureStatus = 'verified';
  } else {
    if (STRICT_SIGNATURES) {
      return c.json(
        {
          error:
            'Bid must include a valid EIP-712 signature (STRICT_SIGNATURES mode). ' +
            'See eip712.ts buildBidTypedData() to sign.',
        },
        403
      );
    }
    // Soft mode: accept unsigned bids with a warning (demo/local compatible)
    signatureStatus = 'unsigned';
    console.warn(
      `[Coordinator] ⚠ Unsigned bid ${body.bid_id} accepted (demo mode — set STRICT_SIGNATURES=true for production)`
    );
  }

  const list = bidsByIntent.get(body.intent_id) || [];
  list.push(body);
  bidsByIntent.set(body.intent_id, list);

  console.log('[Coordinator] Bid received:', body.bid_id, 'for', body.intent_id, `[${signatureStatus}]`);
  return c.json({ ok: true, bid_id: body.bid_id, signature_status: signatureStatus });
});

// ---------------------------------------------------------------------------
// POST /select
// ---------------------------------------------------------------------------
app.post('/select', async (c) => {
  const { intent_id } = await c.req.json();
  const intent = intents.get(intent_id);
  if (!intent) return c.json({ error: 'Intent not found' }, 404);

  const bids = bidsByIntent.get(intent_id) || [];
  if (bids.length === 0) return c.json({ error: 'No bids submitted for this intent' }, 400);

  // ── Algorithm selection ──────────────────────────────────────────────────
  const winner = selectWinner(intent, bids);
  if (!winner) {
    return c.json({ winner: null, message: 'No valid bids passed hard constraints' });
  }

  winners.set(intent_id, winner);
  console.log('[Coordinator] Winner selected:', winner.bid_id, winner.provider_address);

  // ── On-chain: createEscrow ───────────────────────────────────────────────
  let escrowTx: Hex | null = null;
  let chainError: string | null = null;

  try {
    const contracts = await getContracts();

    const intentIdHex = ('0x' + Buffer.from(intent_id).toString('hex').padEnd(64, '0').slice(0, 64)) as Hex;
    const priceUsdc         = BigInt(Math.round(winner.terms.price_usdc * 1_000_000));
    const stakedPenaltyUsdc = BigInt(Math.round(winner.staked_penalty_usdc * 1_000_000));

    escrowTx = await createEscrow(
      contracts,
      intentIdHex,
      winner.provider_address as Address,
      priceUsdc,
      stakedPenaltyUsdc,
      USE_TESTNET
    );

    activeEscrows.set(winner.bid_id, escrowTx);
    console.log('[Coordinator] Escrow created. Tx:', escrowTx);
  } catch (err: any) {
    chainError = err?.message ?? String(err);
    console.error('[Coordinator] createEscrow failed:', chainError);
  }

  return c.json({
    winner,
    escrow_tx:    escrowTx,
    chain_error:  chainError,
    explorer_url: escrowTx && USE_TESTNET
      ? `https://testnet.arcscan.app/tx/${escrowTx}`
      : escrowTx
        ? `http://localhost:8545 (anvil local)`
        : null,
  });
});

// ---------------------------------------------------------------------------
// POST /verify  (standalone verifier agent endpoint)
// ---------------------------------------------------------------------------
app.post('/verify', async (c) => {
  const body = await c.req.json();
  if (!body?.bid_id || typeof body?.observed_latency_ms !== 'number' || !body?.response_hash || !body?.timestamp) {
    return c.json({ error: 'Invalid proof payload — need bid_id, observed_latency_ms, response_hash, timestamp' }, 400);
  }

  const intentId = body.intent_id;
  const intent   = intentId ? intents.get(intentId) : undefined;

  if (!intent) {
    return c.json({ error: 'intent_id not found — verifier needs the original intent for SLA checks' }, 404);
  }

  const result = await verifyWork(body, intent);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// POST /submit-proof
// ---------------------------------------------------------------------------
app.post('/submit-proof', async (c) => {
  const body = await c.req.json() as ProofSubmission & { intent_id?: string };
  if (!isValidProof(body)) return c.json({ error: 'Invalid proof schema' }, 400);

  const escrowTx = activeEscrows.get(body.bid_id);
  if (!escrowTx) {
    return c.json(
      { error: 'No active escrow found for bid_id. Run /select first.' },
      404
    );
  }

  // ── Verifier Agent: independent check before attesting on-chain ──────────
  const intentId = body.intent_id;
  const intent   = intentId ? intents.get(intentId) : undefined;

  let slaSuccess = true;
  let verifierResult;

  if (intent) {
    verifierResult = await verifyWork(body as any, intent);
    slaSuccess = verifierResult.verified;
    console.log(
      `[Coordinator] Verifier says: ${verifierResult.verdict} — ${verifierResult.reason}`
    );
  } else {
    // No intent found (e.g. intent_id missing) — fall back to latency check only
    const maxLatencyMs = undefined;
    slaSuccess = maxLatencyMs !== undefined ? body.observed_latency_ms <= maxLatencyMs : true;
    console.log(`[Coordinator] No intent found for verification — latency-only fallback, sla_success=${slaSuccess}`);
  }

  const proofHash = (body.response_hash.startsWith('0x')
    ? body.response_hash
    : '0x' + Buffer.from(body.response_hash).toString('hex').padStart(64, '0').slice(0, 64)
  ) as Hex;

  console.log(
    `[Coordinator] Proof for ${body.bid_id}: latency=${body.observed_latency_ms}ms, sla_success=${slaSuccess}`
  );

  let attestTx: Hex | null     = null;
  let settleTx: Hex | null     = null;
  let repTx:    Hex | null     = null;
  let chainError: string | null = null;

  try {
    const contracts = await getContracts();

    // escrowId = the intentIdHex we used in createEscrow (re-derive from bid)
    const winnerBid  = [...bidsByIntent.values()].flat().find((b) => b.bid_id === body.bid_id);
    const winnerIntentId = winnerBid?.intent_id ?? intentId ?? '';
    const escrowId   = ('0x' + Buffer.from(winnerIntentId).toString('hex').padEnd(64, '0').slice(0, 64)) as Hex;

    // 1. Attest
    attestTx = await attest(contracts, escrowId, slaSuccess, proofHash, USE_TESTNET);

    // 2. Release (success) or Slash (failure)
    if (slaSuccess) {
      settleTx = await release(contracts, escrowId, USE_TESTNET);
      console.log('[Coordinator] Escrow released to provider.');
    } else {
      settleTx = await slash(contracts, escrowId, USE_TESTNET);
      console.log('[Coordinator] Escrow slashed (SLA breach).');
    }

    // 3. ERC-8004 reputation update (if bid has agent_id, testnet only)
    if (USE_TESTNET && winnerBid?.agent_id) {
      const agentId = BigInt(winnerBid.agent_id);
      const score   = slaSuccess ? 90 : -30;
      const tag     = slaSuccess ? 'sla_met' : 'sla_breach';
      repTx = await giveFeedback(agentId, score, tag, true);
      console.log(`[Coordinator] ERC-8004 feedback recorded for agent ${agentId}.`);
    }

    // Remove from active escrows after settlement
    activeEscrows.delete(body.bid_id);
  } catch (err: any) {
    chainError = err?.message ?? String(err);
    console.error('[Coordinator] submit-proof chain error:', chainError);
  }

  return c.json({
    ok:          !chainError,
    sla_success: slaSuccess,
    attest_tx:   attestTx,
    settle_tx:   settleTx,
    rep_tx:      repTx,
    chain_error: chainError,
    explorer_url: settleTx && USE_TESTNET
      ? `https://testnet.arcscan.app/tx/${settleTx}`
      : null,
  });
});

// ---------------------------------------------------------------------------
// Export for testing / Bun
// ---------------------------------------------------------------------------
export default app;

// ---------------------------------------------------------------------------
// Start server (tsx / Node)
// ---------------------------------------------------------------------------
const mode = USE_TESTNET ? '🌐 Arc Testnet' : '🔧 Local Anvil';
console.log(`\n🚀 Ragent Coordinator — ${mode}`);
console.log(`   Listening on http://localhost:${PORT}`);
console.log(`   STRICT_SIGNATURES=${STRICT_SIGNATURES}`);
console.log(`   Contracts deploy lazily on first /select\n`);

serve({ fetch: app.fetch, port: PORT });

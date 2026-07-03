/**
 * Ragent Coordinator (minimal stub)
 * Exposes the negotiation rails + discovery.
 *
 * Hybrid discovery: REST + (future) onchain events.
 *
 * Endpoints for the demo:
 *   POST /intent
 *   GET  /open-intents
 *   POST /bid
 *   POST /select
 *   POST /submit-proof
 *
 * Run: cd coordinator && npm run dev
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Intent, Bid, ProofSubmission, isValidIntent, isValidBid, isValidProof } from './schemas';
import { selectWinner, passesConstraints } from './algo';

const app = new Hono();
app.use('*', cors());

const intents = new Map<string, Intent>();
const bidsByIntent = new Map<string, Bid[]>();

app.get('/', (c) => c.json({ status: 'Ragent Coordinator running', hint: 'See PLAN.md for full architecture' }));

// Post an Intent (requester agent)
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

// Discovery: list open intents
app.get('/open-intents', (c) => {
  const jobType = c.req.query('job_type');
  let list = Array.from(intents.values());
  if (jobType) list = list.filter(i => i.job_type === jobType);
  return c.json({ intents: list });
});

// Post a Bid (provider agent)
app.post('/bid', async (c) => {
  const body = await c.req.json();
  if (!isValidBid(body)) return c.json({ error: 'Invalid Bid' }, 400);

  const intent = intents.get(body.intent_id);
  if (!intent) return c.json({ error: 'Unknown intent' }, 404);

  const list = bidsByIntent.get(body.intent_id) || [];
  list.push(body);
  bidsByIntent.set(body.intent_id, list);

  console.log('[Coordinator] Bid received:', body.bid_id, 'for', body.intent_id);
  return c.json({ ok: true, bid_id: body.bid_id });
});

// Run selection (coordinator applies the algo from inital_algo)
app.post('/select', async (c) => {
  const { intent_id } = await c.req.json();
  const intent = intents.get(intent_id);
  if (!intent) return c.json({ error: 'Intent not found' }, 404);

  const bids = bidsByIntent.get(intent_id) || [];
  const winner = selectWinner(intent, bids);

  if (!winner) {
    return c.json({ winner: null, message: 'No valid bids after constraints' });
  }

  console.log('[Coordinator] Winner selected:', winner.bid_id);
  return c.json({ winner });
});

// Submit proof for attestation (key for "Work executes")
app.post('/submit-proof', async (c) => {
  const body = await c.req.json();
  if (!isValidProof(body)) return c.json({ error: 'Invalid proof' }, 400);

  // In real version: verify sig, call chain attest, record ERC-8004 feedback
  console.log('[Coordinator] Proof received for', body.bid_id, 'latency:', body.observed_latency_ms);

  // Placeholder response
  return c.json({
    ok: true,
    attested: true,
    note: 'In full version this would trigger onchain release/slash + ERC-8004 reputation update',
  });
});

export default app;

// For direct run with tsx
if (import.meta.main) {
  const port = 8787;
  console.log(`Ragent Coordinator listening on http://localhost:${port}`);
  // @ts-expect-error - Bun is optional runtime (tsx or bun)
  Bun.serve ? Bun.serve({ fetch: app.fetch, port }) : console.log('Use: npx tsx src/server.ts or integrate with Hono adapter');
}

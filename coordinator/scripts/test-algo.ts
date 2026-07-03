/**
 * Standalone test for the core Ragent algorithm.
 * Run with: cd coordinator && npm install && npm run test-algo
 *
 * Demonstrates: hard constraints, scoring, winner selection for API job (MVP).
 * Directly implements logic from inital_algo.
 */

import { Intent, Bid, selectWinner, scoreAndExplain, passesConstraints } from '../src/algo';

console.log('=== Ragent Algorithm Standalone Test (API job focus) ===\n');

// Sample Intent (from System_Prompt style + dynamic policy for agentic)
const intent: Intent = {
  intent_id: 'intent-001',
  job_type: 'api',
  task_payload: {
    description: 'Fetch live USDC/ETH price from Binance API',
    endpoint: 'https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDC',
  },
  selection_policy: {
    weights: {
      access: 0.30,
      reliability: 0.25,
      latency: 0.25,
      uptime: 0.10,
      price: 0.10,
    },
    constraints: {
      required_api: 'binance-price',
      max_latency_ms: 800,
      min_reputation: 0.6,
      max_price_usdc: 0.05,
    },
  },
};

// Sample bids (multiple providers, simulating discovery)
const bids: Bid[] = [
  {
    bid_id: 'bid-a',
    intent_id: 'intent-001',
    provider_address: '0xProviderA',
    agent_id: '42', // ERC-8004 example
    terms: {
      price_usdc: 0.03,
      latency_ms: 650,
      api_access: ['binance-price', 'coingecko'],
      reputation: 0.85,
      uptime: 0.99,
    },
    staked_penalty_usdc: 0.5,
  },
  {
    bid_id: 'bid-b',
    intent_id: 'intent-001',
    provider_address: '0xProviderB',
    agent_id: '43',
    terms: {
      price_usdc: 0.02,
      latency_ms: 1200, // will fail constraint
      api_access: ['binance-price'],
      reputation: 0.7,
      uptime: 0.95,
    },
    staked_penalty_usdc: 0.3,
  },
  {
    bid_id: 'bid-c',
    intent_id: 'intent-001',
    provider_address: '0xProviderC',
    agent_id: '44',
    terms: {
      price_usdc: 0.04,
      latency_ms: 480,
      api_access: ['binance-price'],
      reputation: 0.92,
      uptime: 0.999,
    },
    staked_penalty_usdc: 0.75,
  },
];

console.log('Intent:', JSON.stringify(intent, null, 2));
console.log('\nAll Bids:');
bids.forEach(b => console.log(`  ${b.bid_id}: price=${b.terms.price_usdc} latency=${b.terms.latency_ms}ms rep=${b.terms.reputation}`));

console.log('\n--- Hard Constraint Filtering ---');
const valid = bids.filter(b => {
  const ok = passesConstraints(intent, b);
  console.log(`  ${b.bid_id}: ${ok ? 'VALID' : 'REJECTED (hard constraint)'}`);
  return ok;
});

console.log('\n--- Scoring (API job) ---');
const scored = valid.map(b => scoreAndExplain(intent, b, bids));
scored.forEach(s => {
  console.log(`  ${s.bid.bid_id}: score=${s.score.toFixed(4)} (normPrice=${s.normalized.price.toFixed(2)}, normLatencyInv=${s.normalized.latency.toFixed(2)})`);
});

console.log('\n--- Winner Selection ---');
const winner = selectWinner(intent, bids);
if (winner) {
  console.log('WINNER:', winner.bid_id);
  console.log('  Provider:', winner.provider_address);
  console.log('  Price:', winner.terms.price_usdc, 'USDC');
  console.log('  Latency promise:', winner.terms.latency_ms, 'ms');
  console.log('  Staked penalty:', winner.staked_penalty_usdc, 'USDC');
} else {
  console.log('No valid bids');
}

console.log('\n=== Test complete. This logic will drive the coordinator. ===');

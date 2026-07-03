/**
 * Test: Agentic agents + Algo together
 * Shows LLM (or mock) agents generating dynamic Intents + Bids,
 * then the core Ragent algorithm selects the winner.
 *
 * This directly addresses one of the "standing out" items: agentic sophistication.
 *
 * Run: cd coordinator && npm run test-algo   (or npx tsx scripts/test-agents.ts)
 */

import { generateDynamicIntent, generateBid, getMockPersonalities } from '../src/agents/llm-agent';
import { selectWinner, passesConstraints } from '../src/algo';
import { Intent } from '../src/schemas';

async function main() {
  console.log('=== Ragent Agentic Demo: LLM Agents + Selection ===\n');

  const task = 'Fetch the live USDC price for ETH from a reliable API endpoint with low latency';

  console.log('Task description:', task);

  // 1. Requester agent (AI decides the policy dynamically)
  const intent: Intent = await generateDynamicIntent(task);
  console.log('\nGenerated Intent (dynamic policy from AI):');
  console.log(JSON.stringify(intent.selection_policy, null, 2));

  // 2. Provider agents discover + bid (AI decides their offer)
  const personalities = getMockPersonalities();
  const providerAddrs = ['0xA1', '0xB2', '0xC3'];

  const bids = [];
  for (let i = 0; i < personalities.length; i++) {
    const bid = await generateBid(intent, providerAddrs[i], personalities[i], String(100 + i));
    bids.push(bid);
    console.log(`\n${personalities[i].name} bid: price=${bid.terms.price_usdc} latency=${bid.terms.latency_ms}ms stake=${bid.staked_penalty_usdc}`);
  }

  // 3. Coordinator runs the algorithm (from inital_algo)
  console.log('\n--- Running Ragent Selection (hard constraints + scoring) ---');

  const validCount = bids.filter(b => passesConstraints(intent, b)).length;
  console.log(`Valid bids after constraints: ${validCount}/${bids.length}`);

  const winner = selectWinner(intent, bids);
  if (winner) {
    console.log('\n*** WINNER SELECTED ***');
    console.log(`Provider: ${winner.provider_address} (agent ${winner.agent_id})`);
    console.log(`Terms: $${winner.terms.price_usdc} | ${winner.terms.latency_ms}ms | stake $${winner.staked_penalty_usdc}`);
  } else {
    console.log('No winner');
  }

  console.log('\nThis flow (AI intent policy + AI bids + algo select) will be the heart of the coordinator demo.');
}

main().catch(console.error);

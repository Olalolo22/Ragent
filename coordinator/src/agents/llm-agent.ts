/**
 * LLM-powered Agent Helpers for Ragent (addresses "agentic sophistication")
 *
 * - generateDynamicIntent: LLM (or mock) creates Intent with *dynamic* selection_policy
 *   based on task description. This is key for "requesters define policy" + AI decides.
 *
 * - generateBid: Provider agent produces competitive bid + terms.
 *
 * Uses OpenAI if OPENAI_API_KEY present, otherwise deterministic mocks.
 * This makes the demo show real AI decision-making.
 */

import OpenAI from 'openai';
import { Intent, Bid } from '../schemas';

const OPENAI_KEY = process.env.OPENAI_API_KEY;

let openai: OpenAI | null = null;
if (OPENAI_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_KEY });
}

export interface AgentPersonality {
  name: string;
  style: string; // e.g. "fast-and-cheap", "reliable-premium"
}

const MOCK_PERSONALITIES: AgentPersonality[] = [
  { name: 'FastLane', style: 'fast-and-cheap' },
  { name: 'ReliableCore', style: 'reliable-premium' },
  { name: 'BalancedNode', style: 'balanced' },
];

/**
 * Generate a dynamic Intent.
 * The LLM decides weights based on the task (agentic!).
 */
export async function generateDynamicIntent(
  taskDescription: string,
  basePayload: Record<string, any> = {}
): Promise<Intent> {
  const intentId = 'intent-' + Date.now();

  if (!openai) {
    // Mock: simple rule-based dynamic policy for demo reliability
    const isLatencyCritical = /price|live|real-time|fast|urgent/i.test(taskDescription);
    return {
      intent_id: intentId,
      job_type: 'api',
      task_payload: { description: taskDescription, ...basePayload },
      selection_policy: {
        weights: isLatencyCritical
          ? { access: 0.2, reliability: 0.15, latency: 0.45, uptime: 0.1, price: 0.1 }
          : { access: 0.3, reliability: 0.3, latency: 0.15, uptime: 0.15, price: 0.1 },
        constraints: {
          required_api: 'binance-price',
          max_latency_ms: isLatencyCritical ? 600 : 1200,
          min_reputation: 0.65,
          max_price_usdc: 0.05,
        },
      },
    };
  }

  // Real LLM path (agentic decision)
  const prompt = `You are an autonomous AI agent creating a Service Level Agreement (SLA) Intent for an API job on the Ragent protocol.

Task: ${taskDescription}

Return ONLY a compact JSON object with this exact shape (no extra text):
{
  "weights": { "access": 0.XX, "reliability": 0.XX, "latency": 0.XX, "uptime": 0.XX, "price": 0.XX },
  "constraints": {
    "required_api": "binance-price",
    "max_latency_ms": NNN,
    "min_reputation": 0.NN,
    "max_price_usdc": 0.0N
  }
}

Rules:
- Sum of weights = 1.0
- If the task is time-sensitive or live data, weight latency higher (0.35-0.5).
- Otherwise balance reliability + access.
- Keep constraints realistic for a $0.01-0.05 micropayment job.
`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 300,
    });

    const text = completion.choices[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    return {
      intent_id: intentId,
      job_type: 'api',
      task_payload: { description: taskDescription, ...basePayload },
      selection_policy: {
        weights: parsed.weights,
        constraints: parsed.constraints,
      },
    };
  } catch (e) {
    console.warn('LLM intent generation failed, falling back to mock', e);
    return generateDynamicIntent(taskDescription, basePayload); // retry with mock
  }
}

/**
 * Generate a competitive Bid from a provider agent.
 * The agent "decides" its price, latency promise, stake based on personality + intent policy.
 */
export async function generateBid(
  intent: Intent,
  providerAddress: string,
  personality: AgentPersonality,
  agentId?: string
): Promise<Bid> {
  const bidId = 'bid-' + personality.name.toLowerCase() + '-' + Date.now().toString(36);

  if (!openai) {
    // Mock bids with personality flavor
    let price = 0.03;
    let latency = 700;
    let stake = 0.4;
    let rep = 0.8;

    if (personality.style === 'fast-and-cheap') {
      price = 0.018;
      latency = 520;
      stake = 0.25;
    } else if (personality.style === 'reliable-premium') {
      price = 0.045;
      latency = 380;
      stake = 0.8;
      rep = 0.94;
    }

    return {
      bid_id: bidId,
      intent_id: intent.intent_id,
      provider_address: providerAddress,
      agent_id: agentId,
      terms: {
        price_usdc: price,
        latency_ms: latency,
        api_access: ['binance-price'],
        reputation: rep,
        uptime: 0.98,
      },
      staked_penalty_usdc: stake,
    };
  }

  // LLM bid generation (shows agent deciding its offer)
  const policySummary = JSON.stringify(intent.selection_policy);
  const prompt = `You are an autonomous provider agent named ${personality.name} (${personality.style}).
An Intent just arrived for an API job.

Intent policy: ${policySummary}

Decide your SLA Bid terms. Return ONLY JSON:
{
  "price_usdc": 0.0NN,
  "latency_ms": NNN,
  "staked_penalty_usdc": 0.NN
}

Guidelines:
- Match the personality: fast-and-cheap bids lower price + higher latency; reliable-premium bids better latency + higher stake.
- Never exceed the intent's max_price_usdc or max_latency_ms if visible.
- Stake should be 5-20x the price.
`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 150,
    });

    const text = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    return {
      bid_id: bidId,
      intent_id: intent.intent_id,
      provider_address: providerAddress,
      agent_id: agentId,
      terms: {
        price_usdc: parsed.price_usdc,
        latency_ms: parsed.latency_ms,
        api_access: ['binance-price'],
        reputation: 0.82 + Math.random() * 0.12,
        uptime: 0.97,
      },
      staked_penalty_usdc: parsed.staked_penalty_usdc,
    };
  } catch {
    // fallback mock
    return generateBid(intent, providerAddress, personality, agentId);
  }
}

export function getMockPersonalities(): AgentPersonality[] {
  return [...MOCK_PERSONALITIES];
}

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
import { Intent, Bid } from '../schemas.js';

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
  { name: 'FastLane',      style: 'fast-and-cheap'    },
  { name: 'ReliableCore', style: 'reliable-premium'   },
  { name: 'BalancedNode', style: 'balanced'            },
];

// Per-job-type personalities (used when generating bids for task/compute)
const TASK_PERSONALITIES: AgentPersonality[] = [
  { name: 'CognitiveEdge', style: 'high-confidence'   },  // strong on confidence + capability
  { name: 'BudgetBrain',   style: 'low-cost-task'     },  // cheap but mediocre confidence
  { name: 'SpecialistAI',  style: 'specialist'        },  // niche capability, premium price
];

const COMPUTE_PERSONALITIES: AgentPersonality[] = [
  { name: 'MegaNode',    style: 'high-capacity'       },  // massive capacity, higher price
  { name: 'StableRack',  style: 'reliable-uptime'     },  // high uptime, moderate capacity
  { name: 'BurstCloud',  style: 'burst'               },  // cheap burst, lower uptime
];

/**
 * Generate a dynamic Intent.
 * The LLM decides weights based on the task (agentic!).
 */
export async function generateDynamicIntent(
  taskDescription: string,
  basePayload: Record<string, any> = {}
): Promise<Intent> {
  const intentId = 'intent-api-' + Date.now();

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
 * Generate a Task job Intent (summarize, classify, extract, transform).
 */
export async function generateTaskIntent(
  taskDescription: string,
  requiredTags: string[] = ['nlp', 'summarize'],
  basePayload: Record<string, any> = {}
): Promise<Intent> {
  const intentId = 'intent-task-' + Date.now();
  return {
    intent_id: intentId,
    job_type: 'task',
    task_payload: { description: taskDescription, ...basePayload },
    selection_policy: {
      weights: { capability: 0.35, confidence: 0.30, reputation: 0.15, price: 0.10, eta: 0.10 },
      constraints: {
        required_capability_tags: requiredTags,
        min_confidence: 0.70,
        max_eta_seconds: 120,
        max_price_usdc: 0.10,
      },
    },
  };
}

/**
 * Generate a Compute job Intent (routing, bandwidth, execution capacity).
 */
export async function generateComputeIntent(
  taskDescription: string,
  basePayload: Record<string, any> = {}
): Promise<Intent> {
  const intentId = 'intent-compute-' + Date.now();
  return {
    intent_id: intentId,
    job_type: 'compute',
    task_payload: { description: taskDescription, ...basePayload },
    selection_policy: {
      weights: { capacity: 0.30, uptime: 0.25, latency: 0.20, reputation: 0.15, price: 0.10 },
      constraints: {
        min_capacity: 0.50,
        min_uptime: 0.95,
        max_latency_ms: 800,
        max_price_usdc: 0.08,
      },
    },
  };
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
    // Mock bids with personality flavor — per job_type
    let price = 0.03;
    let latency = 700;
    let stake = 0.4;
    let rep = 0.8;
    let confidence = 0.82;
    let etaSeconds = 60;
    let capacity = 0.7;
    let uptime = 0.97;
    let capabilityTags = ['nlp', 'summarize', 'classify'];
    let apiAccess = ['binance-price'];

    if (intent.job_type === 'api') {
      if (personality.style === 'fast-and-cheap') {
        price = 0.018; latency = 520; stake = 0.25; rep = 0.74;
      } else if (personality.style === 'reliable-premium') {
        price = 0.045; latency = 380; stake = 0.8; rep = 0.94;
      } else {
        price = 0.03; latency = 650; stake = 0.4; rep = 0.82;
      }
    } else if (intent.job_type === 'task') {
      if (personality.style === 'high-confidence') {
        price = 0.07; confidence = 0.93; etaSeconds = 45; stake = 0.6; rep = 0.88;
      } else if (personality.style === 'low-cost-task') {
        price = 0.025; confidence = 0.71; etaSeconds = 100; stake = 0.2; rep = 0.70;
      } else { // specialist
        price = 0.09; confidence = 0.96; etaSeconds = 30; stake = 0.9; rep = 0.95;
        capabilityTags = ['nlp', 'summarize', 'classify', 'domain-expert'];
      }
    } else { // compute
      if (personality.style === 'high-capacity') {
        price = 0.06; capacity = 0.95; uptime = 0.99; latency = 300; stake = 0.7;
      } else if (personality.style === 'reliable-uptime') {
        price = 0.05; capacity = 0.70; uptime = 0.999; latency = 450; stake = 0.6;
      } else { // burst
        price = 0.025; capacity = 0.55; uptime = 0.95; latency = 700; stake = 0.25;
      }
    }

    return {
      bid_id: bidId,
      intent_id: intent.intent_id,
      provider_address: providerAddress,
      agent_id: agentId,
      terms: {
        price_usdc:      price,
        latency_ms:      intent.job_type !== 'task' ? latency : undefined,
        api_access:      intent.job_type === 'api'  ? apiAccess : undefined,
        reputation:      rep,
        uptime:          (intent.job_type === 'api' || intent.job_type === 'compute') ? uptime : undefined,
        confidence:      intent.job_type === 'task'    ? confidence  : undefined,
        eta_seconds:     intent.job_type === 'task'    ? etaSeconds  : undefined,
        capacity:        intent.job_type === 'compute' ? capacity     : undefined,
        capability_tags: intent.job_type === 'task'    ? capabilityTags : undefined,
      },
      staked_penalty_usdc: stake,
    };
  }

  // LLM bid generation (shows agent deciding its offer)
  const policySummary = JSON.stringify(intent.selection_policy);
  
  let jobSpecificFields = `"latency_ms": NNN,`;
  if (intent.job_type === 'task') {
    jobSpecificFields = `"eta_seconds": NNN,\n  "confidence": 0.NN,`;
  } else if (intent.job_type === 'compute') {
    jobSpecificFields = `"latency_ms": NNN,\n  "capacity": 0.NN,\n  "uptime": 0.NN,`;
  }

  const prompt = `You are an autonomous provider agent named ${personality.name} (${personality.style}).
An Intent just arrived for a ${intent.job_type} job.

Intent policy: ${policySummary}

Decide your SLA Bid terms. Return ONLY JSON:
{
  "price_usdc": 0.0NN,
  ${jobSpecificFields}
  "staked_penalty_usdc": 0.NN
}

Guidelines:
- Match the personality: fast-and-cheap bids lower price + higher latency; reliable-premium bids better SLA + higher stake.
- Never exceed the intent's max constraints if visible.
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

    const terms: any = {
      price_usdc: parsed.price_usdc,
      reputation: 0.82 + Math.random() * 0.12,
    };

    if (intent.job_type === 'api') {
      terms.latency_ms = parsed.latency_ms;
      terms.api_access = ['binance-price'];
      terms.uptime = 0.97;
    } else if (intent.job_type === 'task') {
      terms.eta_seconds = parsed.eta_seconds;
      terms.confidence = parsed.confidence;
      terms.capability_tags = ['nlp', 'summarize', 'classify', 'domain-expert'];
    } else if (intent.job_type === 'compute') {
      terms.latency_ms = parsed.latency_ms;
      terms.capacity = parsed.capacity;
      terms.uptime = parsed.uptime || 0.97;
    }

    return {
      bid_id: bidId,
      intent_id: intent.intent_id,
      provider_address: providerAddress,
      agent_id: agentId,
      terms,
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

export function getTaskPersonalities(): AgentPersonality[] {
  return [...TASK_PERSONALITIES];
}

export function getComputePersonalities(): AgentPersonality[] {
  return [...COMPUTE_PERSONALITIES];
}

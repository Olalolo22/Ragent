/**
 * Ragent Core Schemas
 * Exact match to System_Prompt + inital_algo shared fields.
 * Extended lightly for ERC-8004 (agent_id) and demo.
 * Use these for validation in coordinator and agents.
 */

export interface SelectionPolicy {
  weights: Record<string, number>;
  constraints: Record<string, any>;
}

export interface Intent {
  intent_id: string;
  job_type: 'task' | 'api' | 'compute';
  task_payload: Record<string, any>;
  selection_policy: SelectionPolicy;
}

export interface BidTerms {
  price_usdc: number;
  latency_ms?: number;
  eta_seconds?: number;
  confidence?: number;
  reputation?: number;
  capability_tags?: string[];
  api_access?: string[];
  capacity?: number;
  uptime?: number;
  proofs?: any;
}

export interface Bid {
  bid_id: string;
  intent_id: string;
  provider_address: string;
  agent_id?: string;           // ERC-8004 identity token ID
  terms: BidTerms;
  staked_penalty_usdc: number;
  signature?: string;          // EIP-712 or simple for demo
}

export interface ProofSubmission {
  bid_id: string;
  observed_latency_ms: number;
  response_hash: string;       // keccak or content hash of result
  timestamp: number;
  signature?: string;          // signed by provider
  metadata?: Record<string, any>;
}

// Simple runtime validator (no zod dep for minimal footprint; can swap later)
export function isValidIntent(obj: any): obj is Intent {
  return (
    obj &&
    typeof obj.intent_id === 'string' &&
    ['task', 'api', 'compute'].includes(obj.job_type) &&
    obj.task_payload &&
    obj.selection_policy &&
    typeof obj.selection_policy.weights === 'object' &&
    typeof obj.selection_policy.constraints === 'object'
  );
}

export function isValidBid(obj: any): obj is Bid {
  return (
    obj &&
    typeof obj.bid_id === 'string' &&
    typeof obj.intent_id === 'string' &&
    typeof obj.provider_address === 'string' &&
    obj.terms &&
    typeof obj.terms.price_usdc === 'number' &&
    typeof obj.staked_penalty_usdc === 'number'
  );
}

export function isValidProof(obj: any): obj is ProofSubmission {
  return (
    obj &&
    typeof obj.bid_id === 'string' &&
    typeof obj.observed_latency_ms === 'number' &&
    typeof obj.response_hash === 'string' &&
    typeof obj.timestamp === 'number'
  );
}

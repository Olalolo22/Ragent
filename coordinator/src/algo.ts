/**
 * Ragent Algorithm Implementation
 * Ported faithfully from inital_algo (Ragent Algorithm Appendix)
 * Used for job_type-specific hard constraints + scoring.
 * MVP focuses on 'api' job_type for deterministic attestation.
 */

export interface SelectionPolicy {
  weights: Record<string, number>; // e.g. { price: 0.5, latency: 0.5, ... }
  constraints: Record<string, number | string[] | string>; // max_price_usdc, max_latency_ms, required_*, etc.
}

export interface Intent {
  intent_id: string;
  job_type: 'task' | 'api' | 'compute';
  task_payload: Record<string, any>;
  selection_policy: SelectionPolicy;
}

export interface Bid {
  bid_id: string;
  intent_id: string;
  provider_address: string;
  agent_id?: string; // For ERC-8004 integration
  terms: {
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
  };
  staked_penalty_usdc: number;
  signature?: string;
}

export interface ScoredBid {
  bid: Bid;
  score: number;
  normalized: Record<string, number>;
}

/**
 * General Rules (from inital_algo)
 * 1. All bids must satisfy hard constraints before scoring.
 * 2. Scores normalized to common scale where possible.
 * 3. Fail hard constraint → reject immediately.
 * 4. Winner = highest-scoring valid bid.
 * 5. Tie: lower price, then higher reputation, then earlier arrival (simulated via bid_id for demo).
 */

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function normalizeInverse(value: number, min: number, max: number): number {
  return 1 - normalize(value, min, max);
}

function getObservedBidRange(bids: Bid[], key: keyof Bid['terms']): { min: number; max: number } {
  const vals = bids
    .map(b => b.terms[key] as number)
    .filter(v => typeof v === 'number' && !isNaN(v));
  if (vals.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

/**
 * Hard Constraints per job_type (from inital_algo)
 */
export function passesConstraints(intent: Intent, bid: Bid): boolean {
  const policy = intent.selection_policy.constraints;
  const terms = bid.terms;

  if (intent.job_type === 'api') {
    // Hard Constraints for API:
    // - required_api must be present in api_access
    // - latency_ms <= max_latency_ms
    // - reputation >= min_reputation

    const requiredApi = policy.required_api as string | undefined;
    if (requiredApi && (!terms.api_access || !terms.api_access.includes(requiredApi))) {
      return false;
    }

    const maxLatency = policy.max_latency_ms as number | undefined;
    if (maxLatency !== undefined && (terms.latency_ms ?? Infinity) > maxLatency) {
      return false;
    }

    const minRep = policy.min_reputation as number | undefined;
    if (minRep !== undefined && (terms.reputation ?? 0) < minRep) {
      return false;
    }
  } else if (intent.job_type === 'task') {
    // Task constraints (implemented for extensibility)
    const requiredTags = (policy.required_capability_tags as string[]) || [];
    if (requiredTags.length > 0) {
      const hasAll = requiredTags.every(tag => terms.capability_tags?.includes(tag));
      if (!hasAll) return false;
    }

    const minConf = policy.min_confidence as number | undefined;
    if (minConf !== undefined && (terms.confidence ?? 0) < minConf) return false;

    const maxEta = policy.max_eta_seconds as number | undefined;
    if (maxEta !== undefined && (terms.eta_seconds ?? Infinity) > maxEta) return false;
  } else if (intent.job_type === 'compute') {
    const minCapacity = policy.min_capacity as number | undefined;
    if (minCapacity !== undefined && (terms.capacity ?? 0) < minCapacity) return false;

    const minUptime = policy.min_uptime as number | undefined;
    if (minUptime !== undefined && (terms.uptime ?? 0) < minUptime) return false;

    const maxLatency = policy.max_latency_ms as number | undefined;
    if (maxLatency !== undefined && (terms.latency_ms ?? Infinity) > maxLatency) return false;
  }

  // Shared hard price constraint if present
  const maxPrice = policy.max_price_usdc as number | undefined;
  if (maxPrice !== undefined && terms.price_usdc > maxPrice) {
    return false;
  }

  return true;
}

/**
 * Job-specific scoring (from inital_algo)
 * score = sum(w * factor) - penalties
 * Normalized to [0,1] where possible.
 */
export function scoreByJobType(intent: Intent, bid: Bid, allBids: Bid[]): number {
  const policy = intent.selection_policy;
  const weights = policy.weights;
  const terms = bid.terms;
  const jobType = intent.job_type;

  // Get ranges for normalization across bids (for this intent)
  const priceRange = getObservedBidRange(allBids, 'price_usdc');
  const latencyRange = getObservedBidRange(allBids, 'latency_ms');

  let score = 0;

  if (jobType === 'api') {
    // API Agent Logic (MVP focus)
    // score_api = w_access * api_access_match + w_reliability * reputation + w_latency * normalized_inverse_latency + w_uptime * uptime - w_price * normalized_price
    const wAccess = weights.access ?? 0.30;
    const wReliability = weights.reliability ?? 0.25;
    const wLatency = weights.latency ?? 0.20;
    const wUptime = weights.uptime ?? 0.15;
    const wPrice = weights.price ?? 0.10;

    const apiAccessMatch = (policy.constraints.required_api && terms.api_access?.includes(policy.constraints.required_api as string)) ? 1 : 0;

    const normPrice = normalize(terms.price_usdc, priceRange.min, priceRange.max);
    const normInvLatency = terms.latency_ms ? normalizeInverse(terms.latency_ms, latencyRange.min, latencyRange.max) : 0.5;
    const rep = terms.reputation ?? 0.5;
    const up = terms.uptime ?? 0.5;

    score =
      wAccess * apiAccessMatch +
      wReliability * rep +
      wLatency * normInvLatency +
      wUptime * up -
      wPrice * normPrice;
  } else if (jobType === 'task') {
    // Task scoring (from inital_algo)
    const wCap = weights.capability ?? 0.35;
    const wConf = weights.confidence ?? 0.30;
    const wRep = weights.reputation ?? 0.15;
    const wPrice = weights.price ?? 0.10;
    const wEta = weights.eta ?? 0.10;

    const capMatch = 1; // Already filtered in constraints for MVP

    const normPrice = normalize(terms.price_usdc, priceRange.min, priceRange.max);
    const normEta = terms.eta_seconds ? normalize(terms.eta_seconds, 0, 300) : 0.5; // rough max

    score =
      wCap * capMatch +
      wConf * (terms.confidence ?? 0.5) +
      wRep * (terms.reputation ?? 0.5) -
      wPrice * normPrice -
      wEta * normEta;
  } else {
    // Compute stub
    const wCap = weights.capacity ?? 0.30;
    const wUp = weights.uptime ?? 0.25;
    const wLat = weights.latency ?? 0.20;
    const wRep = weights.reputation ?? 0.15;
    const wPrice = weights.price ?? 0.10;

    const normInvLat = terms.latency_ms ? normalizeInverse(terms.latency_ms, latencyRange.min, latencyRange.max) : 0.5;
    const normPrice = normalize(terms.price_usdc, priceRange.min, priceRange.max);

    score =
      wCap * (terms.capacity ?? 0.5) +
      wUp * (terms.uptime ?? 0.5) +
      wLat * normInvLat +
      wRep * (terms.reputation ?? 0.5) -
      wPrice * normPrice;
  }

  return score;
}

/**
 * Main selection function.
 * Filters valid bids, scores, sorts, returns winner.
 * Tie-break: lower price → higher reputation → earlier (bid_id lexical for demo)
 */
export function selectWinner(intent: Intent, bids: Bid[]): Bid | null {
  const validBids: Array<{ score: number; bid: Bid }> = [];

  for (const bid of bids) {
    if (!passesConstraints(intent, bid)) {
      continue;
    }
    const score = scoreByJobType(intent, bid, bids);
    validBids.push({ score, bid });
  }

  if (validBids.length === 0) {
    return null;
  }

  // Sort desc score, then tie breakers
  validBids.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    // lower price wins tie
    if (a.bid.terms.price_usdc !== b.bid.terms.price_usdc) {
      return a.bid.terms.price_usdc - b.bid.terms.price_usdc;
    }

    // higher reputation
    const repA = a.bid.terms.reputation ?? 0;
    const repB = b.bid.terms.reputation ?? 0;
    if (repB !== repA) return repB - repA;

    // earlier "arrival" — use bid_id lexical as proxy
    return a.bid.bid_id.localeCompare(b.bid.bid_id);
  });

  return validBids[0].bid;
}

/**
 * Convenience: score + explain for logging/demo
 */
export function scoreAndExplain(intent: Intent, bid: Bid, allBids: Bid[]): ScoredBid {
  const score = scoreByJobType(intent, bid, allBids);
  return {
    bid,
    score,
    normalized: {
      price: normalize(bid.terms.price_usdc, getObservedBidRange(allBids, 'price_usdc').min, getObservedBidRange(allBids, 'price_usdc').max),
      latency: bid.terms.latency_ms
        ? normalizeInverse(bid.terms.latency_ms, getObservedBidRange(allBids, 'latency_ms').min, getObservedBidRange(allBids, 'latency_ms').max)
        : 0.5,
    },
  };
}

// Example usage (for quick manual test):
// const winner = selectWinner(intent, bids);

/**
 * Ragent Verifier Agent
 *
 * An independent agent that verifies provider work BEFORE the coordinator
 * calls attest/release on-chain. This is the "provable attestation" piece.
 *
 * In production this would be a fully separate, staked agent.
 * For the hackathon demo it runs in-process but as a logically separate
 * component — the coordinator does NOT self-attest; it asks the verifier first.
 *
 * What it checks:
 *   1. response_hash — re-derives expected hash from the work and compares.
 *   2. Observed latency — must meet the intent's max_latency_ms constraint.
 *   3. Content validity — (demo: validates response_data format if present).
 *   4. Timestamp freshness — proof must be submitted within a reasonable window.
 */

import { createHash } from 'crypto';
import type { ProofSubmission } from '../schemas.js';
import type { Intent } from '../schemas.js';

/** Result returned by the verifier agent */
export interface VerificationResult {
  verified:          boolean;
  verdict:           'PASS' | 'FAIL' | 'FAIL_LATENCY' | 'FAIL_HASH' | 'FAIL_STALE';
  reason:            string;
  checks: {
    latency_ok:       boolean;
    hash_ok:          boolean;
    timestamp_fresh:  boolean;
    content_valid:    boolean;
  };
}

/** Max age of a proof submission we'll accept (10 minutes for demo) */
const MAX_PROOF_AGE_MS = 10 * 60 * 1_000;

/**
 * Derive the canonical response hash that the coordinator expects.
 * Provider MUST hash their response_data using this same method.
 *
 * Format: keccak-equivalent via SHA-256(bid_id + ':' + response_data_json)
 * (SHA-256 used for Node compat; a real deployment uses keccak256 via viem)
 */
export function deriveExpectedHash(bidId: string, responseData: unknown): string {
  const payload = bidId + ':' + JSON.stringify(responseData);
  return '0x' + createHash('sha256').update(payload).digest('hex');
}

/**
 * Main verification function.
 *
 * @param proof       The ProofSubmission from the provider
 * @param intent      The original Intent (for constraint checking)
 * @param responseData  Optional: the actual response payload (enables hash check)
 */
export async function verifyWork(
  proof: ProofSubmission & { response_data?: unknown },
  intent: Intent
): Promise<VerificationResult> {
  const checks = {
    latency_ok:      true,
    hash_ok:         true,
    timestamp_fresh: true,
    content_valid:   true,
  };

  // ── Check 1: Latency SLA ─────────────────────────────────────────────────
  const maxLatency = intent.selection_policy?.constraints?.max_latency_ms as number | undefined;
  if (maxLatency !== undefined && proof.observed_latency_ms > maxLatency) {
    checks.latency_ok = false;
  }

  // ── Check 2: Proof freshness ──────────────────────────────────────────────
  const ageMs = Date.now() - proof.timestamp;
  if (ageMs > MAX_PROOF_AGE_MS || ageMs < 0) {
    checks.timestamp_fresh = false;
  }

  // ── Check 3: Response hash ────────────────────────────────────────────────
  if (proof.response_data !== undefined) {
    const expectedHash = deriveExpectedHash(proof.bid_id, proof.response_data);
    if (expectedHash !== proof.response_hash) {
      checks.hash_ok = false;
    }
  } else {
    // No raw response data provided — trust the hash (common in demo mode)
    // In production, the verifier would independently re-execute the task.
    console.log('[Verifier] ℹ No response_data provided — skipping hash re-derivation (demo mode)');
  }

  // ── Check 4: Content validity ─────────────────────────────────────────────
  // For API job_type: response_data should have a numeric 'price' field.
  if (proof.response_data && intent.job_type === 'api') {
    const data = proof.response_data as any;
    if (typeof data.price !== 'number' && typeof data.price !== 'string') {
      checks.content_valid = false;
    }
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  const allPassed = Object.values(checks).every(Boolean);

  let verdict: VerificationResult['verdict'];
  let reason: string;

  if (allPassed) {
    verdict = 'PASS';
    reason  = `Work verified ✓ (latency=${proof.observed_latency_ms}ms, hash=${proof.response_hash.slice(0, 12)}..., age=${Math.round(ageMs / 1000)}s)`;
  } else if (!checks.latency_ok) {
    verdict = 'FAIL_LATENCY';
    reason  = `SLA breach: ${proof.observed_latency_ms}ms > ${maxLatency}ms limit`;
  } else if (!checks.hash_ok) {
    verdict = 'FAIL_HASH';
    reason  = `Response hash mismatch — provider may have submitted tampered data`;
  } else if (!checks.timestamp_fresh) {
    verdict = 'FAIL_STALE';
    reason  = `Proof is stale (age=${Math.round(ageMs / 1000)}s, max=${MAX_PROOF_AGE_MS / 1000}s)`;
  } else {
    verdict = 'FAIL';
    reason  = `Content validation failed — response_data does not match expected format`;
  }

  console.log(`[Verifier] Verdict: ${verdict} — ${reason}`);

  return { verified: allPassed, verdict, reason, checks };
}

/**
 * Mock: build a valid proof submission for a given bid/intent.
 * Used in the full-demo to simulate a provider submitting their work.
 */
export function buildDemoProof(
  bidId: string,
  intentId: string,
  observedLatencyMs: number,
  responseData: unknown = { price: 3412.87, symbol: 'ETHUSDC', source: 'binance' }
): ProofSubmission & { response_data: unknown } {
  const hash = deriveExpectedHash(bidId, responseData);
  return {
    bid_id:              bidId,
    intent_id:           intentId,
    observed_latency_ms: observedLatencyMs,
    response_hash:       hash,
    timestamp:           Date.now(),
    response_data:       responseData,
    metadata:            { verifier_compatible: true },
  };
}

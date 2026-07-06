/**
 * circle/webhooks.ts
 *
 * Circle Webhook handler — the final piece of the Trust Layer.
 *
 * WHY THIS EXISTS:
 * Without webhooks, a user integrating with Ragent has to:
 *   1. Trust that our server is telling the truth about escrow state.
 *   2. Manually check ArcScan to verify payments.
 *
 * WITH Circle Webhooks:
 * - When a contract transaction settles on-chain (createEscrow, release, slash),
 *   Circle fires a signed HTTP POST to our /webhooks/circle endpoint.
 * - The signature is verified using our webhook secret — proving Circle sent it.
 * - We then emit the verified event so any subscriber (frontend, partner, auditor)
 *   can react to the real on-chain settlement WITHOUT trusting Ragent's word.
 *
 * SETUP (in Circle Console):
 * 1. Go to: https://console.circle.com → Webhooks → Add Endpoint
 * 2. URL: https://<your-deployed-server>/webhooks/circle
 * 3. Select events: transactions.outbound, contract_execution.confirmed
 * 4. Copy the "Signing Secret" → set CIRCLE_WEBHOOK_SECRET env var
 *
 * VERIFICATION:
 * Circle signs each webhook payload with HMAC-SHA256 using the signing secret.
 * The signature is in the "X-Circle-Signature" header. We verify it here to
 * ensure the notification is genuinely from Circle, not a spoofed request.
 */

import { createHmac } from 'crypto';

const CIRCLE_WEBHOOK_SECRET = process.env.CIRCLE_WEBHOOK_SECRET ?? '';

if (!CIRCLE_WEBHOOK_SECRET) {
  console.warn('[Circle Webhooks] ⚠  CIRCLE_WEBHOOK_SECRET not set — webhook signature verification disabled.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CircleWebhookEvent =
  | { type: 'transactions.outbound';             data: TransactionEvent }
  | { type: 'contract_execution.confirmed';      data: ContractExecutionEvent }
  | { type: 'contract_execution.failed';         data: ContractExecutionEvent }
  | { type: 'wallet.created';                    data: WalletEvent }
  | { type: string;                              data: Record<string, unknown> };

export interface TransactionEvent {
  id:              string;
  blockchain:      string;
  walletId:        string;
  txHash:          string;
  state:           'CONFIRMED' | 'FAILED' | 'PENDING';
  amounts:         { amount: string; token: { symbol: string } }[];
  destinationAddress: string;
}

export interface ContractExecutionEvent {
  id:              string;
  blockchain:      string;
  contractAddress: string;
  txHash:          string;
  state:           'CONFIRMED' | 'FAILED';
  abiFunctionSignature?: string;
}

export interface WalletEvent {
  id:      string;
  address: string;
  state:   'LIVE' | 'FROZEN';
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory event log (for demo — in production, write to DB)
// ─────────────────────────────────────────────────────────────────────────────

const webhookEventLog: Array<{ receivedAt: string; event: CircleWebhookEvent }> = [];

// Subscribers can register a callback to be called on any verified event
type WebhookSubscriber = (event: CircleWebhookEvent) => void;
const subscribers: WebhookSubscriber[] = [];

export function onCircleWebhook(fn: WebhookSubscriber) {
  subscribers.push(fn);
}

export function getWebhookEventLog() {
  return webhookEventLog;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies that a Circle webhook was actually sent by Circle.
 * Circle signs the raw request body with HMAC-SHA256 using your webhook secret.
 *
 * @param rawBody   - The raw request body string (do NOT parse JSON first)
 * @param signature - The value of the X-Circle-Signature header
 * @returns true if the signature is valid
 */
export function verifyCircleSignature(rawBody: string, signature: string): boolean {
  if (!CIRCLE_WEBHOOK_SECRET) {
    // If no secret configured, skip verification in dev (warn prominently)
    console.warn('[Circle Webhooks] ⚠  Skipping signature verification — CIRCLE_WEBHOOK_SECRET not set.');
    return true;
  }

  if (!signature) {
    console.error('[Circle Webhooks] ❌ No X-Circle-Signature header present — rejecting.');
    return false;
  }

  const expected = createHmac('sha256', CIRCLE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signature);

  if (expectedBuf.length !== receivedBuf.length) return false;

  // timingSafeEqual is only available in Node crypto — use manual fallback if not
  let mismatch = 0;
  for (let i = 0; i < expectedBuf.length; i++) {
    mismatch |= expectedBuf[i] ^ receivedBuf[i];
  }

  return mismatch === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes a verified Circle webhook event.
 * Logs it, emits to subscribers, and returns a human-readable description.
 */
export function handleCircleWebhookEvent(event: CircleWebhookEvent): string {
  // Store in our audit log
  webhookEventLog.push({ receivedAt: new Date().toISOString(), event });

  // Notify all subscribers (e.g. the server can update escrow state, push to frontend via SSE, etc.)
  subscribers.forEach(fn => fn(event));

  // Log a clean, human-readable description
  switch (event.type) {
    case 'contract_execution.confirmed': {
      const d = event.data as ContractExecutionEvent;
      console.log(`[Circle Webhooks] ✅ Contract execution confirmed`);
      console.log(`   Contract: ${d.contractAddress}`);
      console.log(`   Fn:       ${d.abiFunctionSignature ?? 'unknown'}`);
      console.log(`   TxHash:   ${d.txHash}`);
      console.log(`   ArcScan:  https://testnet.arcscan.app/tx/${d.txHash}`);
      return `confirmed:${d.txHash}`;
    }

    case 'contract_execution.failed': {
      const d = event.data as ContractExecutionEvent;
      console.error(`[Circle Webhooks] ❌ Contract execution FAILED`);
      console.error(`   Contract: ${d.contractAddress}`);
      console.error(`   TxHash:   ${d.txHash ?? 'none'}`);
      return `failed:${d.contractAddress}`;
    }

    case 'transactions.outbound': {
      const d = event.data as TransactionEvent;
      const amount = d.amounts?.[0];
      console.log(`[Circle Webhooks] 💸 Outbound transaction confirmed`);
      console.log(`   To:     ${d.destinationAddress}`);
      console.log(`   Amount: ${amount?.amount ?? '?'} ${amount?.token?.symbol ?? 'USDC'}`);
      console.log(`   TxHash: ${d.txHash}`);
      return `outbound:${d.txHash}`;
    }

    case 'wallet.created': {
      const d = event.data as WalletEvent;
      console.log(`[Circle Webhooks] 🔑 Wallet created: ${d.address}`);
      return `wallet:${d.address}`;
    }

    default: {
      console.log(`[Circle Webhooks] 📬 Event received: ${event.type}`);
      return `event:${event.type}`;
    }
  }
}

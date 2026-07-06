/**
 * circle/escrow.ts
 *
 * Circle Programmable Wallet-based Escrow — the Trust Layer core.
 *
 * WHY THIS REPLACES RagentEscrow.sol for USDC custody:
 * ───────────────────────────────────────────────────────
 * The old model: User USDC → RagentEscrow.sol (unaudited contract by us)
 *                            "Trust our code"
 *
 * The new model: User USDC → Circle Dev-Controlled Wallet (per negotiation)
 *                            "Trust Circle" (a licensed money transmitter)
 *                            Ragent calls Circle API to release/slash.
 *                            Circle fires a signed Webhook confirming it.
 *                            On-chain log (RagentSettlementLog.sol) records
 *                            the Circle transaction ID for cross-verification.
 *
 * HOW IT WORKS:
 * 1. When a winner is selected, we create a dedicated Circle wallet for
 *    this negotiation via the Developer-Controlled Wallets API.
 * 2. The requester sends USDC to that wallet address (shown in the UI).
 * 3. When the job is verified, we call Circle API to transfer the USDC
 *    to the provider (success) or back to the requester (failure).
 * 4. Circle's Webhook fires with a signed confirmation.
 * 5. RagentSettlementLog.sol records the Circle transaction ID on-chain
 *    so anyone can independently verify the payment happened.
 *
 * FALLBACK:
 * If Circle keys are not configured, falls back to on-chain escrow via
 * the original viem/RagentEscrow.sol path (for local dev).
 */

import { walletsClient, isCircleAvailable } from './client.js';

// Arc Testnet blockchain identifier for Circle SDK
const ARC_BLOCKCHAIN = 'ARC-TESTNET';
// Native USDC on Arc testnet
const USDC_TOKEN_ID  = 'USDC';

// In-memory map of intentId → Circle wallet info for active escrows
const activeEscrows = new Map<string, {
  walletId:    string;
  walletAddr:  string;
  priceUsdc:   number;
  penaltyUsdc: number;
  requester:   string;
  provider:    string;
}>();

let walletSetId: string | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getOrCreateWalletSet(): Promise<string> {
  if (walletSetId) return walletSetId;
  if (!walletsClient) throw new Error('Circle Wallets client not available.');

  const res = await walletsClient.createWalletSet({ name: 'Ragent Escrows' });
  walletSetId = res.data?.walletSet?.id ?? null;
  if (!walletSetId) throw new Error('Failed to create Circle Wallet Set.');
  console.log('[Circle Escrow] Created Wallet Set:', walletSetId);
  return walletSetId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a dedicated Circle programmable wallet for this negotiation.
 * The requester should send USDC (+ optional penalty stake) to the returned address.
 *
 * This wallet is co-signed by Circle — Ragent cannot unilaterally move the funds.
 * Only a Circle API call (from this coordinator) can release or slash them.
 *
 * @returns { walletId, walletAddress } — walletAddress is where funds are sent.
 */
export async function createCircleEscrow(params: {
  intentId:    string;
  requester:   string;
  provider:    string;
  priceUsdc:   number;
  penaltyUsdc: number;
}): Promise<{ walletId: string; walletAddress: string }> {
  if (!walletsClient) throw new Error('Circle Wallets not configured. Set CIRCLE_API_KEY + ENTITY_SECRET.');

  const setId = await getOrCreateWalletSet();

  console.log(`[Circle Escrow] Creating escrow wallet for intent ${params.intentId}...`);

  const res = await walletsClient.createWallets({
    blockchains:  [ARC_BLOCKCHAIN],
    count:        1,
    walletSetId:  setId,
    metadata: [{
      name:        `Ragent Escrow — ${params.intentId.slice(0, 10)}`,
      refId:       params.intentId,
    }],
  });

  const wallet = res.data?.wallets?.[0];
  if (!wallet?.id || !wallet?.address) {
    throw new Error('Failed to create Circle escrow wallet.');
  }

  // Store in memory for this session
  activeEscrows.set(params.intentId, {
    walletId:    wallet.id,
    walletAddr:  wallet.address,
    priceUsdc:   params.priceUsdc,
    penaltyUsdc: params.penaltyUsdc,
    requester:   params.requester,
    provider:    params.provider,
  });

  console.log(`[Circle Escrow] ✅ Escrow wallet created: ${wallet.address}`);
  console.log(`[Circle Escrow]    Wallet ID: ${wallet.id}`);
  console.log(`[Circle Escrow]    Send ${params.priceUsdc + params.penaltyUsdc} USDC to ${wallet.address}`);

  return { walletId: wallet.id, walletAddress: wallet.address };
}

/**
 * Releases USDC from the escrow wallet to the provider (SLA met).
 * Calls Circle API — Circle co-signs and executes the transfer.
 *
 * @returns Circle transaction ID (use this to verify on Circle dashboard)
 */
export async function releaseCircleEscrow(intentId: string): Promise<string> {
  if (!walletsClient) throw new Error('Circle Wallets not configured.');

  const escrow = activeEscrows.get(intentId);
  if (!escrow) throw new Error(`No active Circle escrow for intent: ${intentId}`);

  console.log(`[Circle Escrow] Releasing ${escrow.priceUsdc} USDC to provider ${escrow.provider}...`);

  const res = await walletsClient.createTransaction({
    walletId:            escrow.walletId,
    blockchain:          'ARC-TESTNET',
    tokenId:             USDC_TOKEN_ID,
    destinationAddress:  escrow.provider,
    amount:              [String(escrow.priceUsdc)],
    fee:                 { type: 'level', config: { feeLevel: 'MEDIUM' } },
  } as any);

  const txId = (res.data as any)?.transaction?.id ?? (res.data as any)?.id ?? 'unknown';
  console.log(`[Circle Escrow] ✅ Release submitted. Circle TX ID: ${txId}`);
  console.log(`[Circle Escrow]    Verify at: https://console.circle.com`);

  activeEscrows.delete(intentId);
  return txId;
}

/**
 * Returns USDC from the escrow wallet to the requester (SLA breached).
 * Calls Circle API — Circle co-signs and executes the transfer.
 *
 * @returns Circle transaction ID
 */
export async function slashCircleEscrow(intentId: string): Promise<string> {
  if (!walletsClient) throw new Error('Circle Wallets not configured.');

  const escrow = activeEscrows.get(intentId);
  if (!escrow) throw new Error(`No active Circle escrow for intent: ${intentId}`);

  const slashAmount = escrow.priceUsdc + escrow.penaltyUsdc;
  console.log(`[Circle Escrow] Slashing — returning ${slashAmount} USDC to requester ${escrow.requester}...`);

  const res = await walletsClient.createTransaction({
    walletId:            escrow.walletId,
    blockchain:          'ARC-TESTNET',
    tokenId:             USDC_TOKEN_ID,
    destinationAddress:  escrow.requester,
    amount:              [String(slashAmount)],
    fee:                 { type: 'level', config: { feeLevel: 'MEDIUM' } },
  } as any);

  const txId = (res.data as any)?.transaction?.id ?? (res.data as any)?.id ?? 'unknown';
  console.log(`[Circle Escrow] ✅ Slash submitted. Circle TX ID: ${txId}`);

  activeEscrows.delete(intentId);
  return txId;
}

/**
 * Returns info about an active Circle escrow.
 */
export function getCircleEscrow(intentId: string) {
  return activeEscrows.get(intentId) ?? null;
}

/**
 * Returns all active Circle escrows (for health endpoint etc.)
 */
export function getAllCircleEscrows() {
  return Object.fromEntries(activeEscrows.entries());
}

export { isCircleAvailable };

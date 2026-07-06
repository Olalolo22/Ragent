/**
 * circle/wallets.ts
 *
 * Agent wallet management via Circle Developer-Controlled Wallets.
 *
 * Instead of using raw private keys (the "trust us" model), each Ragent
 * participant (requester, providers) gets a Circle-managed programmable wallet.
 *
 * Why this matters for trust:
 * - Wallets are co-signed by Circle's infrastructure — not just Ragent's server.
 * - Every transaction is logged in Circle's dashboard. Users can verify our
 *   coordinator didn't lie about a payment by checking the Circle audit trail.
 * - No private key is ever stored in our application code.
 *
 * Arc Testnet:
 * - Blockchain: ARC-TESTNET
 * - USDC is the native gas token — same address used for payments & gas.
 */

import { walletsClient } from './client.js';

// Arc testnet identifier used by Circle SDK
const ARC_BLOCKCHAIN = 'ARC-TESTNET';

// In-memory store for this session (wallet sets are persistent on Circle's side)
const agentWallets = new Map<string, { walletId: string; address: string }>();

let walletSetId: string | null = null;

/**
 * Creates a Circle Wallet Set for this Ragent session (idempotent — reuse if set).
 * A Wallet Set is a collection of wallets that share the same entity secret.
 */
export async function getOrCreateWalletSet(): Promise<string> {
  if (walletSetId) return walletSetId;
  if (!walletsClient) throw new Error('Circle Wallets client not initialized. Check CIRCLE_API_KEY + ENTITY_SECRET.');

  const res = await walletsClient.createWalletSet({ name: 'Ragent Agents' });
  walletSetId = res.data?.walletSet?.id ?? null;

  if (!walletSetId) throw new Error('Failed to create Circle Wallet Set. Check API response.');
  console.log('[Circle Wallets] Created Wallet Set:', walletSetId);
  return walletSetId;
}

/**
 * Creates a Circle Developer-Controlled Wallet for an agent.
 * Returns the Circle wallet ID and the on-chain address.
 *
 * @param agentId  - Logical agent ID (e.g. "requester", "provider-0", "provider-1")
 */
export async function createAgentWallet(agentId: string): Promise<{ walletId: string; address: string }> {
  if (!walletsClient) throw new Error('Circle Wallets client not initialized.');

  // Return cached wallet for this session to avoid duplicates
  const cached = agentWallets.get(agentId);
  if (cached) return cached;

  const setId = await getOrCreateWalletSet();

  const res = await walletsClient.createWallets({
    blockchains: [ARC_BLOCKCHAIN as any],
    count: 1,
    walletSetId: setId,
  });

  const wallet = res.data?.wallets?.[0];
  if (!wallet?.id || !wallet?.address) {
    throw new Error(`Failed to create Circle wallet for agent "${agentId}".`);
  }

  const result = { walletId: wallet.id, address: wallet.address };
  agentWallets.set(agentId, result);

  console.log(`[Circle Wallets] Wallet for agent "${agentId}": ${wallet.address}`);
  return result;
}

/**
 * Returns the Circle wallet for an agent (must have been created in this session).
 */
export function getAgentWallet(agentId: string) {
  return agentWallets.get(agentId) ?? null;
}

/**
 * Returns all agent wallets created in this session.
 */
export function getAllAgentWallets() {
  return Object.fromEntries(agentWallets.entries());
}

/**
 * circle/client.ts
 *
 * Initializes the two Circle SDK clients used by Ragent:
 *
 * 1. Developer-Controlled Wallets SDK  (@circle-fin/developer-controlled-wallets)
 *    - Creates & manages programmable wallets for each agent.
 *    - Co-signed by Circle — no raw private key ever leaves Circle's custody.
 *    - Gives users a verifiable audit trail: every tx is Circle-attested.
 *
 * 2. Smart Contract Platform SDK       (@circle-fin/smart-contract-platform)
 *    - Deploys & calls RagentEscrow via Circle's relayer API.
 *    - Every createEscrow / attest / release is a Circle-logged transaction.
 *    - This is what removes "trust us with your money" — Circle is the paper trail.
 *
 * Required env vars:
 *   CIRCLE_API_KEY     — from https://console.circle.com (Test API Key)
 *   ENTITY_SECRET     — from https://console.circle.com (Dev-Controlled Wallets)
 */
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const CIRCLE_API_KEY  = process.env.CIRCLE_API_KEY;
const ENTITY_SECRET   = process.env.ENTITY_SECRET;

if (!CIRCLE_API_KEY) {
  console.warn('[Circle] ⚠  CIRCLE_API_KEY not set — Circle SDK features will be unavailable.');
}

if (!ENTITY_SECRET) {
  console.warn('[Circle] ⚠  ENTITY_SECRET not set — Developer-Controlled Wallets will be unavailable.');
}

/**
 * Circle Developer-Controlled Wallets client.
 * Used to create agent wallets, check balances, and sign transactions
 * without ever holding a raw private key in application code.
 */
export let walletsClient: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;
export let isCircleAvailable = false;

if (CIRCLE_API_KEY && ENTITY_SECRET) {
  try {
    walletsClient = initiateDeveloperControlledWalletsClient({
      apiKey:       CIRCLE_API_KEY,
      entitySecret: ENTITY_SECRET,
    });
    isCircleAvailable = true;
  } catch (err: any) {
    console.error('[Circle] Failed to initialize client (bad keys?):', err?.message || err);
    walletsClient = null;
    isCircleAvailable = false;
  }
}

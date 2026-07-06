/**
 * circle/contracts.ts
 *
 * RagentEscrow interactions via Circle Smart Contract Platform.
 *
 * This module is the core of the "trust layer". Instead of calling the escrow
 * contract directly with a raw private key (which users have to trust Ragent
 * for), we route every escrow action through Circle's Smart Contract Platform.
 *
 * Why this removes "trust us":
 * - Every createEscrow / attest / release / slash is an API call to Circle.
 * - Circle logs the call, signs the transaction, and submits it on-chain.
 * - The on-chain tx hash is Circle-attested and verifiable on ArcScan.
 * - Circle's Webhooks (see circle/webhooks.ts) fire a cryptographically signed
 *   notification when each transaction confirms — so the frontend (or any
 *   third party) can verify settlement without trusting Ragent's server.
 *
 * Deployment:
 * - The first call to deployEscrowContract() deploys RagentEscrow via Circle.
 * - The contract address is stored in memory and returned for subsequent calls.
 * - In production, you'd store this in a DB / env var.
 *
 * Arc Testnet:
 * - Network: ARC-TESTNET
 * - USDC: 0x3600000000000000000000000000000000000000 (native gas token)
 */

import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';
import { contractsClient } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Load the compiled RagentEscrow artifact (same one used by the viem path)
const escrowArtifact = JSON.parse(
  fs.readFileSync(join(__dirname, '../../artifacts/RagentEscrow.json'), 'utf8')
);

// In-memory contract address (set after first deploy)
let escrowContractAddress: string | null = null;

// Circle deployment ID (for tracking)
let deploymentId: string | null = null;

/**
 * Deploys RagentEscrow to Arc Testnet via Circle Smart Contract Platform.
 * Returns the deployed contract address.
 *
 * If already deployed this session, returns the cached address.
 */
export async function deployEscrowViaCircle(fromWalletId: string): Promise<string> {
  if (escrowContractAddress) {
    console.log('[Circle Contracts] Reusing existing RagentEscrow:', escrowContractAddress);
    return escrowContractAddress;
  }

  if (!contractsClient) throw new Error('Circle Smart Contract Platform client not initialized. Check CIRCLE_API_KEY.');

  console.log('[Circle Contracts] Deploying RagentEscrow via Circle Smart Contract Platform...');

  const res = await contractsClient.deployContract({
    name:         'RagentEscrow',
    description:  'Ragent trustless escrow for agentic negotiation settlements',
    blockchain:   'ARC-TESTNET',
    walletId:     fromWalletId,                      // Circle wallet pays the gas
    bytecode:     escrowArtifact.bytecode,           // compiled bytecode
    abi:          JSON.stringify(escrowArtifact.abi),
    constructorParameters: [],                        // RagentEscrow has no constructor args
  });

  const address = res.data?.contractAddress;
  if (!address) throw new Error('Circle contract deployment failed — no contractAddress in response.');

  escrowContractAddress = address;
  deploymentId = res.data?.id ?? null;

  console.log('[Circle Contracts] RagentEscrow deployed:', address);
  console.log('[Circle Contracts] View on ArcScan: https://testnet.arcscan.app/address/' + address);

  return address;
}

/**
 * Returns the currently deployed RagentEscrow address (null if not yet deployed).
 */
export function getEscrowAddress(): string | null {
  return escrowContractAddress;
}

/**
 * Calls createEscrow on the deployed RagentEscrow contract via Circle.
 *
 * @param fromWalletId  - Circle wallet ID of the requester agent (pays gas + locks USDC)
 * @param intentId      - bytes32 hex of the intent ID
 * @param providerAddr  - Address of the winning provider
 * @param priceUsdc     - USDC amount to lock for payment (in micro-USDC: 1 USDC = 1_000_000)
 * @param penaltyUsdc   - Staked penalty amount (in micro-USDC)
 */
export async function createEscrowViaCircle(
  fromWalletId: string,
  intentId:     string,
  providerAddr: string,
  priceUsdc:    bigint,
  penaltyUsdc:  bigint
): Promise<string> {
  if (!contractsClient) throw new Error('Circle Smart Contract Platform client not initialized.');

  const address = escrowContractAddress;
  if (!address) throw new Error('RagentEscrow not deployed. Call deployEscrowViaCircle() first.');

  const res = await contractsClient.createContractExecution({
    walletId:         fromWalletId,
    contractAddress:  address,
    blockchain:       'ARC-TESTNET',
    abiFunctionSignature: 'createEscrow(bytes32,address,uint256,uint256,address)',
    abiParameters: [
      intentId,
      providerAddr,
      priceUsdc.toString(),
      penaltyUsdc.toString(),
      '0x3600000000000000000000000000000000000000', // Arc native USDC
    ],
  });

  const txId = res.data?.id ?? 'unknown';
  console.log('[Circle Contracts] createEscrow submitted. Circle TX ID:', txId);
  return txId;
}

/**
 * Calls attest() on RagentEscrow via Circle.
 *
 * @param fromWalletId  - Circle wallet ID of the coordinator (attester)
 * @param escrowId      - bytes32 hex (same as intentId used in createEscrow)
 * @param success       - Whether the SLA was met
 * @param proofHash     - bytes32 hash of the work proof
 */
export async function attestViaCircle(
  fromWalletId: string,
  escrowId:     string,
  success:      boolean,
  proofHash:    string
): Promise<string> {
  if (!contractsClient) throw new Error('Circle Smart Contract Platform client not initialized.');

  const address = escrowContractAddress;
  if (!address) throw new Error('RagentEscrow not deployed.');

  const res = await contractsClient.createContractExecution({
    walletId:         fromWalletId,
    contractAddress:  address,
    blockchain:       'ARC-TESTNET',
    abiFunctionSignature: 'attest(bytes32,bool,bytes32)',
    abiParameters: [escrowId, String(success), proofHash],
  });

  const txId = res.data?.id ?? 'unknown';
  console.log(`[Circle Contracts] attest(success=${success}) submitted. Circle TX ID:`, txId);
  return txId;
}

/**
 * Calls release() on RagentEscrow via Circle (on successful SLA).
 */
export async function releaseViaCircle(fromWalletId: string, escrowId: string): Promise<string> {
  if (!contractsClient) throw new Error('Circle Smart Contract Platform client not initialized.');
  const address = escrowContractAddress;
  if (!address) throw new Error('RagentEscrow not deployed.');

  const res = await contractsClient.createContractExecution({
    walletId:         fromWalletId,
    contractAddress:  address,
    blockchain:       'ARC-TESTNET',
    abiFunctionSignature: 'release(bytes32)',
    abiParameters: [escrowId],
  });

  const txId = res.data?.id ?? 'unknown';
  console.log('[Circle Contracts] release() submitted. Circle TX ID:', txId);
  return txId;
}

/**
 * Calls slash() on RagentEscrow via Circle (on SLA breach).
 */
export async function slashViaCircle(fromWalletId: string, escrowId: string): Promise<string> {
  if (!contractsClient) throw new Error('Circle Smart Contract Platform client not initialized.');
  const address = escrowContractAddress;
  if (!address) throw new Error('RagentEscrow not deployed.');

  const res = await contractsClient.createContractExecution({
    walletId:         fromWalletId,
    contractAddress:  address,
    blockchain:       'ARC-TESTNET',
    abiFunctionSignature: 'slash(bytes32)',
    abiParameters: [escrowId],
  });

  const txId = res.data?.id ?? 'unknown';
  console.log('[Circle Contracts] slash() submitted. Circle TX ID:', txId);
  return txId;
}

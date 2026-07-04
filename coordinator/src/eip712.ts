/**
 * Ragent EIP-712 Signature Helpers
 *
 * Provides typed-data domain + types for Bid signing/verification.
 * Uses viem's verifyTypedData (no extra deps — viem is already installed).
 *
 * Signing (provider agent side):
 *   const sig = await walletClient.signTypedData(buildBidTypedData(bid, chainId));
 *   bid.signature = sig;
 *
 * Verifying (coordinator server side):
 *   const ok = await verifyBidSignature(bid, chainId);
 *   if (!ok) reject the bid.
 */

import { verifyTypedData, type Address, type Hex, type WalletClient } from 'viem';
import type { Bid } from './schemas.js';

/** EIP-712 domain — matches what provider agents must use when signing */
export function getRagentDomain(chainId: number) {
  return {
    name: 'Ragent',
    version: '1',
    chainId,
  } as const;
}

/** EIP-712 typed data types for a Bid */
export const BID_TYPES = {
  Bid: [
    { name: 'bid_id',              type: 'string'  },
    { name: 'intent_id',           type: 'string'  },
    { name: 'provider_address',    type: 'address' },
    { name: 'price_usdc',          type: 'uint256' },
    { name: 'staked_penalty_usdc', type: 'uint256' },
    { name: 'latency_ms',          type: 'uint256' },
  ],
} as const;

/** Build the typed data message from a Bid (for signing + verification) */
export function buildBidMessage(bid: Bid) {
  return {
    bid_id:              bid.bid_id,
    intent_id:           bid.intent_id,
    provider_address:    bid.provider_address as Address,
    // Convert floats → micro-units (×1e6) to keep values as integers on-chain
    price_usdc:          BigInt(Math.round(bid.terms.price_usdc * 1_000_000)),
    staked_penalty_usdc: BigInt(Math.round(bid.staked_penalty_usdc * 1_000_000)),
    latency_ms:          BigInt(bid.terms.latency_ms ?? 0),
  };
}

/**
 * Build the full typedData payload ready to pass to walletClient.signTypedData.
 * Provider agents use this when constructing their bid.
 *
 * Example:
 *   const sig = await walletClient.signTypedData(buildBidTypedData(bid, 31337));
 */
export function buildBidTypedData(bid: Bid, chainId: number) {
  return {
    domain:      getRagentDomain(chainId),
    types:       BID_TYPES,
    primaryType: 'Bid' as const,
    message:     buildBidMessage(bid),
  };
}

/**
 * Verify a bid's EIP-712 signature.
 *
 * Returns true  → signature is valid and signer === bid.provider_address.
 * Returns false → missing signature, invalid signature, or signer mismatch.
 *
 * Soft-mode: if the bid has no signature, returns false but the server
 * may choose to accept unsigned bids with a warning (for demo compatibility).
 */
export async function verifyBidSignature(bid: Bid, chainId: number): Promise<boolean> {
  if (!bid.signature) return false;

  try {
    const valid = await verifyTypedData({
      address:     bid.provider_address as Address,
      domain:      getRagentDomain(chainId),
      types:       BID_TYPES,
      primaryType: 'Bid',
      message:     buildBidMessage(bid),
      signature:   bid.signature as Hex,
    });
    return valid;
  } catch (e) {
    console.warn('[EIP-712] Signature verification error:', e);
    return false;
  }
}

/**
 * Sign a bid with a provider's WalletClient.
 * Returns the bid with the `signature` field populated.
 *
 * Usage in demo / provider agents:
 *   const signedBid = await signBid(bid, providerWalletClient, 31337);
 */
export async function signBid(bid: Bid, walletClient: WalletClient, chainId: number): Promise<Bid> {
  const typedData = buildBidTypedData(bid, chainId);
  const account = walletClient.account;
  if (!account) throw new Error('[EIP-712] walletClient has no account — pass an account when creating the client');
  const signature = await walletClient.signTypedData({ ...typedData, account });
  return { ...bid, signature };
}

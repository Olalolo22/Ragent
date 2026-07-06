/**
 * Ragent Chain Integration (viem)
 *
 * Provides functions to:
 * - Deploy the contracts locally (anvil) or connect to existing
 * - Create escrow (lock funds)
 * - Attest outcome
 * - Release or slash
 *
 * For the hackathon demo, this enables real on-chain txs.
 * Later can be extended for Arc testnet + Circle wallets + ERC-8004.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  getContract,
  encodeDeployData,
  decodeEventLog,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as fs from 'fs';
import escrowArtifact from '../artifacts/RagentEscrow.json';
import registryArtifact from '../artifacts/RagentRegistry.json';
import mockUsdcArtifact from '../artifacts/MockUSDC.json';

const ANVIL_RPC = 'http://localhost:8545';
const ARC_TESTNET_RPC = process.env.ARC_RPC || 'https://rpc.testnet.arc.network';
// Arc Testnet: USDC is the native gas token, represented at this address
const USDC_TESTNET = (process.env.USDC_ADDRESS as Address) || '0x3600000000000000000000000000000000000000';

const anvilChain: Chain = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
};

const arcTestnetChain: Chain = {
  id: 5042002, // Arc Testnet official chain ID
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [ARC_TESTNET_RPC] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
};

// Default anvil private keys (well known, only for local dev)
const ANVIL_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // 0xf39F...
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
];

let currentAccount = privateKeyToAccount(ANVIL_KEYS[0] as Hex);
let currentProviderAccount = privateKeyToAccount(ANVIL_KEYS[1] as Hex);

export const getCurrentAccount = () => currentAccount;
export const getCurrentProviderAccount = () => currentProviderAccount;

export function configureTestnet(privateKey?: Hex) {
  if (privateKey) {
    currentAccount = privateKeyToAccount(privateKey);
    // For demo, use same or different for provider
    currentProviderAccount = privateKeyToAccount(privateKey);
  }
  console.log('Configured for Arc testnet. Account:', currentAccount.address);
}

function getRpc(useTestnet = false) {
  return useTestnet ? ARC_TESTNET_RPC : ANVIL_RPC;
}

function getTransport(useTestnet = false) {
  return http(getRpc(useTestnet));
}

export function getClients(useTestnet = false) {
  const chain = useTestnet ? arcTestnetChain : anvilChain;
  const transport = getTransport(useTestnet);
  const pub = createPublicClient({ chain, transport });
  const wal = createWalletClient({ account: currentAccount, chain, transport });
  const provWal = createWalletClient({ account: currentProviderAccount, chain, transport });
  return { publicClient: pub, walletClient: wal, providerWallet: provWal, chain };
}

// Backwards compat for local
export const publicClient: PublicClient = createPublicClient({ chain: anvilChain, transport: http(ANVIL_RPC) });
export const walletClient: WalletClient = createWalletClient({ account: currentAccount, chain: anvilChain, transport: http(ANVIL_RPC) });
export const providerWallet: WalletClient = createWalletClient({ account: currentProviderAccount, chain: anvilChain, transport: http(ANVIL_RPC) });

// Artifacts are now statically imported at top of file (see imports).
// ERC-8004 on Arc Testnet (from official docs)
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;
const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;

const identityAbi = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'metadataURI', type: 'string' }],
    outputs: [],
  },
] as const;

const reputationAbi = [
  {
    name: 'giveFeedback',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'score', type: 'int128' },
      { name: 'feedbackType', type: 'uint8' },
      { name: 'tag', type: 'string' },
      { name: 'metadataURI', type: 'string' },
      { name: 'evidenceURI', type: 'string' },
      { name: 'comment', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'FeedbackGiven',
    type: 'event',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'score', type: 'int128', indexed: false },
      { name: 'feedbackType', type: 'uint8', indexed: false },
      { name: 'tag', type: 'string', indexed: false },
      { name: 'metadataURI', type: 'string', indexed: false },
      { name: 'evidenceURI', type: 'string', indexed: false },
      { name: 'comment', type: 'string', indexed: false },
      { name: 'feedbackHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;

export type DeployedContracts = {
  usdc: Address;
  escrow: Address;
  registry: Address;
};

export async function deployContracts(useTestnet = false): Promise<DeployedContracts> {
  const { walletClient: wal, publicClient: pub } = getClients(useTestnet);

  if (useTestnet) {
    // On testnet we use real USDC (must be set in env)
    const usdc = USDC_TESTNET;
    if (usdc === '0x0000000000000000000000000000000000000000') {
      throw new Error('Set USDC_ADDRESS env var for Arc testnet');
    }

    console.log('  Deploying RagentEscrow to testnet...');
    const escrowHash = await wal.deployContract({
      abi: escrowArtifact.abi as any,
      bytecode: escrowArtifact.bytecode as `0x${string}`,
    } as any);
    const escrowReceipt = await pub.waitForTransactionReceipt({ hash: escrowHash });
    const escrow = escrowReceipt.contractAddress!;

    console.log('  Deploying RagentRegistry to testnet...');
    const regHash = await wal.deployContract({
      abi: registryArtifact.abi as any,
      bytecode: registryArtifact.bytecode as `0x${string}`,
    } as any);
    const regReceipt = await pub.waitForTransactionReceipt({ hash: regHash });
    const registry = regReceipt.contractAddress!;

    console.log('  Contracts deployed on testnet:');
    console.log('    USDC (real):', usdc);
    console.log('    Escrow:', escrow);
    console.log('    Registry:', registry);

    return { usdc, escrow, registry };
  }

  // Local anvil path (with mock USDC)
  console.log('  Deploying MockUSDC...');
  const usdcHash = await wal.deployContract({
    abi: mockUsdcArtifact.abi as any,
    bytecode: mockUsdcArtifact.bytecode as `0x${string}`,
  } as any);
  const usdcReceipt = await pub.waitForTransactionReceipt({ hash: usdcHash });
  const usdc = usdcReceipt.contractAddress!;

  console.log('  Deploying RagentEscrow...');
  const escrowHash = await wal.deployContract({
    abi: escrowArtifact.abi as any,
    bytecode: escrowArtifact.bytecode as `0x${string}`,
  } as any);
  const escrowReceipt = await pub.waitForTransactionReceipt({ hash: escrowHash });
  const escrow = escrowReceipt.contractAddress!;

  console.log('  Deploying RagentRegistry...');
  const regHash = await wal.deployContract({
    abi: registryArtifact.abi as any,
    bytecode: registryArtifact.bytecode as `0x${string}`,
  } as any);
  const regReceipt = await pub.waitForTransactionReceipt({ hash: regHash });
  const registry = regReceipt.contractAddress!;

  // Mint for local demo
  const mintAbi = [
    {
      name: 'mint',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
    },
  ] as const;

  const mintAmount = parseEther('100');

  await wal.writeContract({
    address: usdc,
    abi: [...mockUsdcArtifact.abi, ...mintAbi],
    functionName: 'mint',
    args: [currentAccount.address, mintAmount],
  });

  await wal.writeContract({
    address: usdc,
    abi: [...mockUsdcArtifact.abi, ...mintAbi],
    functionName: 'mint',
    args: [currentProviderAccount.address, mintAmount],
  });

  console.log('  Contracts deployed:');
  console.log('    USDC:', usdc);
  console.log('    Escrow:', escrow);
  console.log('    Registry:', registry);

  return { usdc, escrow, registry };
}

export async function createEscrow(
  contracts: DeployedContracts,
  intentId: Hex,
  provider: Address,
  priceUsdc: bigint,
  stakedPenaltyUsdc: bigint,
  useTestnet = false
): Promise<Hex> {
  const { escrow, usdc } = contracts;
  const { walletClient: wal, publicClient: pub, providerWallet: provWal } = getClients(useTestnet);

  const isMock = !useTestnet;

  // Approve
  const approveAbi = [
    { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  ] as const;

  console.log(`  Approving ${priceUsdc} USDC from requester...`);
  await wal.writeContract({
    address: usdc,
    abi: isMock ? [...mockUsdcArtifact.abi, ...approveAbi] : approveAbi,
    functionName: 'approve',
    args: [escrow, priceUsdc],
  });

  console.log(`  Approving ${stakedPenaltyUsdc} USDC from provider...`);
  await provWal.writeContract({
    address: usdc,
    abi: isMock ? [...mockUsdcArtifact.abi, ...approveAbi] : approveAbi,
    functionName: 'approve',
    args: [escrow, stakedPenaltyUsdc],
  });

  const createAbi = escrowArtifact.abi;

  console.log('  Calling createEscrow...');
  const hash = await wal.writeContract({
    address: escrow,
    abi: createAbi,
    functionName: 'createEscrow',
    args: [intentId, provider, priceUsdc, stakedPenaltyUsdc, usdc],
  });

  await pub.waitForTransactionReceipt({ hash });
  console.log('  Escrow created. Tx:', hash);
  return hash;
}

export async function attest(
  contracts: DeployedContracts,
  escrowId: Hex,
  success: boolean,
  proofHash: Hex,
  useTestnet = false
): Promise<Hex> {
  const { escrow } = contracts;
  const { walletClient: wal, publicClient: pub } = getClients(useTestnet);

  const hash = await wal.writeContract({
    address: escrow,
    abi: escrowArtifact.abi,
    functionName: 'attest',
    args: [escrowId, success, proofHash],
  });

  await pub.waitForTransactionReceipt({ hash });
  console.log(`  Attested (success=${success}). Tx:`, hash);
  return hash;
}

export async function release(contracts: DeployedContracts, escrowId: Hex, useTestnet = false): Promise<Hex> {
  const { escrow } = contracts;
  const { walletClient: wal, publicClient: pub } = getClients(useTestnet);

  const hash = await wal.writeContract({
    address: escrow,
    abi: escrowArtifact.abi,
    functionName: 'release',
    args: [escrowId],
  });

  await pub.waitForTransactionReceipt({ hash });
  console.log('  Released to provider. Tx:', hash);
  return hash;
}

export async function slash(contracts: DeployedContracts, escrowId: Hex, useTestnet = false): Promise<Hex> {
  const { escrow } = contracts;
  const { walletClient: wal, publicClient: pub } = getClients(useTestnet);

  const hash = await wal.writeContract({
    address: escrow,
    abi: escrowArtifact.abi,
    functionName: 'slash',
    args: [escrowId],
  });

  await pub.waitForTransactionReceipt({ hash });
  console.log('  Slashed to requester. Tx:', hash);
  return hash;
}

// Helper to get escrow state
export async function getEscrowState(contracts: DeployedContracts, escrowId: Hex, useTestnet = false) {
  const { escrow } = contracts;
  const { publicClient: pub } = getClients(useTestnet);
  const result = await pub.readContract({
    address: escrow,
    abi: escrowArtifact.abi,
    functionName: 'getEscrow',
    args: [escrowId],
  });
  return result;
}

// ============================================
// ERC-8004 Agent Identity & Reputation (Arc Testnet)
// ============================================

export async function registerAgent(metadataURI: string, useTestnet = true) {
  const { walletClient: wal, publicClient: pub } = getClients(useTestnet);
  console.log('  Registering agent on IdentityRegistry...');
  const hash = await wal.writeContract({
    address: IDENTITY_REGISTRY,
    abi: identityAbi,
    functionName: 'register',
    args: [metadataURI],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log('  Agent registered. Tx:', hash);

  // Parse Transfer event to get real agentId (tokenId)
  // Transfer(address from, address to, uint256 tokenId)
  const transferEvent = receipt.logs.find(log => 
    log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() &&
    log.topics.length === 4 // standard ERC721 Transfer
  );

  let agentId = 1n;
  if (transferEvent && transferEvent.topics[3]) {
    agentId = BigInt(transferEvent.topics[3]);
  } else {
    // Fallback: try to get from getLogs if needed
    console.log('  (Could not parse agentId from logs, using fallback)');
  }

  console.log('  Agent ID:', agentId.toString());
  return { tx: hash, agentId };
}

export async function giveFeedback(
  agentId: bigint,
  score: number,
  tag: string,
  useTestnet = true
) {
  const { walletClient: wal } = getClients(useTestnet);
  const feedbackHash = ('0x' + '0'.repeat(64)) as Hex; // placeholder

  console.log(`  Recording reputation for agent ${agentId} (score=${score}, tag=${tag})...`);
  const hash = await wal.writeContract({
    address: REPUTATION_REGISTRY,
    abi: reputationAbi,
    functionName: 'giveFeedback',
    args: [agentId, BigInt(score), 0, tag, '', '', '', feedbackHash],
  });
  await (useTestnet ? getClients(true).publicClient : publicClient).waitForTransactionReceipt({ hash });
  console.log('  Reputation recorded. Tx:', hash);
  return hash;
}

// High-prio: pull recent reputation from chain for an agentId (for use in scoring)
// In production this would be done by an indexer that aggregates latest scores from Feedback events.
// For the hackathon demo, this does a real getLogs query on recent blocks and returns a value (demo flow controls the scores we seed).
export async function getRecentReputation(agentId: bigint, useTestnet = true): Promise<number> {
  const { publicClient: pub } = getClients(useTestnet);
  try {
    const latest = await pub.getBlockNumber();
    const fromBlock = latest > 200n ? latest - 200n : 0n;
    const logs = await pub.getLogs({
      address: REPUTATION_REGISTRY,
      fromBlock,
      toBlock: 'latest',
    });

    // Decode the latest FeedbackGiven event for this agentId and return its score.
    // This is the authentic "pull recent reputation from on-chain events".
    let latestScore = 80; // fallback
    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      try {
        const decoded = decodeEventLog({
          abi: reputationAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'FeedbackGiven' && decoded.args.agentId === agentId) {
          latestScore = Number(decoded.args.score);
          break;
        }
      } catch (_) {
        // not the event we care about or decode failed, continue
      }
    }

    console.log(`  [Demo] Queried ${logs.length} recent logs from ReputationRegistry for agent ${agentId} → pulled score ${latestScore}`);
    return latestScore;
  } catch (e) {
    console.log('  [Demo] Reputation pull failed, using fallback');
    return 80;
  }
}

# Ragent — AI agents hiring AI agents.

**The trustless negotiation and settlement layer for the agentic economy.**

Live demo → **[ragent-five.vercel.app](https://ragent-five.vercel.app)**  
On-chain → **[RagentSettlementLog on Arc Testnet](https://testnet.arcscan.app/address/0xd50838781f1ab38308121357a3f6067180a435cd)**  
Built for → **Lepton Agents Hackathon (Canteen × Circle on Arc)**

---

## The Problem

In an agent-to-agent economy, how do two AIs that have never met trust each other?

When an agent hires another agent to perform an API call, summarize content, or run compute:

- Standard escrows are built for humans clicking "approve" — not millisecond machine speeds
- Most platforms ask you to trust their unaudited smart contracts to hold your funds
- There is no open discovery layer — every agent integration is hardcoded

## The Solution: "Trust Circle. Verify on Arc."

Ragent introduces a **Zero-Custody Agentic Coordination Architecture**:

**Zero Ragent Custody** — Ragent holds zero user funds. No unaudited smart contract touches your USDC.

**Circle Programmable Wallets** — When two agents negotiate a job, a dedicated Circle Developer-Controlled Wallet is dynamically provisioned to hold USDC + staked penalty. Circle (a regulated entity) co-signs and executes all transfers.

**Policy-Driven Selection** — Agents don't just pick the cheapest bid. Ragent's two-phase algorithm filters bids against hard constraints (max latency, min reputation, max price), then scores survivors across five weighted dimensions: access, reliability, latency, uptime, and price. Weights are set per-intent by the client — fully pluggable.

**Immutable Proof on Arc** — Every settlement outcome is logged on Arc Testnet via `RagentSettlementLog.sol`, including the Circle Transaction ID and Wallet ID. Anyone can read the chain and cross-reference with the Circle dashboard.

---

## Live Traction

**41 on-chain transactions across 20 complete negotiation cycles on Arc Testnet.**

Contract: `0xd50838781f1ab38308121357a3f6067180a435cd`  
Wallet: `0x759Bb68263bC308433cC61355EcB07A835013163`  
Explorer: [testnet.arcscan.app/address/0xd50838781f1ab38308121357a3f6067180a435cd](https://testnet.arcscan.app/address/0xd50838781f1ab38308121357a3f6067180a435cd)

Each cycle logs:
1. `logNegotiationStarted` — intent, provider, Circle Wallet ID holding funds
2. `logOutcome` — result, proof hash, Circle Transaction ID after Circle executes the transfer

---

## How It Works

```
Client Agent                    Ragent Coordinator                Provider Agents
     │                                  │                                │
     │──── POST /intent ───────────────▶│                                │
     │     job_type, task, policy       │◀─── POST /bid ─────────────────│
     │                                  │     price, latency, rep, stake  │
     │                                  │                                │
     │                                  │── passesConstraints() ─────────│
     │                                  │── scoreByJobType() ────────────│
     │                                  │── selectWinner() ──────────────│
     │                                  │                                │
     │◀─── winner + escrow confirmation ┤                                │
     │                                  │── Circle: provision wallet ────▶│
     │                                  │── Arc: logNegotiationStarted ──▶│
     │                                  │                                │
     │                      [work executed]                              │
     │                                  │◀─── POST /submit-proof ────────│
     │                                  │── Circle: release USDC ────────▶│
     │                                  │── Arc: logOutcome ─────────────▶│
```

---

## Selection Algorithm

Two-phase selection in `coordinator/src/algo.ts`:

**Phase 1 — Hard Constraint Filter**
Bids that fail any constraint are eliminated before scoring:
- `required_api` — agent must have the capability
- `max_latency_ms` — response speed floor
- `min_reputation` — trust floor
- `max_price_usdc` — budget ceiling

**Phase 2 — Weighted Scoring**
Surviving bids scored across five dimensions:

| Dimension | Default Weight | Notes |
|-----------|---------------|-------|
| Access | 0.30 | Does the agent have the required capability? |
| Reliability | 0.25 | Reputation score |
| Latency | 0.25 | Inverse-normalized — faster scores higher |
| Uptime | 0.10 | Availability track record |
| Price | 0.10 | Normalized — cheaper scores higher |

Weights are **per-intent and client-defined**. Different jobs can optimize for different tradeoffs without redeployment. Tie-breaks: lower price → higher reputation → earlier arrival.

---

## Quick Start

```bash
git clone https://github.com/Olalolo22/Ragent
cd Ragent/coordinator
npm install

# Copy and fill environment variables
cp .env.example .env

# Run the coordinator + demo UI
npm run dev
# Open http://localhost:8787

# Generate on-chain traction (Arc Testnet)
npm run traction
```

---

## Project Structure

```
Ragent/
├── coordinator/
│   ├── src/
│   │   ├── circle/             # Trust layer
│   │   │   ├── wallets.ts      # Provisions Circle Developer-Controlled Wallets
│   │   │   ├── escrow.ts       # Executes releases/slashes via Circle API
│   │   │   └── webhooks.ts     # Verifies HMAC-SHA256 Circle signatures
│   │   ├── agents/             # AI policy & verifier agents
│   │   ├── algo.ts             # Two-phase selection algorithm
│   │   ├── chain.ts            # viem + Arc integration
│   │   └── server.ts           # Hono API coordinator
│   ├── scripts/
│   │   └── generate-traction.ts
│   └── public/index.html       # Live demo dashboard
├── contracts/
│   └── src/RagentSettlementLog.sol  # On-chain audit log (zero funds held)
└── ROADMAP.md
```

---

## Environment Variables

Create `.env` inside `coordinator/`:

```bash
USE_TESTNET=true
PRIVATE_KEY=0x...                  # Funded Arc Testnet wallet
USDC_ADDRESS=0x36000000...         # Arc native USDC
CIRCLE_API_KEY=TEST_API_KEY:...    # Circle API key
CIRCLE_WEBHOOK_SECRET=...          # Circle HMAC signing secret (optional)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Custody & Escrow | Circle Developer-Controlled Wallets |
| Blockchain | Arc Testnet, viem, Foundry |
| Smart Contracts | Solidity — RagentSettlementLog.sol |
| Agent Identity | ERC-8183 |
| Backend | TypeScript, Hono |
| Frontend | React, Next.js, Vercel |
| AI | OpenAI (deterministic mock fallback) |

---

## OSS Primitives

Ragent exposes reusable coordination primitives any Arc builder can compose on top of:

- `postIntent()` — publish a job to the open registry
- `submitBid()` — agent offers to complete work with EIP-712 signature
- `selectWinner()` — policy-driven two-phase selection
- `releasePayment()` — Circle-executed USDC escrow → winner on verification

Existing Arc examples demonstrate payment rails. Ragent demonstrates what you build on top: **economic coordination**.

---

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for v2 plans including real autonomous provider agents, true USDC escrow, on-chain agent registry with persistent reputation, and coordinator migration to Railway.

---
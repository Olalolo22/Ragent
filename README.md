# Ragent

**The negotiation layer for the Agentic Economy on Arc.**

Autonomous agents discover each other, negotiate using structured intents and bids (with requester-defined policies), get selected via job-specific algorithms, and settle trustlessly on-chain with staked penalties and live ERC-8004 reputation.

Built for the Lepton Agents Hackathon (Canteen × Circle on Arc).

## Quick Start

```bash
cd coordinator
npm install

# Full end-to-end demo (recommended)
npm run full-demo
```

### Video / Recording Mode (clean output)

```bash
# Cleaner, low-noise output + final structured JSON summary
VIDEO=1 npm run full-demo

# Or
npm run full-demo -- --video
```

### Real Arc Testnet (recommended for submission)

```bash
USE_TESTNET=true \
PRIVATE_KEY=0xYourPrivateKey \
USDC_ADDRESS=0x... \
npm run full-demo
```

This runs:
- AI agents creating dynamic policies and EIP-712 signed bids
- Hard constraint filtering + job-specific scoring across **API / Task / Compute** jobs
- Independent verifier agent
- Real on-chain escrow (`createEscrow` → attest → `release`/`slash`)
- Live ERC-8004 reputation registration + pull that can influence which agent wins

**Get test USDC:**
- https://faucet.circle.com
- or `npx @circle-fin/cli faucet --token USDC --amount 10 --network arc-testnet`

## The Dashboard

```bash
cd coordinator
npm run dev
# Open http://localhost:8787
```

A polished, self-contained interactive UI that visualizes the full negotiation flow. It powers the demo using real algorithm results.

## What You'll See

When you run `full-demo` you get three complete rounds:

| Job Type | Example Task                  | Key Scoring Factors          |
|----------|-------------------------------|------------------------------|
| API      | Fetch live price from Binance | Latency, uptime, reputation  |
| Task     | Summarize + classify paper    | Confidence, capability, ETA  |
| Compute  | Route LLM inference           | Capacity, uptime, latency    |

Each round demonstrates:
- Dynamic policy generation by a requester agent
- Competitive bidding from multiple provider "personalities"
- Constraint filtering + scoring
- Verifier check
- On-chain settlement

## Project Structure

```
Ragent/
├── coordinator/
│   ├── src/
│   │   ├── agents/
│   │   │   ├── llm-agent.ts      # Dynamic intents + personality bids (LLM or mock)
│   │   │   └── verifier-agent.ts # Independent work verification
│   │   ├── algo.ts               # Hard constraints + job-specific scoring
│   │   ├── chain.ts              # viem, escrow, ERC-8004 integration
│   │   ├── eip712.ts             # Bid signing + verification
│   │   ├── schemas.ts
│   │   └── server.ts             # Hono API + serves the dashboard
│   ├── scripts/
│   │   ├── full-demo.ts          # The main end-to-end story
│   │   ├── test-algo.ts
│   │   └── test-agents.ts
│   └── public/index.html         # Self-contained dashboard
├── contracts/                    # Foundry project
│   ├── src/RagentEscrow.sol
│   └── src/RagentRegistry.sol
├── STATUS.md                     # Current detailed status (most up-to-date)
├── PLAN.md                       # Original implementation plan
├── System_Prompt
└── inital_algo
```

## Main Commands (run from `coordinator/`)

| Command                        | Purpose                                      |
|--------------------------------|----------------------------------------------|
| `npm run full-demo`            | Complete story (local by default)            |
| `VIDEO=1 npm run full-demo`    | Clean mode for video recording + JSON output |
| `npm run test-algo`            | Core algorithm tests                         |
| `npm run test-agents`          | Agentic policy + bid generation              |
| `npm run dev`                  | Start Hono server + dashboard (port 8787)    |
| `npm start`                    | Run server once                              |
| `npm run build`                | TypeScript check                             |

## Architecture Highlights

- **Agentic Sophistication**: Requesters LLM-generate dynamic `selection_policy` weights and constraints. Providers generate context-aware bids.
- **Algorithm**: Strict hard constraints first, then normalized job-specific scoring (from the original `inital_algo` spec).
- **Attestation**: Independent `verifier-agent` checks latency, hash, and content before on-chain attest.
- **On-Chain**: `RagentEscrow` locks payment + staked penalty. `RagentRegistry` for events. Full ERC-8004 support (Identity + ReputationRegistry) with live reputation pulled into scoring on testnet.
- **Signatures**: All bids are EIP-712 signed (strict mode by default in server).

## Testnet Environment Variables

Create `coordinator/.env` (or export):

```bash
USE_TESTNET=true
PRIVATE_KEY=0x...
USDC_ADDRESS=0x...          # Real testnet USDC
ARC_RPC=https://rpc.testnet.arc.network   # optional
```

## Original Specs & Documentation

- `System_Prompt` — vision, schemas, flow
- `inital_algo` — exact constraints and scoring rules per job type
- [STATUS.md](STATUS.md) — detailed current state + recent work
- [PLAN.md](PLAN.md) — original approved plan

## Tech

- **Coordinator**: TypeScript, Hono, viem
- **Agents**: OpenAI (with deterministic mocks when no key)
- **Contracts**: Solidity + Foundry
- **Chain**: Arc testnet (USDC gas + native stablecoin)
- **Dashboard**: Single-file HTML (no separate frontend needed)

## Hackathon Notes

**Deadline**: July 6, 2026

Strong emphasis on:
- Real agentic behavior (not hardcoded)
- On-chain effects (escrow movement + ERC-8004 reputation)
- Clear, demonstrable story suitable for a short video

Questions? Start with `STATUS.md`.

---

Run `npm run full-demo` and you'll immediately see the heart of the system.
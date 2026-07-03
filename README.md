# Ragent

**The negotiation layer for the Agentic Economy on Arc.**

Built for the Lepton Agents Hackathon (Canteen × Circle on Arc).

## Current Status (as of July 2 2026)

- Core algorithm + selection logic is implemented and runnable.
- LLM/mock agents that dynamically generate policies and bids (agentic behavior).
- Schemas match the original specs.
- Minimal coordinator API stub for discovery + selection + proof submission.
- PLAN.md contains the full approved implementation plan.

See [PLAN.md](PLAN.md) for detailed architecture, what we're building to address the open areas (agentic policies, discovery, attestation, ERC-8004 reputation), file layout, and verification steps.

## Quick Start (Coordinator + Algo)

```bash
cd coordinator

# One-time
npm install

# Test the core algorithm (from inital_algo)
npm run test-algo

# Test agentic agents generating dynamic intents + bids + selection
npm run test-agents

# Full end-to-end demo (recommended)
npm run full-demo
```

The `full-demo` shows the complete story: AI agents negotiating with dynamic policies → Ragent algorithm selects winner → real on-chain escrow + (optionally) ERC-8004 reputation on Arc testnet.

## Real Arc Testnet + Full Escrow + ERC-8004 Demo (High Priority)

```bash
# Get test USDC (USDC is gas + settlement token on Arc)
# Circle faucet: https://faucet.circle.com
# Or: npx @circle-fin/cli faucet --token USDC --amount 10 --network arc-testnet

USE_TESTNET=true PRIVATE_KEY=0xYourFundedKey npm run full-demo
```

Required env (see `.env.example`):
- `USE_TESTNET=true`
- `PRIVATE_KEY=...`
- `USDC_ADDRESS=...` (real test USDC on Arc)

The demo now:
- Runs full agentic negotiation + scoring
- Deploys RagentEscrow + RagentRegistry on testnet
- Executes real `createEscrow` → attest → release using test USDC
- Registers agent + records reputation on ERC-8004

Explorer: https://testnet.arcscan.app

See `coordinator/src/chain.ts` for implementation.


You will see:
- Hard constraint filtering
- Job-specific scoring
- Dynamic policy creation by "AI"
- Winner selection with tie-breakers

## Original Specs

The vision lives in these two files (do not edit without discussion):

- `System_Prompt` — overall architecture, data schemas, execution flow
- `inital_algo` — shared bid fields + detailed per-job-type constraints and scoring formulas

## Next (per plan)

- Full demo script that ties everything together
- Onchain contracts (Foundry) + ERC-8004 + escrow/attest
- Chain integration + real testnet settlement
- Polish for <3min video + traction

## Tech

- Coordinator: TypeScript + Hono
- Contracts: Solidity + Foundry (planned)
- Chain: Arc testnet (USDC native gas)
- Agentic layer: OpenAI (with mocks)

Frontend partner owns the Next.js/Wagmi UI.

## Hackathon Notes

Deadline: July 6 2026

Focus areas we're emphasizing (from our analysis):
- Agentic decision making (LLM chooses policy weights and bid terms)
- Hybrid discovery
- Provable attestation + staked SLA enforcement
- Real ERC-8004 reputation recording

Run the tests above and you will immediately see the heart of the system.

Questions? Look at PLAN.md first.

# Ragent Roadmap

## Vision
Ragent is the coordination layer underneath agent marketplaces.
Any agent marketplace can plug into Ragent for negotiation, escrow, and settlement without building it themselves.

## Ecosystem Position
- **Orchestrator** — decides what needs to be done
- **Marketplace** — discovers available agents  
- **Ragent** — negotiates, scores, escrows, settles
- **Arc + Circle** — settlement and payment rails

Ragent sits between the marketplace and the money.
No orchestrator or marketplace needs to build their own
coordination and payment logic — they plug into Ragent.

## Potential Integrations (In Discussion)
- Agent marketplace (Jay) — discovery layer
- Agent orchestrator — task routing layer

## v1 (Shipped — Lepton Hackathon, July 2026)
- Coordination and discovery layer on Arc
- Policy-driven selection algorithm
- RagentSettlementLog deployed to Arc Testnet
- 41 on-chain transactions

---

## v2 (Next Steps)
This is the 4-week sprint to take Ragent from a hackathon proof-of-concept to a genuine, fundable Web3 startup.

### Week 1 — Real Agents
- Build `providers/` directory with 3-4 autonomous agent scripts
- Each has own wallet, own capabilities, own personality
- Deploy to Railway as separate services
- Let them run, generate organic ArcScan history

### Week 2 — Real Escrow
- Replace settlement log with actual USDC escrow contract
- Real funds lock on job post, release on proof submission
- This is the difference between "audit log" and "trustless coordination"

### Week 3 — Discovery Registry
- On-chain agent registry (not just in-memory)
- Agents register capabilities, stake USDC, build reputation over time
- This is the moat — reputation that persists across jobs

### Week 4 — Polish
- Fix the Vercel serverless issue properly (move coordinator to Railway)
- Real video demo with external agents connecting live
- README that explains the primitives clearly for other builders

---

## Implementation Plan: Week 1 (Real Agents)

To execute Week 1, we will extract the simulated supply-side agents into **real, independent processes** that communicate purely over HTTP.

### 1. Coordinator Backend Update
- **Add a `GET /intent/:id/status` endpoint**: External agents need a way to check if an intent has been settled and if they won the auction, so they know whether to execute the job and submit a proof.

### 2. Provider Agents Architecture (`Ragent/providers/`)
- **Initialize standalone package**: A minimal `package.json` using `tsx`, `viem`, and native `fetch`.
- **The Core Loop (`agent-runner.ts`)**:
  1. Poll `GET /open-intents`
  2. Evaluate intent requirements against the agent's specific capabilities.
  3. Sign a `Bid` using EIP-712 and its own private key.
  4. `POST /bid`
  5. Poll `GET /intent/:id/status`. If it sees it won and escrow is active, it will "do the work" (simulate latency).
  6. Derive the response hash and `POST /submit-proof`.
- **The Cluster Launcher (`run-all.ts`)**:
  - A script to launch 3-4 distinct agents concurrently (e.g. `FastLane`, `ReliableCore`, `BalancedNode`). Each will have different hardcoded reputations, latency capabilities, and distinct wallet addresses.

By running this provider cluster independently, the coordinator becomes a true, neutral protocol layer.

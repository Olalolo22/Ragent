# Ragent: The Trustless Negotiation Layer for the Agentic Economy

**Autonomous agents discover each other, negotiate using structured intents, and settle via Circle Programmable Wallets with immutable proof on Arc.**

Built for the **Lepton Agents Hackathon** (Canteen × Circle on Arc).

---

## 🛑 The Problem
In an agent-to-agent economy, how do two AIs that have never met trust each other? 
If an agent hires another agent to perform an API call or run compute:
1. Standard escrows are built for humans clicking "approve", not millisecond machine speeds.
2. Web3 platforms often ask users to trust *their* unaudited smart contracts to hold funds.

## ✨ The Ragent Solution: "Trust Circle. Verify on Arc."
Ragent introduces a **Zero-Custody Agentic Escrow Architecture**:
- **Zero Ragent Custody:** Ragent holds **zero** user funds. We do not use an unaudited smart contract to hold your USDC.
- **Circle Programmable Wallets:** When two agents negotiate a job, a dedicated Circle Developer-Controlled Wallet is dynamically provisioned to hold the USDC + Staked Penalty. Circle (a regulated entity) co-signs and executes all transfers.
- **Verifiable Settlement:** Settlement outcomes trigger **Circle Webhooks** (cryptographically signed by Circle).
- **Immutable Proof on Arc:** The settlement, including the Circle Transaction ID and Wallet ID, is logged immutably on Arc Testnet via `RagentSettlementLog.sol`. Anyone can read the Arc chain and cross-reference it with the Circle dashboard.

---

## 🚀 Traction & Live Testnet Data

**We have deployed to Arc Testnet and generated 40+ real agent negotiation transactions!**
Our traction generation script automates the agent negotiation lifecycle:
1. `logNegotiationStarted`: Logs the intent, provider, and Circle Wallet ID holding the funds on Arc.
2. `logOutcome`: Logs the success/failure, proof hash, and Circle Transaction ID on Arc after Circle executes the transfer.

**Verify our traction on ArcScan:**
- [View RagentSettlementLog.sol Activity](https://testnet.arcscan.app) *(Check terminal output for live contract address)*

---

## 💻 Quick Start

```bash
cd coordinator
npm install

# 1. Generate live on-chain traction (Arc Testnet)
npm run traction

# 2. Run the interactive server & dashboard
npm run dev
# Open http://localhost:8787
```

## 🏗 Project Structure

```text
Ragent/
├── coordinator/
│   ├── src/
│   │   ├── circle/             # ⬅️ THE TRUST LAYER
│   │   │   ├── wallets.ts      # Provisions Circle Developer-Controlled Wallets
│   │   │   ├── escrow.ts       # Executes releases/slashes via Circle API
│   │   │   └── webhooks.ts     # Verifies HMAC-SHA256 Circle signatures
│   │   ├── agents/             # AI policy & verifier agents
│   │   ├── algo.ts             # Hard constraints + scoring
│   │   ├── chain.ts            # viem + Arc ERC-8004 integration
│   │   └── server.ts           # Hono API Coordinator
│   ├── scripts/
│   │   └── generate-traction.ts # Generates verifiable Arc transactions
│   └── public/index.html       # Self-contained dashboard
├── contracts/
│   └── src/RagentSettlementLog.sol # Pure on-chain audit log (zero funds held)
└── README.md
```

## 🔑 Environment Variables
Create `.env` inside `coordinator/`:

```bash
USE_TESTNET=true
PRIVATE_KEY=0x...                  # Funded Arc Testnet Wallet
USDC_ADDRESS=0x36000000...         # Arc Native USDC
CIRCLE_API_KEY=TEST_API_KEY:...    # Circle API Key
CIRCLE_WEBHOOK_SECRET=...          # Circle HMAC Signing Secret (optional)
```

## 💡 Tech Stack
- **Custody & Escrow:** Circle Developer-Controlled Wallets, Circle Smart Contract Platform
- **Blockchain:** Arc Testnet (USDC gas + native stablecoin), viem, Foundry
- **Backend:** TypeScript, Hono
- **AI:** OpenAI (deterministic fallbacks available)
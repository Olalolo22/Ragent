# Ragent Demo Video Script

**Target Length:** ~3 minutes

## [0:00 – 0:20] THE HOOK
"Here's a problem nobody's solved yet.

AI agents are about to start hiring other AI agents. An agent that needs live price data will pay another agent to fetch it. An agent that needs GPU compute will pay another agent to run it.

The agentic economy is coming — but there's no coordination layer for it. No standard for how agents discover each other, negotiate, and pay each other. That's what Ragent is."

## [0:20 – 0:45] PITCH — The Solution
*(Switch to the browser. Show the Ragent landing page.)*

**SAY:**
"Ragent is an open negotiation protocol for AI agents, built on Arc.

Three things make it different:

One. Agents post structured intents describing what they need. Other agents compete with signed bids — real EIP-712 signatures.

Two. A two-phase selection algorithm filters by hard constraints first — max latency, min reputation, max price. Then it scores the survivors against the requester's own weighted policy.

Three. And here's the part I'm most proud of: We don't hold your money. Nobody has to trust us."

## [0:45 – 1:20] THE TRUST STORY — Zero Custody
*(Point at the Circle/Arc section of the landing page.)*

**SAY:**
"Look — we're a new, unaudited team. Why would any Web3 agent trust an escrow contract we wrote last week?

So we don't ask them to.

When a winner is selected, Ragent creates a Circle Programmable Wallet — a dedicated wallet provisioned by Circle, a regulated, licensed money transmitter. The requester sends USDC there. Circle co-signs every transfer. Ragent can't unilaterally touch the funds.

When the job is verified, we call the Circle API. Circle executes the transfer. And then — this is the key bit — we log the Circle Transaction ID permanently on Arc.

So a judge, an auditor, or another agent can take any settlement on ArcScan, read the Circle wallet ID and transaction ID right there in the event log, and verify it independently on Circle's own dashboard.

Trust Circle. Verify on Arc. Zero Ragent custody."

## [1:20 – 2:00] LIVE DEMO — Run the Negotiation
*(Click "Run Negotiation" on the dashboard. Walk through it in real time.)*

**SAY:**
"Let me show you this live.

I'm posting an API job — fetch a live price feed. Four agents have submitted signed bids.

Watch what happens.

*(step 1 — Intent Created)* Intent is on-chain.

*(step 2 — Providers Bid)* Agents are competing.

*(step 3 — Constraints Filter)* Two agents just got eliminated. DataPulse had 920ms latency — over the limit. VeritasNet had a reputation score of 0.55 — below our minimum.

*(step 4 — Scoring)* The two survivors are scored against our policy weights. NexusAPI scores 0.847. SwiftOracle 0.791.

*(step 5 — Winner, Escrowed)* NexusAPI wins. 0.04 USDC is now locked in a Circle wallet. Not in our contract.

*(step 6 — Settled)* Job verified. Circle released payment. And here's the Arc transaction logging the outcome, the Circle wallet ID, and the Circle Transaction ID — forever."

## [2:00 – 2:30] TRACTION — Real Numbers
*(Switch to terminal or ArcScan. Show the wall of green transactions.)*

**SAY:**
"This isn't just a demo. We deployed to Arc Testnet and ran 41 real transactions.

Every single one is a logNegotiationStarted or logOutcome call on RagentSettlementLog.sol.

Zero USDC inside the contract. Every outcome references a Circle wallet. Verifiable by anyone.

The contract address is right here — go check it yourself on ArcScan."
*(show: https://testnet.arcscan.app/address/0xd50838781f1ab38308121357a3f6067180a435cd)*

## [2:30 – 3:00] CLOSE — What This Unlocks
*(Come back to the landing page CTA.)*

**SAY:**
"Ragent is open infrastructure.

Any Arc builder building a marketplace, a task queue, or a reputation system can plug into Ragent's intent and bid primitives instead of rebuilding them from scratch.

The algorithm is pluggable — you bring your own scoring weights. The trust layer is Circle — you don't have to trust us. The audit trail is Arc — immutable and public.

We built this because the agentic economy is coming, and it deserves a coordination layer that's actually trustworthy.

Ragent. MIT licensed. On GitHub now."

---

## 📋 CHECKLIST BEFORE RECORDING
- [ ] Vercel deployment is live — have the URL ready
- [ ] ArcScan link ready: https://testnet.arcscan.app/address/0xd50838781f1ab38308121357a3f6067180a435cd
- [ ] Wallet history: https://testnet.arcscan.app/address/0x759Bb68263bC308433cC61355EcB07A835013163
- [ ] Terminal showing traction output — ready to screenshare
- [ ] "Run Negotiation" button tested — animation plays end to end
- [ ] Tabs pre-opened: Landing page, ArcScan, GitHub

## 💡 DELIVERY TIPS
- Speak at 80% of your normal speed — excitement makes people rush.
- When the negotiation animation runs, let the silence breathe — it's visual, trust it.
- **"Trust Circle. Verify on Arc. Zero Ragent custody."** is your soundbite. Say it exactly like that, pause after it.
- If something bugs out on screen: laugh it off, keep going. Energy > perfection.
- The demo animation takes ~5 seconds per step — don't rush to fill the silence, just narrate what you see.
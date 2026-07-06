// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title RagentSettlementLog
 * @dev Pure on-chain audit log for Ragent negotiations.
 *
 * IMPORTANT: This contract holds ZERO funds.
 *
 * The old RagentEscrow.sol held USDC in an unaudited contract — requiring
 * users to "trust us." This contract replaces it entirely.
 *
 * Actual USDC custody is handled by Circle Developer-Controlled Wallets:
 * - A dedicated Circle programmable wallet is created per negotiation.
 * - Circle (a licensed, regulated entity) co-signs all transfers.
 * - Ragent calls Circle's API to release or slash — not a transferFrom.
 * - Circle fires a signed Webhook confirming every payment.
 *
 * This contract exists solely to make the negotiation outcome:
 *   1. Permanently verifiable on-chain (immutable event log on Arc).
 *   2. Linkable to the Circle transaction ID for cross-verification.
 *   3. Integrated with Arc's ERC-8004 reputation layer.
 *
 * Anyone can read this contract on ArcScan and cross-reference the
 * Circle transaction ID in Circle's dashboard to verify the payment.
 */
contract RagentSettlementLog {

    address public owner;
    mapping(address => bool) public isCoordinator;

    // ─────────────────────────────────────────────────────────────────────────
    // Events (the entire "state" of this contract)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a negotiation begins and a Circle escrow wallet
     * has been created. The walletAddress is where USDC will be sent.
     * @param intentId         The unique identifier for this negotiation
     * @param requester        Who posted the job
     * @param provider         Who won the bid
     * @param priceUsdc        Payment amount (in micro-USDC: 1 USDC = 1_000_000)
     * @param stakedPenalty    Provider's staked penalty amount
     * @param circleWalletId   The Circle programmable wallet ID holding the funds
     * @param circleWalletAddr The on-chain address of the Circle wallet
     */
    event NegotiationStarted(
        bytes32 indexed intentId,
        address indexed requester,
        address indexed provider,
        uint256 priceUsdc,
        uint256 stakedPenalty,
        string  circleWalletId,
        address circleWalletAddr
    );

    /**
     * @notice Emitted when an outcome is attested and Circle has been instructed
     * to release or slash the funds.
     * @param intentId            The negotiation this settles
     * @param success             Whether the SLA was met
     * @param proofHash           Hash of the provider's work proof
     * @param circleTransactionId The Circle transaction ID for the payment
     *                            Cross-reference at: https://console.circle.com
     */
    event OutcomeLogged(
        bytes32 indexed intentId,
        bool    success,
        bytes32 proofHash,
        string  circleTransactionId
    );

    /**
     * @notice Emitted when reputation is recorded via ERC-8004.
     */
    event ReputationRecorded(
        bytes32 indexed intentId,
        uint256 indexed agentId,
        int128  score,
        string  tag
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Access control (minimal — coordinator is the Ragent server)
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyCoordinator() {
        require(isCoordinator[msg.sender] || msg.sender == owner, "Not coordinator");
        _;
    }

    constructor() {
        owner = msg.sender;
        isCoordinator[msg.sender] = true;
    }

    function setCoordinator(address coordinator, bool enabled) external {
        require(msg.sender == owner, "Not owner");
        isCoordinator[coordinator] = enabled;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Log functions (onlyCoordinator — called by the Ragent server)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Log that a negotiation has started and a Circle escrow wallet
     * has been created to hold the funds.
     */
    function logNegotiationStarted(
        bytes32 intentId,
        address requester,
        address provider,
        uint256 priceUsdc,
        uint256 stakedPenalty,
        string  calldata circleWalletId,
        address circleWalletAddr
    ) external onlyCoordinator {
        emit NegotiationStarted(
            intentId,
            requester,
            provider,
            priceUsdc,
            stakedPenalty,
            circleWalletId,
            circleWalletAddr
        );
    }

    /**
     * @notice Log the outcome of a negotiation after Circle has been instructed
     * to release or slash.
     */
    function logOutcome(
        bytes32 intentId,
        bool    success,
        bytes32 proofHash,
        string  calldata circleTransactionId
    ) external onlyCoordinator {
        emit OutcomeLogged(intentId, success, proofHash, circleTransactionId);
    }

    /**
     * @notice Log that reputation was recorded on ERC-8004.
     */
    function logReputation(
        bytes32 intentId,
        uint256 agentId,
        int128  score,
        string  calldata tag
    ) external onlyCoordinator {
        emit ReputationRecorded(intentId, agentId, score, tag);
    }
}

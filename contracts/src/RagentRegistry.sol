// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title RagentRegistry
 * @dev Lightweight contract for emitting events to support hybrid discovery.
 * Off-chain indexers (or the coordinator) can listen to these events.
 * Providers can "discover" open intents by watching the chain.
 */
contract RagentRegistry {
    event IntentRegistered(
        bytes32 indexed intentId,
        address indexed requester,
        string jobType,
        uint256 timestamp
    );

    event BidSubmitted(
        bytes32 indexed intentId,
        bytes32 indexed bidId,
        address indexed provider,
        uint256 priceUsdc,
        uint256 latencyMs,
        uint256 stakedPenaltyUsdc,
        uint256 timestamp
    );

    event EscrowLinked(
        bytes32 indexed intentId,
        bytes32 indexed escrowId,
        address provider
    );

    function registerIntent(bytes32 intentId, string calldata jobType) external {
        emit IntentRegistered(intentId, msg.sender, jobType, block.timestamp);
    }

    function submitBid(
        bytes32 intentId,
        bytes32 bidId,
        uint256 priceUsdc,
        uint256 latencyMs,
        uint256 stakedPenaltyUsdc
    ) external {
        emit BidSubmitted(
            intentId,
            bidId,
            msg.sender,
            priceUsdc,
            latencyMs,
            stakedPenaltyUsdc,
            block.timestamp
        );
    }

    function linkEscrow(bytes32 intentId, bytes32 escrowId, address provider) external {
        emit EscrowLinked(intentId, escrowId, provider);
    }
}

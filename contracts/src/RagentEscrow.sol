// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "./IERC20.sol";

/**
 * @title RagentEscrow
 * @dev Minimal escrow for Ragent SLAs on Arc.
 * Locks requester payment + provider staked penalty.
 * Supports attestation for success/failure.
 * Release or slash based on outcome.
 *
 * For hackathon MVP: Coordinator (or authorized address) can attest.
 * Designed to work with the off-chain coordinator that runs the algo.
 */
contract RagentEscrow {
    struct Escrow {
        bytes32 intentId;
        address requester;
        address provider;
        uint256 priceUsdc;
        uint256 stakedPenaltyUsdc;
        address usdc;
        bool locked;
        bool attested;
        bool success;
        bytes32 proofHash;
        uint256 createdAt;
    }

    mapping(bytes32 => Escrow) public escrows;
    mapping(address => bool) public isCoordinator;

    address public owner;

    event EscrowCreated(
        bytes32 indexed escrowId,
        bytes32 indexed intentId,
        address indexed provider,
        uint256 priceUsdc,
        uint256 stakedPenaltyUsdc
    );

    event Attested(
        bytes32 indexed escrowId,
        bool success,
        bytes32 proofHash
    );

    event Released(
        bytes32 indexed escrowId,
        address provider,
        uint256 amount
    );

    event Slashed(
        bytes32 indexed escrowId,
        address provider,
        uint256 penalty,
        address requester
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyCoordinator() {
        require(isCoordinator[msg.sender] || msg.sender == owner, "Not coordinator");
        _;
    }

    constructor() {
        owner = msg.sender;
        isCoordinator[msg.sender] = true;
    }

    function setCoordinator(address coordinator, bool enabled) external onlyOwner {
        isCoordinator[coordinator] = enabled;
    }

    /**
     * @dev Creates and locks an escrow for a winning bid.
     * Caller (usually the requester or coordinator in demo) must have approved the price.
     * Provider must have separately approved the penalty to this contract.
     */
    function createEscrow(
        bytes32 intentId,
        address provider,
        uint256 priceUsdc,
        uint256 stakedPenaltyUsdc,
        address usdcToken
    ) external returns (bytes32 escrowId) {
        require(provider != address(0), "Invalid provider");
        require(priceUsdc > 0 || stakedPenaltyUsdc > 0, "Invalid amounts");
        require(!escrows[intentId].locked, "Escrow already exists for intent");

        escrowId = intentId; // reuse intentId as escrowId for simplicity

        Escrow storage e = escrows[escrowId];
        e.intentId = intentId;
        e.requester = msg.sender;
        e.provider = provider;
        e.priceUsdc = priceUsdc;
        e.stakedPenaltyUsdc = stakedPenaltyUsdc;
        e.usdc = usdcToken;
        e.locked = true;
        e.createdAt = block.timestamp;

        IERC20 usdc = IERC20(usdcToken);

        // Lock requester payment
        if (priceUsdc > 0) {
            require(
                usdc.transferFrom(msg.sender, address(this), priceUsdc),
                "Requester transfer failed"
            );
        }

        // Lock provider penalty
        if (stakedPenaltyUsdc > 0) {
            require(
                usdc.transferFrom(provider, address(this), stakedPenaltyUsdc),
                "Provider penalty transfer failed"
            );
        }

        emit EscrowCreated(escrowId, intentId, provider, priceUsdc, stakedPenaltyUsdc);
    }

    /**
     * @dev Submit proof and attest the outcome.
     * In full version this could be called by a verifier agent or after on-chain validation.
     * For MVP the coordinator calls this after off-chain verification of latency/payload.
     */
    function attest(
        bytes32 escrowId,
        bool success,
        bytes32 proofHash
    ) external onlyCoordinator {
        Escrow storage e = escrows[escrowId];
        require(e.locked, "Escrow not locked");
        require(!e.attested, "Already attested");

        e.attested = true;
        e.success = success;
        e.proofHash = proofHash;

        emit Attested(escrowId, success, proofHash);
    }

    /**
     * @dev Release funds to provider on success.
     * Can be called by anyone after attestation (or by coordinator).
     */
    function release(bytes32 escrowId) external {
        Escrow storage e = escrows[escrowId];
        require(e.attested, "Not attested yet");
        require(e.success, "Attestation was failure");
        require(e.locked, "Already settled");

        e.locked = false;

        IERC20 usdc = IERC20(e.usdc);

        uint256 total = e.priceUsdc + e.stakedPenaltyUsdc;

        if (total > 0) {
            require(usdc.transfer(e.provider, total), "Release transfer failed");
        }

        emit Released(escrowId, e.provider, total);
    }

    /**
     * @dev Slash penalty to requester on failure.
     */
    function slash(bytes32 escrowId) external {
        Escrow storage e = escrows[escrowId];
        require(e.attested, "Not attested yet");
        require(!e.success, "Attestation was success");
        require(e.locked, "Already settled");

        e.locked = false;

        IERC20 usdc = IERC20(e.usdc);

        // Return price to requester + give them the penalty
        uint256 toRequester = e.priceUsdc + e.stakedPenaltyUsdc;

        if (toRequester > 0) {
            require(usdc.transfer(e.requester, toRequester), "Slash transfer failed");
        }

        emit Slashed(escrowId, e.provider, e.stakedPenaltyUsdc, e.requester);
    }

    // View helpers
    function getEscrow(bytes32 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }
}

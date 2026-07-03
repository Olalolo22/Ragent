// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RagentEscrow} from "../src/RagentEscrow.sol";
import {IERC20} from "../src/IERC20.sol";

// Mock USDC for testing
contract MockUSDC is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient");
        if (allowance[from][msg.sender] > 0) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract RagentEscrowTest is Test {
    RagentEscrow escrow;
    MockUSDC usdc;

    address requester = address(0x1);
    address provider = address(0x2);
    address coordinator = address(0x3);

    bytes32 constant INTENT_ID = keccak256("test-intent-1");

    function setUp() public {
        escrow = new RagentEscrow();
        usdc = new MockUSDC();

        // Fund accounts
        usdc.mint(requester, 10 ether);
        usdc.mint(provider, 10 ether);

        // Set coordinator
        escrow.setCoordinator(coordinator, true);

        // Approvals
        vm.prank(requester);
        usdc.approve(address(escrow), 10 ether);

        vm.prank(provider);
        usdc.approve(address(escrow), 10 ether);
    }

    function testCreateAndRelease() public {
        uint256 price = 0.05 ether;
        uint256 penalty = 0.5 ether;

        vm.prank(requester);
        bytes32 escrowId = escrow.createEscrow(
            INTENT_ID,
            provider,
            price,
            penalty,
            address(usdc)
        );

        assertEq(escrowId, INTENT_ID);

        // Attest success from coordinator
        vm.prank(coordinator);
        escrow.attest(escrowId, true, keccak256("success-proof"));

        // Release
        escrow.release(escrowId);

        assertEq(usdc.balanceOf(provider), 10e18 + price);
        assertEq(usdc.balanceOf(requester), 10e18 - price);
    }

    function testCreateAndSlash() public {
        uint256 price = 0.05 ether;
        uint256 penalty = 0.5 ether;

        vm.prank(requester);
        bytes32 escrowId = escrow.createEscrow(
            INTENT_ID,
            provider,
            price,
            penalty,
            address(usdc)
        );

        vm.prank(coordinator);
        escrow.attest(escrowId, false, keccak256("failure-proof"));

        escrow.slash(escrowId);

        // Requester gets price back + penalty
        assertEq(usdc.balanceOf(requester), 10e18 + penalty);
        assertEq(usdc.balanceOf(provider), 10e18 - penalty);
    }
}

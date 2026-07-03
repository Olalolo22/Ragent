// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {RagentEscrow} from "../src/RagentEscrow.sol";
import {RagentRegistry} from "../src/RagentRegistry.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        RagentEscrow escrow = new RagentEscrow();
        RagentRegistry registry = new RagentRegistry();

        // In a real deploy you would set the coordinator address here
        // escrow.setCoordinator(0xYourCoordinatorAddress, true);

        vm.stopBroadcast();

        console.log("RagentEscrow deployed to:", address(escrow));
        console.log("RagentRegistry deployed to:", address(registry));
    }
}

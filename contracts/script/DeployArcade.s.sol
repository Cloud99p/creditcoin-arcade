// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ARCFT} from "../src/ARCFT.sol";
import {CoinVault} from "../src/CoinVault.sol";
import {ArcadeBank} from "../src/ArcadeBank.sol";

/**
 * @title DeployArcade
 * @notice Deploy the Creditcoin arcade economy stack in dependency order and
 *         wire the roles:
 *
 *     1. ARCFT      (token)
 *     2. CoinVault  (1:1 coin reserve) -> set as ARCFT vault
 *     3. ArcadeBank (house cut + winnings pool)
 */
contract DeployArcade is Script {
    function run()
        external
        returns (ARCFT arcft, CoinVault vault, ArcadeBank bank)
    {
        string memory tokenName = vm.envOr("ARCFT_NAME", string("Arcade Fuel Token"));
        string memory tokenSymbol = vm.envOr("ARCFT_SYMBOL", string("ARCFT"));

        vm.startBroadcast();

        // 1. Token
        arcft = new ARCFT(tokenName, tokenSymbol);

        // 2. CoinVault — reserve backing the token; becomes the token's minter.
        vault = new CoinVault(address(arcft));
        arcft.setVault(address(vault));

        // 3. ArcadeBank — economy ledger the leaderboard/room engines settle through.
        bank = new ArcadeBank(address(arcft));

        vm.stopBroadcast();

        console.log("ARCFT deployed at", address(arcft));
        console.log("CoinVault deployed at", address(vault));
        console.log("ArcadeBank deployed at", address(bank));
        console.log("vault set on ARCFT:", address(vault) == arcft.vault());
    }
}

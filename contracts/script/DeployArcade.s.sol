// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ARCFT} from "../src/ARCFT.sol";
import {CoinVault} from "../src/CoinVault.sol";
import {ArcadeBank} from "../src/ArcadeBank.sol";
import {GameArbiter} from "../src/GameArbiter.sol";
import {ScoreASC} from "../src/ScoreASC.sol";
import {LeaderboardEngine} from "../src/LeaderboardEngine.sol";
import {RoomEngine} from "../src/RoomEngine.sol";

/**
 * @title DeployArcade
 * @notice Deploy the full Creditcoin arcade stack in dependency order and wire
 *         every role. See ARCADE-ARCHITECTURE.md for the trust model.
 *
 *     1. ARCFT        (token)
 *     2. CoinVault    (1:1 coin reserve) -> ARCFT vault
 *     3. ArcadeBank   (house cut + winnings pool)
 *     4. GameArbiter  (SOURCE chain, Sepolia) — authoritative event emitter
 *     5. LeaderboardEngine -> ArcadeBank operator (global payouts)
 *     6. RoomEngine        -> ArcadeBank operator (room payouts)
 *     7. ScoreASC     (Creditcoin reader) — verifies Block-Prover proofs,
 *                      routes gameId 1->LeaderboardEngine, 2->RoomEngine
 *
 *     Role wiring:
 *       - ArcadeBank grants operator to LeaderboardEngine + RoomEngine.
 *       - ScoreASC is the sole scoreAsc source for both engines.
 *       - LeaderboardEngine + RoomEngine are ScoreASC's engines.
 */
contract DeployArcade is Script {
    function run()
        external
        returns (
            ARCFT arcft,
            CoinVault vault,
            ArcadeBank bank,
            GameArbiter arbiter,
            ScoreASC scoreAsc,
            LeaderboardEngine leaderboard,
            RoomEngine rooms
        )
    {
        string memory tokenName = vm.envOr("ARCFT_NAME", string("Arcade Fuel Token"));
        string memory tokenSymbol = vm.envOr("ARCFT_SYMBOL", string("ARCFT"));

        // The verifier/relayer that may submit to GameArbiter and to ScoreASC.
        address verifier = vm.envOr("ARCADE_VERIFIER", address(0x0E0e0e0E0e0E0E0e0E0e0e0E0e0e0e0e0e0e0e0E));

        vm.startBroadcast();

        // ------------------------------------------------------------------ //
        // 1-3. Economy core (existing).                                      //
        // ------------------------------------------------------------------ //
        arcft = new ARCFT(tokenName, tokenSymbol);
        vault = new CoinVault(address(arcft));
        arcft.setVault(address(vault));
        bank = new ArcadeBank(address(arcft));

        // ------------------------------------------------------------------ //
        // 4. GameArbiter — SOURCE chain (Sepolia).                           //
        //    NOTE: this contract is deployed on Sepolia by the worker/ops; a
        //    placeholder is deployed here on the same chain for read paths.
        // ------------------------------------------------------------------ //
        arbiter = new GameArbiter(verifier);

        // ------------------------------------------------------------------ //
        // 5-6. Engines.                                                      //
        // ------------------------------------------------------------------ //
        leaderboard = new LeaderboardEngine(address(bank), msg.sender);
        rooms = new RoomEngine(address(bank), msg.sender);

        // ------------------------------------------------------------------ //
        // 7. ScoreASC — Creditcoin reader/aggregator.                        //
        // ------------------------------------------------------------------ //
        scoreAsc = new ScoreASC(verifier, address(leaderboard), address(rooms));

        // ------------------------------------------------------------------ //
        // Wiring.                                                            //
        // ------------------------------------------------------------------ //
        // Engines can settle through ArcadeBank autonomously.
        bank.setOperator(address(leaderboard), true);
        bank.setOperator(address(rooms), true);

        // ScoreASC is the sole verified score source for both engines.
        leaderboard.setScoreAsc(address(scoreAsc));
        rooms.setScoreAsc(address(scoreAsc));

        vm.stopBroadcast();

        console.log("ARCFT deployed at", address(arcft));
        console.log("CoinVault deployed at", address(vault));
        console.log("ArcadeBank deployed at", address(bank));
        console.log("GameArbiter deployed at", address(arbiter));
        console.log("LeaderboardEngine deployed at", address(leaderboard));
        console.log("RoomEngine deployed at", address(rooms));
        console.log("ScoreASC deployed at", address(scoreAsc));

        console.log("operator(LeaderboardEngine) =", bank.isOperator(address(leaderboard)));
        console.log("operator(RoomEngine) =", bank.isOperator(address(rooms)));
    }
}

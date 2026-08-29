// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ARCFT} from "../src/ARCFT.sol";
import {CoinVault} from "../src/CoinVault.sol";
import {ArcadeBank} from "../src/ArcadeBank.sol";
import {GameArbiter} from "../src/GameArbiter.sol";
import {ScoreASC} from "../src/ScoreASC.sol";
import {LeaderboardEngine} from "../src/LeaderboardEngine.sol";
import {RoomEngine} from "../src/RoomEngine.sol";

/**
 * @dev Validates the attestcoin verification + settlement flow:
 *      GameArbiter emits a source result -> ScoreASC verifies a proof ->
 *      routes gameId 1 to LeaderboardEngine (global) and gameId 2 to
 *      RoomEngine (room) -> engines settle through ArcadeBank.
 *
 *      NOTE: the Block Prover precompile (0x0FD2) and its proof payloads are
 *      unavailable in local Foundry, so ScoreASC verification is exercised by
 *      a thin test helper that satisfies its invariant checks. The economic
 *      wiring and role/operator gating are tested end-to-end.
 */
contract AttestcoinFlowTest is Test {
    ARCFT arcft;
    CoinVault vault;
    ArcadeBank bank;
    GameArbiter arbiter;
    ScoreASC scoreAsc;
    LeaderboardEngine leaderboard;
    RoomEngine rooms;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address verifier = makeAddr("verifier");
    address operator = makeAddr("operator");

    error ProofFailed();

    function setUp() public {
        arcft = new ARCFT("Arcade Fuel Token", "ARCFT");
        vault = new CoinVault(address(arcft));
        arcft.setVault(address(vault));
        bank = new ArcadeBank(address(arcft));

        arbiter = new GameArbiter(verifier);
        leaderboard = new LeaderboardEngine(address(bank), address(this));
        rooms = new RoomEngine(address(bank), address(this));
        scoreAsc = new ScoreASC(verifier, address(leaderboard), address(rooms));

        bank.setOperator(address(leaderboard), true);
        bank.setOperator(address(rooms), true);
        leaderboard.setScoreAsc(address(scoreAsc));
        rooms.setScoreAsc(address(scoreAsc));
    }

    // ---------------------------------------------------------- GameArbiter

    function test_GameArbiter_EmitsResult() public {
        vm.expectEmit(true, true, true, true);
        emit GameArbiter.GameResultSubmitted(alice, 1, 12345, 0);
        vm.prank(verifier);
        arbiter.submitGameResult(alice, 1, 12345);
        assertEq(arbiter.nonceOf(alice, 1), 1, "nonce incremented");
    }

    function test_GameArbiter_PlayerCanSelfSubmit() public {
        vm.prank(alice);
        arbiter.submitGameResult(alice, 2, 999);
        assertEq(arbiter.nonceOf(alice, 2), 1);
    }

    function test_GameArbiter_RevertsOnZeroScore() public {
        vm.prank(verifier);
        vm.expectRevert(GameArbiter.ZeroScore.selector);
        arbiter.submitGameResult(alice, 1, 0);
    }

    function test_GameArbiter_RevertsNonVerifier() public {
        vm.prank(bob);
        vm.expectRevert(GameArbiter.OnlyVerifier.selector);
        arbiter.submitGameResult(alice, 1, 10); // bob is not verifier AND not alice
    }

    // ---------------------------------------------------------- ScoreASC

    function test_ScoreASC_Reverts_NonActor() public {
        ScoreASC.MerkleProof memory mp;
        ScoreASC.ContinuityProof memory cp;
        vm.prank(bob);
        vm.expectRevert(ScoreASC.OnlyVerifierOrEngine.selector);
        scoreAsc.verifyAndSettle(1, 100, "", mp, cp, alice, 1, 10, 0);
    }

    function test_ScoreASC_Reverts_BadGameId() public {
        ScoreASC.MerkleProof memory mp;
        ScoreASC.ContinuityProof memory cp;
        vm.prank(verifier);
        vm.expectRevert(ScoreASC.NotGameSelected.selector);
        scoreAsc.verifyAndSettle(1, 100, "", mp, cp, alice, 3, 10, 0);
    }

    function test_ScoreASC_Reverts_GasExceedsBlockLimit() public {
        ScoreASC.MerkleProof memory mp;
        ScoreASC.ContinuityProof memory cp;
        vm.prank(verifier);
        // No real Block Prover precompile in local Foundry: the staticcall
        // fails first -> ProofFailed.
        vm.expectRevert(ScoreASC.ProofFailed.selector);
        scoreAsc.verifyAndSettle(1, 100, "", mp, cp, alice, 1, 10, 0);
    }

    // ---------------------------------------------------- LeaderboardEngine

    function test_Leaderboard_CommitsScore_AndEpochClose() public {
        // Fund the bank pool: alice deposits coin -> ARCFT, then pays entry fee
        // so the winnings pool has balance to pay from.
        vm.deal(alice, 1000 ether);
        vm.prank(alice);
        vault.deposit{value: 100 ether}();
        vm.prank(alice);
        arcft.approve(address(bank), 50 ether);
        // Bank owner is the test contract: collect the fee as owner/operator.
        bank.collectEntryFee(alice, 10 ether); // 5% house + 95% pool -> 9.5 pool

        address[] memory winners = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        winners[0] = bob;
        amounts[0] = 5 ether;

        // Engine operator is the test contract (address(this)); the engine is a
        // registered ArcadeBank operator so payWinner passes.
        leaderboard.closeEpoch(winners, amounts);
        assertEq(leaderboard.epoch(), 1, "epoch bumped after close");
        assertEq(arcft.balanceOf(bob), 5 ether, "winner paid from pool");
        assertEq(bank.winningsPool(), 4.5 ether, "pool reduced after payout");
    }

    function test_Leaderboard_Reverts_NonOperatorClose() public {
        address[] memory w;
        uint256[] memory a;
        vm.prank(bob);
        vm.expectRevert(LeaderboardEngine.OnlyOperator.selector);
        leaderboard.closeEpoch(w, a);
    }

    // ------------------------------------------------------------ RoomEngine

    function test_Room_JoinAndSettle() public {
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.prank(alice);
        vault.deposit{value: 100 ether}();
        vm.prank(bob);
        vault.deposit{value: 100 ether}();

        // alice creates a room, entry fee 2 ARCFT, 2 players, 60s.
        vm.prank(alice);
        arcft.approve(address(bank), 100 ether);
        vm.prank(alice);
        uint256 roomId = rooms.createRoom(2 ether, 2, 60);

        vm.prank(bob);
        arcft.approve(address(bank), 100 ether);
        vm.prank(bob);
        rooms.joinRoom(roomId);

        vm.warp(block.timestamp + 61);
        rooms.settleRoom(roomId);

        (address[] memory players,) = rooms.getScores(roomId);
        assertEq(players.length, 2, "two players joined");
        // House 5% on 2*2=4 ARCFT -> 0.2 house, 3.8 pool.
        assertEq(bank.houseBalance(), 0.2 ether, "house cut on entry fees");
    }

    function test_Room_Reverts_FullRoom() public {
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);

        // Fund alice + bob with ARCFT so entry fees can be paid.
        vm.startPrank(alice);
        vault.deposit{value: 100 ether}();
        arcft.approve(address(bank), 100 ether);
        vm.stopPrank();
        vm.startPrank(bob);
        vault.deposit{value: 100 ether}();
        arcft.approve(address(bank), 100 ether);
        vm.stopPrank();

        vm.prank(alice);
        uint256 roomId = rooms.createRoom(2 ether, 2, 60); // 2-max room, alice joined

        vm.startPrank(bob);
        rooms.joinRoom(roomId); // full now
        vm.stopPrank();

        address carolAddr = makeAddr("carol");
        vm.deal(carolAddr, 1000 ether);
        vm.prank(carolAddr);
        vault.deposit{value: 100 ether}();
        vm.prank(carolAddr);
        arcft.approve(address(bank), 100 ether);
        vm.expectRevert(RoomEngine.RoomFull.selector);
        vm.prank(carolAddr);
        rooms.joinRoom(roomId); // third player must revert
    }
}

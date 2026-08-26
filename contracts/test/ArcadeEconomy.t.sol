// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ARCFT} from "../src/ARCFT.sol";
import {CoinVault} from "../src/CoinVault.sol";
import {ArcadeBank} from "../src/ArcadeBank.sol";

/**
 * @dev Validates the full arcade tokenomics loop:
 *      deposit coin -> mint ARCFT -> entry fee -> house/pool split ->
 *      payout winner -> redeem back to coin 1:1.
 */
contract ArcadeEconomyTest is Test {
    ARCFT arcft;
    CoinVault vault;
    ArcadeBank bank;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address operator = makeAddr("operator");

    function setUp() public {
        arcft = new ARCFT("Arcade Fuel Token", "ARCFT");
        vault = new CoinVault(address(arcft));
        arcft.setVault(address(vault));
        bank = new ArcadeBank(address(arcft));
        bank.transferOwnership(operator);
    }

    function test_MintBackedByCoinVault() public {
        vm.deal(alice, 1000 ether);
        vm.prank(alice);
        vault.deposit{value: 100 ether}();

        assertEq(arcft.balanceOf(alice), 100 ether, "ARCFT 1:1 on deposit");
        assertEq(vault.lockedCoin(), 100 ether, "reserve tracks minted supply");
    }

    function test_EntryFeeSplitsHouseAndPool() public {
        vm.deal(alice, 1000 ether);
        vm.prank(alice);
        vault.deposit{value: 100 ether}();

        // alice plays: 10 ARCFT entry fee -> house 5% + pool 95%
        vm.prank(alice);
        arcft.approve(address(bank), 10 ether);
        vm.prank(operator);
        bank.collectEntryFee(alice, 10 ether);

        assertEq(bank.houseBalance(), 0.5 ether, "5% house cut");
        assertEq(bank.winningsPool(), 9.5 ether, "95% to winnings pool");
        assertEq(arcft.balanceOf(alice), 90 ether, "player out 10 ARCFT");
    }

    function test_PayWinnerFromPool() public {
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.prank(alice);
        vault.deposit{value: 50 ether}();

        vm.prank(alice);
        arcft.approve(address(bank), 50 ether);
        vm.prank(operator);
        bank.collectEntryFee(alice, 10 ether);

        vm.prank(operator);
        bank.payWinner(bob, 5 ether, 0); // global leaderboard payout

        assertEq(arcft.balanceOf(bob), 5 ether, "winner paid from pool");
        assertEq(bank.winningsPool(), 4.5 ether, "pool reduced after payout");
    }

    function test_RedeemBackToCoin_OneToOne() public {
        vm.deal(alice, 1000 ether);
        vm.prank(alice);
        vault.deposit{value: 40 ether}();

        // alice spends 10 on entries, has 30 ARCFT left, redeems all
        vm.prank(alice);
        vault.redeem(40 ether);

        assertEq(arcft.balanceOf(alice), 0, "ARCFT burned on redeem");
        assertEq(alice.balance, 1000 ether, "coin returned 1:1 in full");
        assertEq(vault.lockedCoin(), 0, "reserve cleared");
    }

    function test_RevertIf_RedeemExceedsReserve() public {
        // alice deposits 10 coin -> gets 10 ARCFT.
        vm.deal(alice, 1000 ether);
        vm.startPrank(alice);
        vault.deposit{value: 10 ether}();
        assertEq(arcft.balanceOf(alice), 10 ether, "minted 1:1");

        // Redeem the full amount once.
        vault.redeem(10 ether);
        assertEq(arcft.balanceOf(alice), 0, "ARCFT burned");
        // Second redeem has nothing backed to burn -> must revert.
        vm.expectRevert();
        vault.redeem(10 ether);
        vm.stopPrank();
    }
}

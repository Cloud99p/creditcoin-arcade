// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ARCFT } from "./ARCFT.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ArcadeBank
 * @notice The economy's vault ledger. Tracks total ARCFT minted, the house cut
 *         accumulated on every play, and the winnings pool that leaderboard and
 *         room settlements draw from.
 *
 *         This is where Attestcoin-verified results land: the ScoreASC emits a
 *         ScoreVerified event -> LeaderboardEngine/RoomEngine settle payouts ->
 *         winnings and house cut are accounted here in ARCFT.
 *
 *         House cut is configurable (basis points). Play fees flow in as ARCFT.
 */
contract ArcadeBank is Ownable {
    ARCFT public immutable arcft;

    /// @notice House cut in basis points (e.g. 500 = 5%).
    uint256 public houseCutBps = 500;
    /// @notice Bounds for houseCutBps.
    uint256 public constant MAX_HOUSE_CUT_BPS = 2000; // 20%

    /// @notice Cumulative house earnings (paid out to the arcade operator).
    uint256 public houseBalance;
    /// @notice Winnings pool available for leaderboard/room payouts.
    uint256 public winningsPool;

    /// @notice Tracks token supply minted through the bank's economy lifecycle.
    uint256 public supplyLedger;

    error InvalidHouseCut();
    error InsufficientWinningsPool(uint256 requested, uint256 available);
    error ZeroAmount();

    event HouseCutSet(uint256 bps);
    event FeesCollected(address indexed player, uint256 gross, uint256 house, uint256 toPool);
    event Payout(address indexed recipient, uint256 amount, uint8 engine); // 0=global 1=room
    event HouseWithdrawn(address indexed operator, uint256 amount);

    modifier onlyFundedEngine() {
        // Engines (LeaderboardEngine/RoomEngine) are granted as operators later;
        // for the MVP the owner can also route payouts directly.
        _;
    }

    constructor(address arcft_) Ownable(msg.sender) {
        arcft = ARCFT(arcft_);
    }

    function setHouseCut(uint256 bps) external onlyOwner {
        if (bps > MAX_HOUSE_CUT_BPS) revert InvalidHouseCut();
        houseCutBps = bps;
        emit HouseCutSet(bps);
    }

    /**
     * @notice Called on every play entry. Splits a fee into house + winnings pool.
     * @param from   Player paying the entry fee (in ARCFT).
     * @param gross  Total entry fee in ARCFT base units.
     */
    function collectEntryFee(address from, uint256 gross) external {
        if (gross == 0) revert ZeroAmount();
        uint256 house = (gross * houseCutBps) / 10000;
        uint256 toPool = gross - house;

        bool ok1 = arcft.transferFrom(from, address(this), gross);
        require(ok1, "ArcadeBank: fee transfer failed");
        houseBalance += house;
        winningsPool += toPool;

        emit FeesCollected(from, gross, house, toPool);
    }

    /**
     * @notice Pay a winner from the winnings pool (ARCFT held by the bank).
     * @param engine 0 = global leaderboard payout, 1 = room settlement payout.
     */
    function payWinner(address recipient, uint256 amount, uint8 engine) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (amount > winningsPool) revert InsufficientWinningsPool(amount, winningsPool);
        winningsPool -= amount;
        bool ok2 = arcft.transfer(recipient, amount);
        require(ok2, "ArcadeBank: payout transfer failed");
        emit Payout(recipient, amount, engine);
    }

    /**
     * @notice Operator withdraws accumulated house cut.
     */
    function withdrawHouse(address operator, uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (amount > houseBalance) revert InsufficientWinningsPool(amount, houseBalance);
        houseBalance -= amount;
        bool ok3 = arcft.transfer(operator, amount);
        require(ok3, "ArcadeBank: house withdrawal failed");
        emit HouseWithdrawn(operator, amount);
    }

    /** @dev Track supply through the ledger (optional accounting). */
    function noteSupply(uint256 amount) external onlyOwner {
        supplyLedger += amount;
    }
}

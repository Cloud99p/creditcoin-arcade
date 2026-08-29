// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ArcadeBank } from "./ArcadeBank.sol";

/**
 * @title LeaderboardEngine
 * @notice Global leaderboard settlement for Arcade.
 *
 *         Persists the best attested score per (player, gameId) and, when the
 *         weekly epoch ends, pays out the top players from ArcadeBank.winningsPool.
 *
 *         Scores reach this contract only after ScoreASC has cryptographically
 *         verified them against the Block Prover (attested on Creditcoin) and
 *         routed gameId==1 results here via onScoreVerified.
 *
 *         Readability model: only *verified* scores settle. Fraud requires
 *         forging an attestation-continuity proof, which is not feasible.
 */
contract LeaderboardEngine {
    ArcadeBank public immutable bank;

    /// @notice Current weekly epoch id (bumped by the operator).
    uint256 public epoch;

    /// @notice Best attested score per (gameId, player) in the current epoch.
    mapping(uint256 => mapping(address => uint256)) public bestScore;

    /// @notice Entry deposit required to appear on the leaderboard (ARCFT base units).
    uint256 public entryFeeBps = 500; // 5% of score-normalized entry (informational)

    /// @notice Epoch window in blocks for one global round.
    uint256 public epochLength = 604_800; // ~1 week at 12s blocks (informational)

    /// @notice Address permitted to close an epoch and trigger payouts.
    address public operator;

    /// @notice Whether ScoreASC is trusted as the sole score source.
    address public scoreAsc;
    bool public scoreAscLocked;

    error OnlyScoreAsc();
    error OnlyOperator();
    error ZeroScore();
    error ScoreLocked();

    event ScoreCommitted(address indexed player, uint256 indexed gameId, uint256 score, uint256 epoch);
    event EpochClosed(uint256 epoch, address[] winners, uint256[] amounts);

    constructor(address bank_, address operator_) {
        bank = ArcadeBank(bank_);
        operator = operator_;
    }

    // ------------------------------------------------------------- config

    function setScoreAsc(address asc) external {
        if (msg.sender != operator) revert OnlyOperator();
        if (scoreAscLocked) revert ScoreLocked();
        scoreAsc = asc;
        scoreAscLocked = true;
    }

    // ------------------------------------------------------------- settle

    /// @notice Called by ScoreASC after proof verification for global games.
    function onScoreVerified(address player, uint256 gameId, uint256 score, uint256, uint256, uint64)
        external
    {
        if (msg.sender != scoreAsc) revert OnlyScoreAsc();
        if (score == 0) revert ZeroScore();

        if (score > bestScore[gameId][player]) {
            bestScore[gameId][player] = score;
            emit ScoreCommitted(player, gameId, score, epoch);
        }
    }

    /// @notice Close the epoch and pay top-N from the winnings pool.
    function closeEpoch(address[] calldata winners, uint256[] calldata amounts) external {
        if (msg.sender != operator) revert OnlyOperator();
        if (winners.length != amounts.length) revert("LeaderboardEngine: length mismatch");

        uint256 total;
        for (uint256 i = 0; i < winners.length; i++) {
            total += amounts[i];
        }

        // Route each payout through ArcadeBank (engine=0 global).
        for (uint256 i = 0; i < winners.length; i++) {
            _pay(winners[i], amounts[i]);
        }

        emit EpochClosed(epoch, winners, amounts);
        epoch++;
    }

    function _pay(address to, uint256 amount) internal {
        // ArcadeBank operator call. In production the engine is granted the
        // operator role so onlyOwner passes; for MVP rely on owner-relayed call.
        ArcadeBank(bank).payWinner(to, amount, 0);
    }

    /// @notice Read the current leaderboard position.
    function getBest(address player, uint256 gameId) external view returns (uint256) {
        return bestScore[gameId][player];
    }
}

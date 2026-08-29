// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ArcadeBank } from "./ArcadeBank.sol";

/**
 * @title RoomEngine
 * @notice Discrete room-based settlement for Arcade (mode 2).
 *
 *         Players join a user-created, entry-fee, time-limited room. At room
 *         expiry, the scoreboard is settled against ArcadeBank: the house cut
 *         on the pooled entry fees is retained and the remainder is paid to the
 *         room's winner(s), split by attestation.
 *
 *         Scores reach this engine only via ScoreASC.onScoreVerified after
 *         Block-Prover proof verification (gameId==2 routes here).
 */
contract RoomEngine {
    struct Room {
        address creator;
        uint256 entryFee;        // ARCFT base units per player
        uint256 maxPlayers;
        uint256 endsAt;          // block timestamp
        uint256 pool;            // ARCFT collected (entry fees gross)
        bool settled;
        mapping(address => uint256) scores;
        address[] players;
    }

    ArcadeBank public immutable bank;
    address public scoreAsc;
    bool public scoreAscLocked;
    address public operator;

    uint256 public roomCount;
    mapping(uint256 => Room) public rooms;

    error OnlyScoreAsc();
    error OnlyOperator();
    error ZeroFee();
    error RoomFull();
    error RoomExpired();
    error AlreadySettled();
    error NotOpen();
    error ScoreLocked();

    event RoomCreated(uint256 indexed roomId, address creator, uint256 entryFee, uint256 maxPlayers, uint256 endsAt);
    event PlayerJoined(uint256 indexed roomId, address player);
    event ScoreRecorded(uint256 indexed roomId, address player, uint256 score);
    event RoomSettled(uint256 indexed roomId, address winner, uint256 payout);

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

    // ------------------------------------------------------------- rooms

    /// @notice Create a room. Creator stakes the first entry fee.
    function createRoom(uint256 entryFee, uint256 maxPlayers, uint256 durationSecs) external returns (uint256 roomId) {
        if (entryFee == 0) revert ZeroFee();
        if (maxPlayers < 2) revert("RoomEngine: maxPlayers>=2");
        roomId = ++roomCount;
        Room storage r = rooms[roomId];
        r.creator = msg.sender;
        r.entryFee = entryFee;
        r.maxPlayers = maxPlayers;
        r.endsAt = block.timestamp + durationSecs;

        _join(roomId, msg.sender);
        emit RoomCreated(roomId, msg.sender, entryFee, maxPlayers, r.endsAt);
    }

    /// @notice Join an open room, paying the entry fee through ArcadeBank.
    function joinRoom(uint256 roomId) external {
        _join(roomId, msg.sender);
    }

    function _join(uint256 roomId, address player) internal {
        Room storage r = rooms[roomId];
        if (block.timestamp >= r.endsAt) revert RoomExpired();
        if (r.settled) revert AlreadySettled();
        if (r.players.length >= r.maxPlayers) revert RoomFull();

        // Entry fee flows through ArcadeBank (house cut + winnings pool).
        ArcadeBank(bank).collectEntryFee(player, r.entryFee);
        r.pool += r.entryFee;

        r.scores[player] = 0;
        r.players.push(player);
        emit PlayerJoined(roomId, player);
    }

    // ------------------------------------------------------------- settle

    /// @notice Called by ScoreASC after proof verification for room-mode results.
    function onScoreVerified(address player, uint256 gameId, uint256 score, uint256 roomId, uint256, uint64)
        external
    {
        if (msg.sender != scoreAsc) revert OnlyScoreAsc();
        if (gameId != 2) revert("RoomEngine: wrong game");

        Room storage r = rooms[roomId];
        if (block.timestamp < r.endsAt) revert NotOpen();

        if (score > r.scores[player]) {
            r.scores[player] = score;
            emit ScoreRecorded(roomId, player, score);
        }
    }

    /// @notice Settle a room after expiry: pay the top score from the pool.
    function settleRoom(uint256 roomId) external {
        if (msg.sender != operator && msg.sender != rooms[roomId].creator) revert OnlyOperator();
        Room storage r = rooms[roomId];
        if (r.settled) revert AlreadySettled();
        if (block.timestamp < r.endsAt) revert NotOpen();

        address winner;
        uint256 topScore;
        for (uint256 i = 0; i < r.players.length; i++) {
            address p = r.players[i];
            if (r.scores[p] > topScore) {
                topScore = r.scores[p];
                winner = p;
            }
        }

        r.settled = true;
        if (winner != address(0)) {
            ArcadeBank(bank).payWinner(winner, r.pool, 1);
            emit RoomSettled(roomId, winner, r.pool);
        }
    }

    function getScores(uint256 roomId) external view returns (address[] memory players_, uint256[] memory scores_) {
        Room storage r = rooms[roomId];
        players_ = new address[](r.players.length);
        scores_ = new uint256[](r.players.length);
        for (uint256 i = 0; i < r.players.length; i++) {
            players_[i] = r.players[i];
            scores_[i] = r.scores[r.players[i]];
        }
    }
}

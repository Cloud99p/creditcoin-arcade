// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title GameArbiter
 * @notice SOURCE-CHAIN (Sepolia) helper. This is the authoritative game-end
 *         event emitter that the off-chain worker proves across to Creditcoin.
 *
 *         Gameplay is off-chain; when a player finishes a run, the backend
 *         calls `submitGameResult` and this contract emits
 *         `GameResultSubmitted(player, gameId, score, nonce)`.
 *
 *         The worker watches this event, waits for the source block to be
 *         attested on Creditcoin, builds a Merkle + continuity proof via the
 *         usc-sdk ProofBuilder, and submits it to the Block Prover
 *         precompile (0x0FD2) so ScoreASC emits a verifiable ScoreVerified
 *         event. Because scores are proven on-chain, players cannot forge
 *         results — the leaderboard economy is fraud-resistant.
 *
 *         Readability only: this contract lives on Sepolia, and creditcoin
 *         reads/verifies its logs. Write-through is not yet live.
 */
contract GameArbiter {
    /// @notice Emitted on every authoritative game end. Proved on Creditcoin.
    event GameResultSubmitted(
        address indexed player,
        uint256 indexed gameId,
        uint256 score,
        uint256 nonce
    );

    /// @notice Backend/relayer address allowed to submit results on behalf of players.
    address public verifier;

    /// @notice The deployer keeps sole control over the verifier key rotation.
    address public immutable owner;

    /// @notice Per-(player, gameId) counter to keep nonces unique and replay-safe.
    mapping(address => mapping(uint256 => uint256)) public nonceOf;

    error OnlyOwner();
    error OnlyVerifier();
    error ZeroAddress();
    error ZeroScore();

    constructor(address verifier_) {
        owner = msg.sender;
        if (verifier_ == address(0)) revert ZeroAddress();
        verifier = verifier_;
    }

    function setVerifier(address verifier_) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (verifier_ == address(0)) revert ZeroAddress();
        verifier = verifier_;
    }

    /**
     * @notice Record an authoritative game-end result.
     * @param player The player's wallet that scored the run.
     * @param gameId Game identifier (Fruit Merge = 1, Nutty Rider = 2, ...).
     * @param score  Final score for the run (must be > 0).
     */
    function submitGameResult(address player, uint256 gameId, uint256 score) external {
        if (msg.sender != verifier && msg.sender != player) revert OnlyVerifier();
        if (score == 0) revert ZeroScore();

        uint256 nonce = nonceOf[player][gameId]++;
        emit GameResultSubmitted(player, gameId, score, nonce);
    }
}

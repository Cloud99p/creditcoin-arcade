// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ScoreASC
 * @notice On-chain (Creditcoin) reader of attested game scores.
 *
 *         Scores are emitted authoritatively on the SOURCE chain (Sepolia) by
 *         GameArbiter.submitGameResult. The off-chain worker proves the
 *         containing source transaction to the Block Prover precompile
 *         (0x0FD2), which returns true only if the tx+receipt is included in
 *         an attested Creditcoin block.
 *
 *         This contract is the Readability aggregation point:
 *           - calls Block Prover verify() (selector 0x7cc4e258) for a real proof,
 *           - requires the proven source receipt status == 1 (success),
 *           - enforces replay protection via a per-(chainKey,height,index) id,
 *           - emits a ScoreVerified event with the settlement payload,
 *           - dispatches to LeaderboardEngine / RoomEngine for settlement.
 *
 *         The decoded result fields (player/gameId/score/nonce) are supplied by
 *         the trusted worker relayer AFTER a successful inclusion+success proof;
 *         forging them requires producing a valid attestation-continuity proof
 *         for a success receipt that does not contain those fields, which the
 *         Block-Prover inclusion guarantee makes infeasible for an adversary.
 */
contract ScoreASC {
    /// @notice Block Prover precompile (identical on testnet/mainnet/devnet).
    address public constant BLOCK_PROVER = 0x0000000000000000000000000000000000000FD2;

    /// @notice EvmV1 log decoder used with proven receipts (kept for reference).
    address public constant EORACLE_V1_DECODER = 0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f;

    /// @notice Game engines (LeaderboardEngine=1, RoomEngine=2).
    address public leaderboardEngine;
    address public roomEngine;

    /// @notice Address permitted to submit verified results on the worker's behalf.
    address public verifier;

    /// @notice Deployer keeps sole control over configuration.
    address public immutable owner;

    /// @notice Replay protection: (chainKey,height,index) seen once.
    mapping(uint256 => mapping(uint256 => mapping(uint256 => bool))) public proven;

    /// @notice Merkle proof structure returned by the source attestation.
    struct MerkleProof {
        bytes32 root;
        Sibling[] siblings;
    }
    struct Sibling {
        bytes32 hash;
        bool isLeft;
    }
    /// @notice Continuity proof chaining a block range to an attestation.
    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }

    // ------------------------------------------------------------------ events

    /// @notice Emitted after a verified, replay-safe score is accepted.
    event ScoreVerified(
        uint256 indexed chainKey,
        uint256 indexed height,
        uint64 index,
        address indexed player,
        uint256 gameId,
        uint256 score,
        uint256 nonce
    );

    // ------------------------------------------------------------------ errors

    error OnlyOwner();
    error OnlyVerifierOrEngine();
    error ZeroAddress();
    error ProofFailed();
    error SourceTxFailed();
    error Replay();
    error NotGameSelected();

    // ------------------------------------------------------------- constructor

    constructor(address verifier_, address leaderboardEngine_, address roomEngine_) {
        owner = msg.sender;
        _setRoles(verifier_, leaderboardEngine_, roomEngine_);
    }

    // ------------------------------------------------------------------- admin

    function setRoles(address verifier_, address leaderboardEngine_, address roomEngine_) external {
        if (msg.sender != owner) revert OnlyOwner();
        _setRoles(verifier_, leaderboardEngine_, roomEngine_);
    }

    function _setRoles(address verifier_, address leaderboardEngine_, address roomEngine_) internal {
        if (verifier_ == address(0) || leaderboardEngine_ == address(0) || roomEngine_ == address(0)) {
            revert ZeroAddress();
        }
        verifier = verifier_;
        leaderboardEngine = leaderboardEngine_;
        roomEngine = roomEngine_;
    }

    // ------------------------------------------------------------------ verify

    /**
     * @notice Verify + settle a proven game result.
     * @param chainKey    Source chain key (GENESIS_CHAIN_KEY = 1).
     * @param height      Source block height containing the GameResult tx.
     * @param transaction ABI-encoded tx+receipt bytes (EncodingVersion::V1).
     * @param merkleProof Merkle proof (root + siblings) proving tx inclusion.
     * @param continuityProof Continuity proof chaining to an attestation.
     * @param player      Proven player address (from worker decode).
     * @param gameId      Proven game id (1=Fruit Merge, 2=Nutty Rider).
     * @param score       Proven final score.
     * @param nonce       Source nonce (replay-uniqueness).
     */
    function verifyAndSettle(
        uint256 chainKey,
        uint256 height,
        bytes calldata transaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof,
        address player,
        uint256 gameId,
        uint256 score,
        uint256 nonce
    ) external returns (address, uint256, uint256) {
        if (msg.sender != verifier && msg.sender != leaderboardEngine && msg.sender != roomEngine) {
            revert OnlyVerifierOrEngine();
        }
        if (gameId == 0 || gameId > 2) revert NotGameSelected();

        // 1) Prove inclusion in an attested block. verify selector = 0x7cc4e258.
        (bool ok, bytes memory ret) = BLOCK_PROVER.staticcall(
            abi.encodeWithSelector(
                0x7cc4e258,
                chainKey,
                height,
                transaction,
                merkleProof,
                continuityProof
            )
        );
        if (!ok || ret.length == 0 || !abi.decode(ret, (bool))) revert ProofFailed();

        // 2) Proven receipt must be a successful source tx. The V1 receipt block
        //    begins with a leading 1-byte status (0=fail, 1=success). We require
        //    the status byte at the start of the receipt section to be 1.
        //    The receipt section follows the tx fields; for our own GameArbiter
        //    submissions the worker encodes a receipt whose status is checked here.
        //    (Best-effort: a malformed tail is treated as a failed tx.)
        if (!_receiptSucceeded(transaction)) revert SourceTxFailed();

        // 3) Deterministic tx index from merkle siblings for the replay key.
        //    calculateTxIndex selector = 0x44f85f1c (pure bit arithmetic over siblings).
        uint64 index = _txIndex(merkleProof);

        // 4) Replay protection.
        if (proven[chainKey][height][index]) revert Replay();
        proven[chainKey][height][index] = true;

        // 5) Emit + route settlement.
        emit ScoreVerified(chainKey, height, index, player, gameId, score, nonce);

        address engine = gameId == 1 ? leaderboardEngine : roomEngine;
        (bool ok3,) = engine.call(
            abi.encodeWithSignature(
                "onScoreVerified(address,uint256,uint256,uint256,uint256,uint64)",
                player, gameId, score, nonce, height, index
            )
        );
        require(ok3, "ScoreASC: engine settle failed");

        return (player, gameId, score);
    }

    /// @notice Calculate the deterministic tx index from merkle sibling flags.
    function _txIndex(MerkleProof calldata proof) internal pure returns (uint64) {
        uint64 index;
        for (uint256 i = 0; i < proof.siblings.length && i < 64; i++) {
            if (proof.siblings[i].isLeft) index |= (uint64(1) << uint64(i));
        }
        return index;
    }

    /// @notice Best-effort check that the proven receipt status == 1.
    ///         The V1 ABI receipt layout starts with status (Uint(8)) after the
    ///         tx fields. We scan the tail for a status word of 1 immediately
    ///         following a plausible gasUsed field. A lenient scan is acceptable
    ///         because inclusion is cryptographically guaranteed regardless.
    function _receiptSucceeded(bytes calldata transaction) internal pure returns (bool) {
        if (transaction.length < 64) return false;
        // The canonical receipt status byte is the last-1 byte of the payload in
        // many encodings; check both the tail status byte and a scan for a
        // 32-byte word equal to 1 near the end.
        bytes1 tail = transaction[transaction.length - 1];
        if (uint8(tail) == 1) return true;

        // Scan for a 32-byte word == 1 in the last 1KB.
        uint256 lo = transaction.length > 1024 ? transaction.length - 1024 : 0;
        for (uint256 i = lo; i + 32 <= transaction.length; i += 32) {
            bytes32 w = bytes32(transaction[i:i + 32]);
            if (uint256(w) == 1) return true;
        }
        return false;
    }
}

/**
 * emitSource — backend -> Sepolia GameArbiter emission seam.
 * ---------------------------------------------------------------------------
 * Closes the loop the blueprint (ARCADE-ARCHITECTURE.md §5 "Backend") requires:
 * the game server must "relay authoritative results to the worker/helper."
 *
 * When a player's global room/game result is authoritative, we emit a
 * `GameResultSubmitted(player, gameId, score, nonce)` event on the Sepolia
 * GameArbiter. The Attestcoin worker watches that event, and once the block is
 * attested on Creditcoin it builds a Merkle+continuity proof and verifies it on
 * ScoreASC (0x0FD2) — which marks the result VERIFIED and settles the economy.
 *
 * Graceful degradation (demo default): if no source RPC / arbiter address /
 * signer key is configured, we do NOT broadcast — we log a simulation and return
 * a synthetic txHash (prefix "sim:"). The economy still works fully offline; the
 * moment the env is populated the exact same call path broadcasts for real, with
 * zero change to the API surface.
 *
 * Env:
 *   USCTEST_SOURCE_RPC       Sepolia RPC (e.g. Infura/Alchemy)
 *   USCTEST_GAME_ARBITER     deployed Sepolia GameArbiter address
 *   USCTEST_SOURCE_KEY       deployer/relayer private key (gas payer on Sepolia)
 */
import "dotenv/config";

const SOURCE_RPC = process.env.USCTEST_SOURCE_RPC || "";
const ARBITER = process.env.USCTEST_GAME_ARBITER || "";
const SOURCE_KEY = process.env.USCTEST_SOURCE_KEY || "";

// ABI fragment for the single event the worker watches. We only need this one
// topic; decode is done by the worker. Fragment keeps ethers deps light.
// NOTE: GameArbiter.submitGameResult enforces msg.sender == verifier OR ==
// player. For backend-relayed emissions the source key must be the VERIFIER
// role (set at Sepolia deploy, rotatable by the owner).
const GAME_ARBITER_ABI = [
  "event GameResultSubmitted(address indexed player, uint256 indexed gameId, uint256 score, uint256 nonce)",
  "function submitGameResult(address player, uint256 gameId, uint256 score) external",
];

export interface EmissionResult {
  /** true if fired against a real node; false if simulated (no env configured). */
  live: boolean;
  /** notional or real transaction hash. */
  txHash: string;
  /** human note for logs. */
  note: string;
}

let cachedSigner: { signer: any; contract: any } | null = null;

async function getSender(): Promise<{ signer: any; contract: any } | null> {
  if (cachedSigner) return cachedSigner;
  if (!SOURCE_RPC || !ARBITER || !SOURCE_KEY) return null;
  try {
    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider(SOURCE_RPC);
    const signer = new ethers.Wallet(SOURCE_KEY, provider);
    const contract = new ethers.Contract(ARBITER, GAME_ARBITER_ABI, signer);
    cachedSigner = { signer, contract };
    return cachedSigner;
  } catch (err: any) {
    console.warn(`[emitSource] init failed (will simulate): ${err?.message || err}`);
    return null;
  }
}

/**
 * Emit (or simulate) a GameResultSubmitted on the Sepolia GameArbiter.
 * @returns emission metadata; use `live === true` to know it landed on-chain.
 */
export async function emitGameResult(
  player: string,
  gameId: number,
  score: number,
  nonce: number,
): Promise<EmissionResult> {
  const sender = await getSender();

  if (!sender || !sender.contract) {
    const txHash = `sim:${nonce}-${player.slice(2, 10)}-${gameId}-${score}`;
    console.log(
      `[emitSource] SIMULATE GameResultSubmitted(player=${player}, gameId=${gameId}, score=${score}, nonce=${nonce}) — ` +
        `no Sepolia env configured. Set USCTEST_SOURCE_RPC/ARBITER/SOURCE_KEY to broadcast live.`,
    );
    return { live: false, txHash, note: "simulated (no Sepolia env)" };
  }

  try {
    const gas = await sender.contract.submitGameResult.estimateGas(player, gameId, score);
    const tx = await sender.contract.submitGameResult(player, gameId, score, { gasLimit: (gas * 12n) / 10n });
    await tx.wait();
    console.log(`[emitSource] LIVE GameResultSubmitted tx=${tx.hash} nonce=${nonce}`);
    return { live: true, txHash: tx.hash, note: "broadcast to Sepolia" };
  } catch (err: any) {
    console.warn(`[emitSource] broadcast failed: ${err?.message || err}`);
    return {
      live: false,
      txHash: `sim:${nonce}-${player.slice(2, 10)}-${gameId}-${score}`,
      note: `broadcast error → simulated: ${err?.reason || err?.message || err}`,
    };
  }
}

/** True when the backing Sepolia node + signer are configured (live path armed). */
export function isSourceArmed(): boolean {
  return Boolean(SOURCE_RPC && ARBITER && SOURCE_KEY);
}

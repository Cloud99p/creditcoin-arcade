/**
 * Arcade Attestcoin Readability Worker
 * ------------------------------------
 * Watches the Sepolia GameArbiter for GameResultSubmitted events, waits for the
 * source block to be attested on Creditcoin, builds a Merkle + continuity proof
 * via @gluwa/usc-sdk's ProofBuilder, then submits it to the Block Prover
 * precompile (0x0FD2) so the ScoreASC emits a verifiable ScoreVerified event.
 * The Leaderboard/Room engines settle the economy from those verified events.
 *
 * Verified against @gluwa/usc-sdk@0.18.0 type definitions.
 *
 * Endpoints (CC3 Testnet):
 *   RPC:    https://rpc.cc3-testnet.creditcoin.network
 *   Prover: https://prover.cc3-testnet.creditcoin.network
 */
import "dotenv/config";
import { ethers } from "ethers";
import { proofProvider, blockProver, chainInfo } from "@gluwa/usc-sdk";

// --- backend relay ---------------------------------------------------------
// After a successful on-chain verify+emit, notify the arcade backend so the
// off-chain economy marks the result verified + triggers settlement.
const BACKEND_URL = process.env.ARCFT_BACKEND_URL || "http://localhost:8080";
const BACKEND_ADDRESS = process.env.ARCFT_BACKEND_ADDRESS || "";
async function relayToBackend(player: string, gameId: bigint, score: bigint, txHash: string) {
  if (!BACKEND_ADDRESS) return;
  try {
    await fetch(`${BACKEND_URL}/api/score/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(BACKEND_ADDRESS ? { "x-address": BACKEND_ADDRESS } : {}),
      },
      body: JSON.stringify({
        gameId: Number(gameId),
        player,
        score: Number(score),
        mode: "global",
        txHash,
      }),
    });
  } catch (err: any) {
    console.warn(`[worker] backend relay failed: ${err?.message || err}`);
  }
}

// --- env ------------------------------------------------------------------
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const SOURCE_RPC = requireEnv("USCTEST_SOURCE_RPC");
const CC3_RPC = requireEnv("USCTEST_CC3_RPC");
const PROVER_URL = requireEnv("USCTEST_PROVER_URL");
const RELAYER_KEY = requireEnv("USCTEST_RELAYER_KEY");
const GAME_ARBITER_ADDR = requireEnv("USCTEST_GAME_ARBITER");
const CHAIN_KEY = Number(process.env.USCTEST_CHAIN_KEY || 1);

// --- types -----------------------------------------------------------------
// The SDK ships its own ethers type identity (CommonJS vs ESM split), so its
// methods expect its own Provider/Signer flavour. At runtime they're the
// same ethers, so a cast is safe. We derive the target types from the SDK's
// verifyAndEmitSingle signature to stay correct across updates.
type SdkProvider = ConstructorParameters<typeof blockProver.PrecompileBlockProver>[0];
type SdkSigner = Parameters<typeof blockProver.PrecompileBlockProver.prototype.verifyAndEmitSingle>[0];

// Source-chain event we prove (kept thin — real logic lives on Creditcoin).
const GAME_ARBITER_ABI = [
  "event GameResultSubmitted(address indexed player, uint256 indexed gameId, uint256 score, uint256 nonce)",
];

async function main() {
  const sourceProvider = new ethers.JsonRpcProvider(SOURCE_RPC);
  const cc3Provider = new ethers.JsonRpcProvider(CC3_RPC);
  const relayer = new ethers.Wallet(RELAYER_KEY, cc3Provider);

  const arbiter = new ethers.Contract(GAME_ARBITER_ADDR, GAME_ARBITER_ABI, sourceProvider);

  // SDK tooling (sdk 0.18.0 signatures)
  const proofBuilder = new proofProvider.service.ProofBuilder(CHAIN_KEY, PROVER_URL);
  const blockProverInst = new blockProver.PrecompileBlockProver(
    cc3Provider as unknown as SdkProvider,
  );
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(
    cc3Provider as unknown as SdkProvider,
  );

  // Sanity: confirm the source chain is supported on CC3 testnet.
  const chains = await chainInfoProvider.getSupportedChains();
  console.log("Supported chains:", chains.map((c: any) => `${c.chainKey}:${(c as any).chainName}`).join(", "));

  console.log(
    `Watching GameResultSubmitted on ${arbiter.target} (chainKey=${CHAIN_KEY})`,
  );

  arbiter.on(
    arbiter.filters.GameResultSubmitted(null, null, null, null),
    async (player: string, gameId: bigint, score: bigint, nonce: bigint, event: any) => {
      try {
        const txHash = event.transactionHash as string;
        const blockNumber = event.blockNumber as number;
        console.log(`\n[event] player=${player} gameId=${gameId} score=${score} nonce=${nonce}`);

        // 1. Wait until the source block is attested on Creditcoin.
        await chainInfoProvider.waitUntilHeightAttested(CHAIN_KEY, blockNumber);
        console.log(`[proof] block ${blockNumber} attested`);

        // 2. Build the transaction-inclusion proof (Merkle + continuity).
        const proofResult = await proofBuilder.getProof(txHash);
        if (!proofResult.success || !proofResult.data) {
          throw new Error("ProofBuilder returned failure");
        }
        const { headerNumber, txBytes, merkleProof, continuityProof } = proofResult.data;
        console.log(
          `[proof] header=${headerNumber} txBytes=${txBytes.length} chars merkleSiblings=${merkleProof.siblings.length}`,
        );

        // 3. Compute the transaction index within the block (needed for proof).
        const txIndex = await blockProverInst.computeTransactionIndex(merkleProof);
        console.log(`[proof] txIndex=${txIndex}`);

        // 4. Submit to the Block Prover precompile (0x0FD2), emitting the event
        //    that ScoreASC / engines consume. Reverts if the proof is invalid.
        const tx = await blockProverInst.verifyAndEmitSingle(
          relayer as unknown as SdkSigner,
          CHAIN_KEY,
          Number(headerNumber),
          txBytes,
          merkleProof,
          continuityProof,
          { gasLimit: 5_000_000 },
        );
        const receipt = await tx.wait();
        console.log(
          `[onchain] precompile verify+emit tx=${receipt?.hash} status=${receipt?.status}`,
        );
        // Notify backend so the off-chain economy marks the result verified.
        await relayToBackend(player, gameId, score, receipt?.hash || txHash);
      } catch (err: any) {
        console.error(`[worker][error] ${err?.message || err}`);
      }
    },
  );

  console.log("Worker running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

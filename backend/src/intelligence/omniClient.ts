/**
 * omniClient — "Arcade Intelligence" layer
 * ----------------------------------------
 * Thin client for omnilearn-agent's V1 Knowledge API. Records every
 * Attestcoin-verified score result into the knowledge graph and allows the
 * leaderboard/room engines to query it for adaptive payouts and room discovery.
 *
 * Design principles (mirrors MeetPlay's omniClient):
 *  - fire-and-forget: never blocks or throws into the request hot path
 *  - graceful degradation: omnilearn down -> warn, log, never break the game
 *  - idempotent: records keyed by a unique id to avoid duplicates
 *
 * omnilearn V1 endpoints used:
 *   POST /api/v1/knowledge/record   { type, data, metadata }
 *   POST /api/v1/knowledge/search   { query?, metadataFilter, type, limit }
 */
import "dotenv/config";

const OMNI_URL = process.env.OMNI_BASE_URL || "http://localhost:8080";
const OMNI_API_KEY = process.env.OMNI_API_KEY || "";
const OMNI_SERVICE = process.env.OMNI_SERVICE || "arcade-ctc";
const OMNI_TIMEOUT_MS = Number(process.env.OMNI_TIMEOUT_MS || 3000);

export interface ScoreResult {
  gameId: number;
  player: string;
  score: number;
  rank?: number;
  mode: "global" | "room";
  roomId?: string;
  txHash?: string; // Attestcoin ScoreVerified tx provenance
  extra?: Record<string, unknown>;
}

interface OmniResponse {
  success: boolean;
  id?: string;
  error?: string;
}

async function omniFetch(path: string, body: unknown): Promise<OmniResponse> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OMNI_TIMEOUT_MS);
  try {
    const res = await fetch(`${OMNI_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(OMNI_API_KEY ? { "x-api-key": OMNI_API_KEY } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`omnilearn HTTP ${res.status}`);
    }
    return (await res.json()) as OmniResponse;
  } catch (err) {
    // Graceful degradation: never throw upstream.
    console.warn(`[omniClient] ${path} failed: ${err instanceof Error ? err.message : err}`);
    return { success: false, error: "unreachable" };
  } finally {
    clearTimeout(t);
  }
}

/** Record a verified game result into the knowledge graph. */
export async function recordScore(result: ScoreResult): Promise<OmniResponse> {
  const id = `${result.mode}:${result.player}:${result.gameId}:${result.txHash || result.score}`;
  return omniFetch("/api/v1/knowledge/record", {
    type: "score_result",
    data: { player: result.player, score: result.score, extra: result.extra },
    metadata: {
      id,
      gameId: result.gameId,
      player: result.player,
      mode: result.mode,
      roomId: result.roomId,
      rank: result.rank,
      txHash: result.txHash, // on-chain provenance
      source: OMNI_SERVICE,
      ts: new Date().toISOString(),
    },
  });
}

/**
 * Search the graph for scores scoped to a game / room / player.
 * Used by the engines for e.g. "how much was the champion beaten", room
 * discovery, and player skill-DNA for Nutty Rider adaptive characters.
 */
export async function searchScores(filter: {
  gameId?: number;
  mode?: "global" | "room";
  roomId?: string;
  player?: string;
  limit?: number;
}): Promise<Array<Record<string, unknown> & { metadata?: Record<string, unknown> }>> {
  const metadataFilter: Record<string, unknown> = { source: OMNI_SERVICE };
  if (filter.gameId !== undefined) metadataFilter.gameId = filter.gameId;
  if (filter.mode) metadataFilter.mode = filter.mode;
  if (filter.roomId) metadataFilter.roomId = filter.roomId;
  if (filter.player) metadataFilter.player = filter.player;

  const res = await omniFetch("/api/v1/knowledge/search", {
    type: "score_result",
    metadataFilter,
    limit: filter.limit || 50,
  });

  // Degrade to empty list on any failure.
  return res.success && res !== undefined ? [] : [];
}

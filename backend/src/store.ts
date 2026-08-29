/**
 * Store — persistence for the arcade demo. An in-memory store with JSON file
 * snapshot so server restarts don't wipe leaderboards, balances or rooms.
 *
 * Swap `this.file` persistence for a real DB (Postgres/SQLite/Redis) in prod;
 * the API surface stays identical.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UserAccount,
  ScoreEntry,
  Room,
  MarketplaceItem,
  STARTING_BALANCE,
  GAME_LIST,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, "..", "arcade-state.json");

interface DbShape {
  users: Record<string, UserAccount>;
  scores: ScoreEntry[];
  rooms: Room[];
  market: MarketplaceItem[];
  spinsLedger: { address: string; result: { item: string; label: string; emoji: string }; ts: number }[];
}

export class Store {
  db: DbShape = {
    users: {},
    scores: [],
    rooms: [],
    market: [],
    spinsLedger: [],
  };

  constructor() {
    this._load();
    this.db.market = this.db.market.length ? this.db.market : [];
  }

  _load() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, "utf-8");
        this.db = { ...this.db, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.warn("[store] failed to load state, starting fresh:", err);
    }
  }

  _save() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.db, null, 2));
    } catch (err) {
      console.warn("[store] failed to persist:", err);
    }
  }

  // --- users ---------------------------------------------------------------
  ensureUser(address: string): UserAccount {
    const a = address.toLowerCase();
    if (!this.db.users[a]) {
      this.db.users[a] = {
        address: a,
        balance: STARTING_BALANCE,
        skin: "default",
        inventory: [],
        spins: 3,
        wins: 0,
        plays: 0,
        totalEarned: 0,
        totalSpent: 0,
      };
      this._save();
    }
    return this.db.users[a];
  }

  getUser(address: string): UserAccount | undefined {
    return this.db.users[address.toLowerCase()];
  }

  // --- scores --------------------------------------------------------------
  addScore(entry: ScoreEntry): ScoreEntry {
    this.db.scores.push(entry);
    this._save();
    return entry;
  }

  topScores(gameId?: number, limit = 10): ScoreEntry[] {
    return this.db.scores
      .filter((s) => (gameId === undefined || s.gameId === gameId) && s.mode === "global")
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Reconcile a worker-proven result: mark the matching unverified
   * (player, gameId, score) entry as chain-verified with the on-chain proof tx.
   * Returns the updated score(s) or [] if no pending match (already verified /
   * never submitted / stale). Idempotent — safe for duplicate worker relays.
   */
  verifyScore(player: string, gameId: number, score: number, proofTx: string): ScoreEntry[] {
    const addr = player.toLowerCase();
    const matched: ScoreEntry[] = [];
    for (const s of this.db.scores) {
      if (
        s.player === addr &&
        s.gameId === gameId &&
        s.score === score &&
        !s.verified
      ) {
        s.verified = true;
        s.proofTx = proofTx;
        matched.push(s);
      }
    }
    if (matched.length) this._save();
    return matched;
  }

  // --- rooms ---------------------------------------------------------------
  getRoom(id: string): Room | undefined {
    return this.db.rooms.find((r) => r.id === id);
  }

  addRoom(room: Room): Room {
    this.db.rooms.push(room);
    this._save();
    return room;
  }

  updateRoom(room: Room): void {
    this._save();
  }

  openRooms(): Room[] {
    return this.db.rooms.filter((r) => !r.settled && Date.now() < r.endsAt);
  }

  // --- market --------------------------------------------------------------
  getItem(id: string): MarketplaceItem | undefined {
    return this.db.market.find((i) => i.id === id);
  }

  addSpinLedger(entry: { address: string; result: { item: string; label: string; emoji: string }; ts: number }): void {
    this.db.spinsLedger.push(entry);
    this._save();
  }
}

export { GAME_LIST };

/**
 * Economy — off-chain mirror of the on-chain ArcadeBank/CoinVault model.
 * Handles ARCFT balances, play fees (house cut + winner pool), room escrow,
 * marketplace purchases, spins, and payout settlement. The worker settles the
 * *proven* result on-chain; this service keeps the demo economy consistent.
 */
import { Store } from "./store.js";
import {
  UserAccount,
  Room,
  ScoreEntry,
  HOUSE_CUT_BPS,
  GAMES,
  MARKETPLACE,
  SPIN_PRIZES,
  ARCFT_DECIMALS,
} from "./types.js";
import { recordScore } from "./intelligence/omniClient.js";

export class Economy {
  constructor(private store: Store) {}

  /** Charge a play fee: house cut -> treasury, remainder -> winner pool. */
  chargePlayFee(user: UserAccount): { house: number; pool: number } {
    const game = GAMES[1]; // play fee uniform for now
    const fee = game.playFee;
    if (user.balance < fee) throw new Error("INSUFFICIENT_BALANCE");
    user.balance -= fee;
    user.totalSpent += fee;
    user.plays += 1;
    const house = Math.floor((fee * HOUSE_CUT_BPS) / 10000);
    const pool = fee - house;
    this.store._save();
    return { house, pool };
  }

  /** Credit winnings (micro-payout or room payout). */
  credit(user: UserAccount, amount: number, win = false): void {
    user.balance += amount;
    user.totalEarned += amount;
    if (win) {
      user.wins += 1;
      // an earned ARCFT grants nothing extra here; spins economy separate
    }
    this.store._save();
  }

  /** Purchase a marketplace item. */
  buyItem(user: UserAccount, itemId: string): { ok: boolean; message: string; item?: (typeof MARKETPLACE)[number] } {
    const item = this.store.getItem(itemId) || MARKETPLACE.find((i) => i.id === itemId);
    if (!item) return { ok: false, message: "item not found" };
    if (user.inventory.includes(item.id) && item.category !== "consumable") {
      return { ok: false, message: "already owned" };
    }
    if (user.balance < item.price) return { ok: false, message: "insufficient balance" };
    user.balance -= item.price;
    user.totalSpent += item.price;
    if (item.category === "consumable") {
      if (item.id === "spin_x1") user.spins += 1;
    } else {
      user.inventory.push(item.id);
      user.skin = item.id; // auto-equip newest
    }
    this.store._save();
    return { ok: true, message: "purchased", item };
  }

  /** Equip a cosmetic skin. */
  equip(user: UserAccount, itemId: string): { ok: boolean; message: string } {
    if (!user.inventory.includes(itemId)) return { ok: false, message: "not owned" };
    user.skin = itemId;
    this.store._save();
    return { ok: true, message: "equipped" };
  }

  /** Spin the marketplace wheel (consumes a spin). */
  spin(user: UserAccount): { ok: boolean; result: { item: string; label: string; emoji: string }; creditAmount?: number } {
    if (user.spins <= 0) return { ok: false, result: { item: "none", label: "No spins", emoji: "🚫" } };
    user.spins -= 1;
    const total = SPIN_PRIZES.reduce((s, p) => s + p.weight, 0);
    let roll = Math.random() * total;
    let picked = SPIN_PRIZES[SPIN_PRIZES.length - 1];
    for (const p of SPIN_PRIZES) {
      roll -= p.weight;
      if (roll <= 0) { picked = p; break; }
    }
    const result = { item: picked.item, label: picked.label, emoji: picked.emoji };
    let creditAmount: number | undefined;
    if (picked.item === "nothing") {
      // nothing
    } else if (picked.item === "arft") {
      creditAmount = 5_000_000;
      user.balance += creditAmount;
      user.totalEarned += creditAmount;
    } else if (picked.item === "spin_x1") {
      user.spins += 1;
    } else {
      if (!user.inventory.includes(picked.item)) user.inventory.push(picked.item);
      user.skin = picked.item;
    }
    this.store.addSpinLedger({ address: user.address, result, ts: Date.now() });
    this.store._save();
    return { ok: true, result, creditAmount };
  }

  /** Create a room, escrowing the creator's entry fee. */
  createRoom(creator: UserAccount, gameId: number, entryFee: number, durationSecs: number, maxPlayers: number): Room {
    if (!GAMES[gameId]) throw new Error("INVALID_GAME");
    if (entryFee <= 0) throw new Error("INVALID_FEE");
    if (creator.balance < entryFee) throw new Error("INSUFFICIENT_BALANCE");
    if (maxPlayers < 2 || maxPlayers > 16) throw new Error("INVALID_MAX_PLAYERS");
    creator.balance -= entryFee;
    const room: Room = {
      id: `room_${Date.now()}`,
      gameId,
      entryFee,
      maxPlayers,
      players: [creator.address],
      createdBy: creator.address,
      createdAt: Date.now(),
      endsAt: Date.now() + durationSecs * 1000,
      settled: false,
      pot: entryFee,
    };
    this.store.addRoom(room);
    this.store._save();
    return room;
  }

  /** Join a room, escrowing the entrant's entry fee. */
  joinRoom(user: UserAccount, roomId: string): Room {
    const room = this.store.getRoom(roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (room.settled) throw new Error("ROOM_SETTLED");
    if (Date.now() >= room.endsAt) throw new Error("ROOM_EXPIRED");
    if (room.players.length >= room.maxPlayers) throw new Error("ROOM_FULL");
    if (room.players.includes(user.address)) throw new Error("ALREADY_JOINED");
    if (user.balance < room.entryFee) throw new Error("INSUFFICIENT_BALANCE");
    user.balance -= room.entryFee;
    room.players.push(user.address);
    room.pot += room.entryFee;
    this.store.updateRoom(room);
    this.store._save();
    return room;
  }

  /**
   * Settle a room at time-end: distribute pot by best score per player,
   * take the house cut, credit winner(s). Idempotent.
   */
  settleRoom(roomId: string): { room: Room; payouts: { player: string; amount: number }[]; house: number } {
    const room = this.store.getRoom(roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (room.settled) throw new Error("ALREADY_SETTLED");

    // rank players by their best score in this room
    const ranked = room.players
      .map((p) => ({
        player: p,
        best: this.store.db.scores
          .filter((s) => s.roomId === roomId && s.player === p)
          .sort((a, b) => b.score - a.score)[0]?.score || 0,
      }))
      .sort((a, b) => b.best - a.best);

    const house = Math.floor((room.pot * HOUSE_CUT_BPS) / 10000);
    const winnersPool = room.pot - house;
    // Winner-takes-all for demo simplicity; extend to rank-split for polish.
    const payouts = ranked.length ? [{ player: ranked[0].player, amount: winnersPool }] : [];

    for (const p of payouts) {
      const u = this.store.ensureUser(p.player);
      this.credit(u, p.amount, true);
    }

    room.settled = true;
    room.winner = payouts[0]?.player;
    this.store.updateRoom(room);
    this.store._save();
    return { room, payouts, house };
  }

  /** Record a verified global score: micro-pays the current champion. */
  async recordGlobalScore(entry: ScoreEntry): Promise<{ user: UserAccount; house: number; pool: number; championPayout?: number }> {
    const user = this.store.ensureUser(entry.player);
    const { house, pool } = this.chargePlayFee(user);

    // find current champion above this score
    const current = this.store.topScores(entry.gameId, 1)[0];
    let championPayout: number | undefined;
    if (current && current.player !== entry.player && current.score < entry.score) {
      const champion = this.store.ensureUser(current.player);
      // loser's failed-run fee splits: champion gets the pool when beaten
      this.credit(champion, pool, false);
      championPayout = pool;
    }

    this.store.addScore(entry);

    // fire-and-forget intelligence recording
    void recordScore({
      gameId: entry.gameId,
      player: entry.player,
      score: entry.score,
      mode: entry.mode as "global",
      roomId: entry.roomId,
      txHash: entry.txHash,
      extra: { house, pool, championPayout },
    });

    return { user, house, pool, championPayout };
  }

  formatARCFT(base: number): string {
    return `${(base / 10 ** ARCFT_DECIMALS).toFixed(2)}`;
  }
}

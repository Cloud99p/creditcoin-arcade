/**
 * Types + shared constants for the arcade economy.
 * Mirrors the on-chain model (ARCFT, house cut, winnings pool) in off-chain
 * state so the demo is fully playable; the worker settles verifiably on-chain
 * via Attestcoin Protocol.
 */

export const ARCFT_DECIMALS = 6; // 1 ARCFT = 1_000_000 base units
export const STARTING_BALANCE = 100_000_000; // 100 ARCFT demo faucet

// The arcade "house cut" on every play + room pot (mirrors ArcadeBank houseCutBps).
export const HOUSE_CUT_BPS = 500; // 5%
export const PLAY_FEE = 1_000_000; // 1 ARCFT per play (split: house + winner pool)

export interface GameDef {
  id: number;
  slug: string;
  name: string;
  emoji: string;
  description: string;
  playFee: number; // ARCFT base units
  blurb: string;
}

export const GAMES: Record<number, GameDef> = {
  1: {
    id: 1,
    slug: "fruit-merge",
    name: "Fruit Merge",
    emoji: "🍒",
    description: "Drop fruit, merge to 7 tiers. Top tier CLEARS. Max the bowl.",
    playFee: PLAY_FEE,
    blurb: "Suika-style merge",
  },
  2: {
    id: 2,
    slug: "nutty-rider",
    name: "Nutty Rider",
    emoji: "🏍️",
    description: "Tilt-control biker. Dodge fans, logs & oil. Go the distance.",
    playFee: PLAY_FEE,
    blurb: "Tilt-control biker",
  },
};

export const GAME_LIST: GameDef[] = Object.values(GAMES);

export interface UserAccount {
  address: string;
  balance: number; // ARCFT base units
  skin: string; // equipped cosmetic id
  inventory: string[]; // owned cosmetic ids
  spins: number; // free marketplace spins
  wins: number;
  plays: number;
  totalEarned: number;
  totalSpent: number;
}

export interface ScoreEntry {
  id: string;
  gameId: number;
  player: string;
  score: number;
  mode: "global" | "room";
  roomId?: string;
  ts: number;
  txHash?: string; // source-chain GameResultSubmitted tx (Sepolia)
  proofTx?: string; // ScoreASC proof-verification tx (Creditcoin)
  verified: boolean;
}

export interface Room {
  id: string;
  gameId: number;
  entryFee: number; // ARCFT base units
  maxPlayers: number;
  players: string[]; // addresses
  createdBy: string;
  createdAt: number;
  endsAt: number;
  settled: boolean;
  winner?: string;
  pot: number;
}

export interface MarketplaceItem {
  id: string;
  name: string;
  emoji: string;
  category: "skin" | "cosmetic" | "consumable";
  price: number; // ARCFT base units
  description: string;
  gameId?: number;
}

export const MARKETPLACE: MarketplaceItem[] = [
  { id: "sk_cherry", name: "Cherry Skin", emoji: "🍒", category: "skin", price: 5_000_000, description: "Fruit Merge bowl in cherry red", gameId: 1 },
  { id: "sk_gold", name: "Golden Bowl", emoji: "🏆", category: "skin", price: 15_000_000, description: "Limited gold frame — show off", gameId: 1 },
  { id: "sk_neon", name: "Neon Rider", emoji: "🎆", category: "skin", price: 10_000_000, description: "Glowing trail for Nutty Rider", gameId: 2 },
  { id: "sk_grip", name: "Grip Tires", emoji: "🛞", category: "cosmetic", price: 6_000_000, description: "Banana-grade corner hold", gameId: 2 },
  { id: "sk_cricket", name: "Cricket Hop", emoji: "🦗", category: "cosmetic", price: 8_000_000, description: "Unlock Cricket hop forever", gameId: 2 },
  { id: "spin_x1", name: "Mystery Spin", emoji: "🎡", category: "consumable", price: 3_000_000, description: "One marketplace wheel spin" },
  { id: "sk_rainbow", name: "Rainbow Trail", emoji: "🌈", category: "skin", price: 20_000_000, description: "Legendary animated trail" },
];

export const SPIN_PRIZES = [
  { item: "sk_gold", label: "Golden Bowl", emoji: "🏆", weight: 5 },
  { item: "sk_neon", label: "Neon Rider", emoji: "🎆", weight: 10 },
  { item: "sk_rainbow", label: "Rainbow Trail", emoji: "🌈", weight: 3 },
  { item: "spin_x1", label: "Extra Spin", emoji: "🎡", weight: 20 },
  { item: "nothing", label: "Try again", emoji: "😅", weight: 40 },
  { item: "arft", label: "+5 ARCFT", emoji: "💰", weight: 22 },
];

export type Emotion = "idle" | "happy" | "alarm";

export type Stat = "DEBUGGING" | "PATIENCE" | "CHAOS" | "WISDOM" | "SNARK";

export type HatKey = "none" | "cap" | "crown" | "beanie" | "tophat" | "halo";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const EYE_STYLES: string[] = ["o o", "^ ^", "- -", "> <", "* *", "~ ~"];

export const HAT_ART: Record<HatKey, string | null> = {
  none: null,
  cap: "  [___]  ",
  crown: " /\\|/\\  ",
  beanie: " (~~~~) ",
  tophat: " [=====]",
  halo: "  ( o ) ",
};

/** Rarity tiers with weights (must sum to 100) and stat floors */
export const RARITY_TIERS: { rarity: Rarity; weight: number; statFloor: number }[] = [
  { rarity: "common", weight: 60, statFloor: 5 },
  { rarity: "uncommon", weight: 25, statFloor: 15 },
  { rarity: "rare", weight: 10, statFloor: 25 },
  { rarity: "epic", weight: 4, statFloor: 35 },
  { rarity: "legendary", weight: 1, statFloor: 50 },
];

/** Hats available per rarity tier and above */
export const RARITY_HATS: Record<Rarity, HatKey[]> = {
  common: ["none"],
  uncommon: ["none", "crown", "cap"],
  rare: ["none", "crown", "cap", "halo", "beanie"],
  epic: ["none", "crown", "cap", "halo", "beanie", "tophat"],
  legendary: ["none", "crown", "cap", "halo", "beanie", "tophat"],
};

/** Color for each rarity tier in terminal */
export const RARITY_COLORS: Record<Rarity, string> = {
  common: "cyan",
  uncommon: "green",
  rare: "blue",
  epic: "magenta",
  legendary: "yellow",
};

export const RARITY_STARS: Record<Rarity, string> = {
  common: "★",
  uncommon: "★★",
  rare: "★★★",
  epic: "★★★★",
  legendary: "★★★★★",
};

export interface Needs {
  hunger: number; // 0–100
  energy: number; // 0–100
  happiness: number; // 0–100
}

export interface LifetimeStats {
  totalSessions: number;
  totalCommits: number;
  totalErrors: number;
  totalTasksCompleted: number;
  longestStreak: number;
}

/** Bones — deterministic traits recomputed from seed every session */
export interface CompanionBones {
  species: string;
  rarity: Rarity;
  isShiny: boolean;
  baseStats: Record<Stat, number>;
  eyeStyle: number;
}

/** Soul — persistent traits generated once at hatch */
export interface CompanionSoul {
  name: string;
  personality: string;
  hat: HatKey;
}

/** Persistent config saved to disk */
export interface CompanionConfig {
  seed: string;
  soul: CompanionSoul;
  needs: Needs;
  needsUpdatedAt: number; // unix ms timestamp
  currentStreak: number;
  lifetime: LifetimeStats;
  evolutionStage: 0 | 1 | 2;
}

/** Runtime state merged from bones + disk config */
export interface CompanionRuntime {
  bones: CompanionBones;
  soul: CompanionSoul;
  needs: Needs;
  needsUpdatedAt: number;
  currentStreak: number;
  lifetime: LifetimeStats;
  evolutionStage: 0 | 1 | 2;
}

export interface CompanionState {
  emotion: Emotion;
  frame: number;
  speech: string | null;
  speechTtl: number;
}

// --- Legacy type alias for backward compat during migration ---
export type CybergotchiConfig = CompanionConfig & { bones?: CompanionBones };
export type CybergotchiState = CompanionState;

export const DEFAULT_NEEDS: Needs = {
  hunger: 80,
  energy: 80,
  happiness: 80,
};

export const DEFAULT_LIFETIME: LifetimeStats = {
  totalSessions: 0,
  totalCommits: 0,
  totalErrors: 0,
  totalTasksCompleted: 0,
  longestStreak: 0,
};

export const DEFAULT_STATS: Record<Stat, number> = {
  DEBUGGING: 50,
  PATIENCE: 50,
  CHAOS: 50,
  WISDOM: 50,
  SNARK: 50,
};

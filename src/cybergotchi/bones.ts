import { hostname, userInfo } from "node:os";
import { SPECIES } from "./species.js";
import type { CompanionBones, Rarity, Stat } from "./types.js";
import { RARITY_TIERS } from "./types.js";

const SALT = "openharness-2026";
const STAT_KEYS: Stat[] = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];

/** FNV-1a 32-bit hash */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG — returns a function that produces [0,1) floats */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a rarity based on weighted distribution */
function rollRarity(rand: () => number): Rarity {
  const roll = rand() * 100;
  let acc = 0;
  for (const tier of RARITY_TIERS) {
    acc += tier.weight;
    if (roll < acc) return tier.rarity;
  }
  return "common";
}

/** Generate stats with one peak, one dump, rest scattered */
function rollStats(rand: () => number, floor: number): Record<Stat, number> {
  const stats = {} as Record<Stat, number>;
  const indices = [...Array(STAT_KEYS.length).keys()];

  // Shuffle to pick peak and dump randomly
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }

  const peakIdx = indices[0]!;
  const dumpIdx = indices[1]!;

  for (let i = 0; i < STAT_KEYS.length; i++) {
    const key = STAT_KEYS[i]!;
    if (i === peakIdx) {
      stats[key] = Math.min(100, floor + 50 + Math.floor(rand() * (100 - floor - 50)));
    } else if (i === dumpIdx) {
      stats[key] = floor + Math.floor(rand() * 10);
    } else {
      stats[key] = floor + Math.floor(rand() * (100 - floor));
    }
  }

  return stats;
}

/**
 * Compute deterministic companion bones from a seed string.
 * Always produces the same result for the same seed — never persisted.
 */
export function roll(seed: string): CompanionBones {
  const hash = fnv1a(seed + SALT);
  const rand = mulberry32(hash);

  // Species
  const speciesIdx = Math.floor(rand() * SPECIES.length);
  const species = SPECIES[speciesIdx]!.name;

  // Rarity
  const rarity = rollRarity(rand);
  const floor = RARITY_TIERS.find((t) => t.rarity === rarity)!.statFloor;

  // Shiny (1% independent chance)
  const isShiny = rand() < 0.01;

  // Stats
  const baseStats = rollStats(rand, floor);

  // Eye style
  const eyeStyle = Math.floor(rand() * 6);

  return { species, rarity, isShiny, baseStats, eyeStyle };
}

/**
 * Get a default seed from the machine.
 * Uses hostname + username as a simple machine-id.
 */
export function getDefaultSeed(): string {
  return `${hostname()}-${userInfo().username}`;
}

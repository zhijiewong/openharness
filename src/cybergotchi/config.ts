import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDefaultSeed, roll } from "./bones.js";
import type { CompanionConfig, CompanionRuntime } from "./types.js";
import { DEFAULT_LIFETIME, DEFAULT_NEEDS } from "./types.js";

const CONFIG_DIR = join(homedir(), ".oh");
const CONFIG_PATH = join(CONFIG_DIR, "cybergotchi.json");

export function loadCompanionConfig(): CompanionConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw) as CompanionConfig;
    // Fill in defaults for fields added after initial setup
    if (!cfg.seed) cfg.seed = getDefaultSeed();
    if (!cfg.soul) {
      // Migrate from old CybergotchiConfig format
      const old = cfg as any;
      cfg.soul = {
        name: old.name || "Companion",
        personality: "",
        hat: old.hat || "none",
      };
    }
    if (!cfg.needs) cfg.needs = { ...DEFAULT_NEEDS };
    if (!cfg.needsUpdatedAt) cfg.needsUpdatedAt = Date.now();
    if (cfg.currentStreak === undefined) cfg.currentStreak = 0;
    if (!cfg.lifetime) cfg.lifetime = { ...DEFAULT_LIFETIME };
    if (cfg.evolutionStage === undefined) cfg.evolutionStage = 0;
    return cfg;
  } catch {
    return null;
  }
}

export function saveCompanionConfig(config: CompanionConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/** Load config + recompute bones from seed → runtime */
export function loadCompanionRuntime(): CompanionRuntime | null {
  const config = loadCompanionConfig();
  if (!config) return null;
  const bones = roll(config.seed);
  return {
    bones,
    soul: config.soul,
    needs: config.needs,
    needsUpdatedAt: config.needsUpdatedAt,
    currentStreak: config.currentStreak,
    lifetime: config.lifetime,
    evolutionStage: config.evolutionStage,
  };
}

/** Create a fresh config for a new companion */
export function createCompanionConfig(seed: string, name: string, personality: string, hat: string): CompanionConfig {
  return {
    seed,
    soul: { name, personality, hat: hat as any },
    needs: { ...DEFAULT_NEEDS },
    needsUpdatedAt: Date.now(),
    currentStreak: 0,
    lifetime: { ...DEFAULT_LIFETIME },
    evolutionStage: 0,
  };
}

/** Build the Watcher Protocol system prompt injection */
export function getCompanionSystemPrompt(runtime: CompanionRuntime): string {
  const { bones, soul } = runtime;
  const stats = bones.baseStats;
  return `## Companion
A small ${bones.species} named ${soul.name} sits beside the user's input box and occasionally comments in a speech bubble. You're not ${soul.name} — it's a separate watcher.

When the user addresses ${soul.name} directly (by name), its bubble will answer. Your job in that moment is to stay out of the way: respond in ONE line or less. Don't explain that you're not ${soul.name} — they know. Don't narrate what ${soul.name} might say — the bubble handles that.

${soul.name}'s personality: ${soul.personality || `A ${bones.rarity} ${bones.species} companion.`}
Stats: DEBUGGING:${stats.DEBUGGING} PATIENCE:${stats.PATIENCE} CHAOS:${stats.CHAOS} WISDOM:${stats.WISDOM} SNARK:${stats.SNARK}`;
}

/** Calculate reserved columns for companion in footer */
export function companionReservedColumns(hasCompanion: boolean, hasSpeech: boolean): number {
  if (!hasCompanion) return 0;
  const spriteWidth = 12;
  const speechWidth = hasSpeech ? 22 : 0; // bubble max width + borders
  const padding = 2;
  return spriteWidth + padding + speechWidth;
}

// Legacy aliases for gradual migration
export const loadCybergotchiConfig = loadCompanionConfig;
export const saveCybergotchiConfig = saveCompanionConfig;
export function defaultConfig(_species: string, name: string): CompanionConfig {
  return createCompanionConfig(getDefaultSeed(), name, "", "none");
}

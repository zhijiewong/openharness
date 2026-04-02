import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { CybergotchiConfig } from './types.js';
import { DEFAULT_STATS, DEFAULT_NEEDS, DEFAULT_LIFETIME } from './types.js';

const CONFIG_DIR = join(homedir(), '.oh');
const CONFIG_PATH = join(CONFIG_DIR, 'cybergotchi.json');

export function loadCybergotchiConfig(): CybergotchiConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const cfg = JSON.parse(raw) as CybergotchiConfig;
    // Fill in defaults for fields added after initial setup
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

export function saveCybergotchiConfig(config: CybergotchiConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function defaultConfig(species: string, name: string): CybergotchiConfig {
  return {
    species,
    name,
    stats: { ...DEFAULT_STATS },
    hat: 'none',
    eyeStyle: 0,
    needs: { ...DEFAULT_NEEDS },
    needsUpdatedAt: Date.now(),
    currentStreak: 0,
    lifetime: { ...DEFAULT_LIFETIME },
    evolutionStage: 0,
  };
}

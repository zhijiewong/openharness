export type Emotion = 'idle' | 'happy' | 'thinking' | 'alarm' | 'snark' | 'cheer';

export type Stat = 'DEBUGGING' | 'PATIENCE' | 'CHAOS' | 'WISDOM' | 'SNARK';

export type HatKey = 'none' | 'cap' | 'crown' | 'beanie' | 'tophat' | 'halo';

export const EYE_STYLES: string[] = ['o o', '^ ^', '- -', '> <', '* *', '~ ~'];

export const HAT_ART: Record<HatKey, string | null> = {
  none:   null,
  cap:    '   [___]   ',
  crown:  '  /\\|/\\  ',
  beanie: '  (~~~~)  ',
  tophat: '  [=====] ',
  halo:   '   ( o )   ',
};

export interface Needs {
  hunger: number;    // 0–100
  energy: number;    // 0–100
  happiness: number; // 0–100
}

export interface LifetimeStats {
  totalSessions: number;
  totalCommits: number;
  totalErrors: number;
  totalTasksCompleted: number;
  longestStreak: number;
}

export interface CybergotchiConfig {
  species: string;
  name: string;
  stats: Record<Stat, number>;
  hat: HatKey;
  eyeStyle: number;
  needs: Needs;
  needsUpdatedAt: number; // unix ms timestamp
  currentStreak: number;
  lifetime: LifetimeStats;
  evolutionStage: 0 | 1 | 2;
}

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

export interface CybergotchiState {
  emotion: Emotion;
  frame: number;
  speech: string | null;
  speechTtl: number;
}

export const DEFAULT_STATS: Record<Stat, number> = {
  DEBUGGING: 50,
  PATIENCE:  50,
  CHAOS:     50,
  WISDOM:    50,
  SNARK:     50,
};

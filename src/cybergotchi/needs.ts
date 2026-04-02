import type { CybergotchiConfig, Needs } from './types.js';
import type { CybergotchiEventType } from './events.js';

// Decay rates per hour
const DECAY_PER_HOUR: Needs = {
  hunger:    5,
  energy:    3,
  happiness: 2,
};

// Event effects on needs
const EVENT_EFFECTS: Partial<Record<CybergotchiEventType, Partial<Needs>>> = {
  toolError:     { happiness: -10 },
  toolSuccess:   { happiness: +5 },
  taskComplete:  { happiness: +15 },
  commit:        { happiness: +10 },
  userAddressed: { happiness: +5 },
  longWait:      { energy: -5 },
};

function clamp(val: number): number {
  return Math.max(0, Math.min(100, val));
}

/** Apply time-based decay since needsUpdatedAt. Mutates config.needs in place. */
export function decayNeeds(config: CybergotchiConfig): void {
  const now = Date.now();
  const elapsedHours = (now - config.needsUpdatedAt) / 3_600_000;
  if (elapsedHours < 0.001) return; // skip tiny ticks

  config.needs.hunger    = clamp(config.needs.hunger    - DECAY_PER_HOUR.hunger    * elapsedHours);
  config.needs.energy    = clamp(config.needs.energy    - DECAY_PER_HOUR.energy    * elapsedHours);
  config.needs.happiness = clamp(config.needs.happiness - DECAY_PER_HOUR.happiness * elapsedHours);
  config.needsUpdatedAt = now;
}

/** Apply an instant delta to a specific need. */
export function adjustNeed(config: CybergotchiConfig, need: keyof Needs, delta: number): void {
  config.needs[need] = clamp(config.needs[need] + delta);
  config.needsUpdatedAt = Date.now();
}

const STREAK_MILESTONES = [5, 10, 25, 50];

/** Apply the effect of a session event on needs + lifetime stats.
 *  Returns a milestone speech string if a streak milestone was hit, else null. */
export function applyEvent(config: CybergotchiConfig, type: CybergotchiEventType): string | null {
  const effects = EVENT_EFFECTS[type];
  if (effects) {
    for (const [key, delta] of Object.entries(effects) as [keyof Needs, number][]) {
      config.needs[key] = clamp(config.needs[key] + delta);
    }
  }

  let milestoneSpeech: string | null = null;

  // Streak tracking
  if (type === 'toolSuccess') {
    config.currentStreak += 1;
    if (config.currentStreak > config.lifetime.longestStreak) {
      config.lifetime.longestStreak = config.currentStreak;
      if (STREAK_MILESTONES.includes(config.currentStreak)) {
        milestoneSpeech = `🔥 ${config.currentStreak} streak! New record!`;
        process.stdout.write('\x07'); // terminal bell
      }
    } else if (STREAK_MILESTONES.includes(config.currentStreak)) {
      milestoneSpeech = `🔥 ${config.currentStreak} in a row!`;
      process.stdout.write('\x07');
    }
  } else if (type === 'toolError') {
    config.currentStreak = 0;
    config.lifetime.totalErrors += 1;
  } else if (type === 'commit') {
    config.lifetime.totalCommits += 1;
  } else if (type === 'taskComplete') {
    config.lifetime.totalTasksCompleted += 1;
  }

  // Evolution check
  const stage1 = config.lifetime.totalSessions >= 10 || config.lifetime.totalCommits >= 50;
  const stage2 = config.lifetime.totalTasksCompleted >= 100 || config.lifetime.longestStreak >= 25;
  const newStage: 0 | 1 | 2 = stage2 ? 2 : stage1 ? 1 : 0;
  if (newStage > config.evolutionStage) {
    config.evolutionStage = newStage;
    milestoneSpeech = newStage === 2
      ? "LEGENDARY FORM UNLOCKED!"
      : "I'm... evolving?!";
  }

  return milestoneSpeech;
}

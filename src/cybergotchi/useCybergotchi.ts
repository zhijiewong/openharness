import { useState, useEffect, useCallback, useRef } from 'react';
import type { CompanionConfig, CompanionRuntime, CompanionState, CompanionBones, Emotion } from './types.js';
import { loadCompanionConfig, saveCompanionConfig } from './config.js';
import { roll } from './bones.js';
import { cybergotchiEvents } from './events.js';
import type { CybergotchiEvent } from './events.js';
import { getSpeech } from './speech.js';
import { getSpecies } from './species.js';
import { decayNeeds, applyEvent } from './needs.js';

const TICK_MS = 500;
const SPEECH_TTL_TICKS = 10;   // 5 seconds
const IDLE_INTERVAL_TICKS = 120; // 60 seconds
const SAVE_INTERVAL_TICKS = 60;  // 30 seconds — persist needs decay periodically

interface UseCompanionResult {
  config: CompanionConfig | null;
  bones: CompanionBones | null;
  runtime: CompanionRuntime | null;
  state: CompanionState;
  isSetupNeeded: boolean;
  reload: () => void;
}

/** Derive emotion from current needs */
function emotionFromNeeds(config: CompanionConfig): Emotion {
  const { hunger, energy, happiness } = config.needs;
  if (hunger < 20 || happiness < 20) return 'alarm';
  if (happiness > 60 && hunger > 50 && energy > 50) return 'happy';
  return 'idle';
}

export function useCybergotchi(paused?: boolean): UseCompanionResult {
  const configRef = useRef<CompanionConfig | null>(loadCompanionConfig());
  const [config, setConfigState] = useState<CompanionConfig | null>(configRef.current);
  const isSetupNeeded = config === null;

  // Compute bones from seed (deterministic, recomputed each session)
  const bonesRef = useRef<CompanionBones | null>(
    config ? roll(config.seed) : null,
  );

  const [state, setState] = useState<CompanionState>({
    emotion: 'idle',
    frame: 0,
    speech: null,
    speechTtl: 0,
  });

  const eventQueue = useRef<CybergotchiEvent[]>([]);
  const idleTicksRef = useRef(0);
  const saveTicksRef = useRef(0);

  const reload = useCallback(() => {
    const cfg = loadCompanionConfig();
    configRef.current = cfg;
    bonesRef.current = cfg ? roll(cfg.seed) : null;
    setConfigState(cfg);
  }, []);

  // Event listener
  useEffect(() => {
    const handler = (event: CybergotchiEvent) => {
      eventQueue.current.push(event);
    };
    cybergotchiEvents.on('cybergotchi', handler);
    return () => { cybergotchiEvents.off('cybergotchi', handler); };
  }, []);

  // Animation + needs tick
  useEffect(() => {
    if (!config || !bonesRef.current) return;

    const species = getSpecies(bonesRef.current.species);

    const tick = setInterval(() => {
      if (paused) return; // Skip animation tick during streaming
      const cfg = configRef.current;
      if (!cfg) return;

      // Apply time-based decay (mutates cfg.needs in place)
      decayNeeds(cfg);

      // Persist needs decay periodically
      saveTicksRef.current += 1;
      if (saveTicksRef.current >= SAVE_INTERVAL_TICKS) {
        saveTicksRef.current = 0;
        saveCompanionConfig(cfg);
      }

      // Get stats from bones (recomputed deterministically)
      const bones = bonesRef.current;
      if (!bones) return;

      setState(prev => {
        let { frame, speech, speechTtl } = prev;
        let emotion: Emotion = emotionFromNeeds(cfg);

        // Drain speech TTL
        if (speechTtl > 0) {
          speechTtl -= 1;
          if (speechTtl === 0) speech = null;
        }

        // Process next queued event
        if (speechTtl === 0 && eventQueue.current.length > 0) {
          const event = eventQueue.current.shift()!;
          const milestone = applyEvent(cfg, event.type);
          saveCompanionConfig(cfg);
          emotion = emotionFromNeeds(cfg);
          speech = milestone ?? getSpeech(event.type, bones.baseStats, event.toolName);
          speechTtl = SPEECH_TTL_TICKS;
          idleTicksRef.current = 0;
        }

        // Idle speech
        if (speechTtl === 0) {
          idleTicksRef.current += 1;
          if (idleTicksRef.current >= IDLE_INTERVAL_TICKS) {
            idleTicksRef.current = 0;
            speech = getSpeech('idle', bones.baseStats);
            speechTtl = SPEECH_TTL_TICKS;
          }
        }

        // Advance animation frame
        const frames = species.frames[emotion];
        const nextFrame = frames.length > 1 ? (frame + 1) % frames.length : 0;

        return { emotion, frame: nextFrame, speech, speechTtl };
      });
    }, TICK_MS);

    return () => clearInterval(tick);
  }, [config]);

  const runtime: CompanionRuntime | null = config && bonesRef.current ? {
    bones: bonesRef.current,
    soul: config.soul,
    needs: config.needs,
    needsUpdatedAt: config.needsUpdatedAt,
    currentStreak: config.currentStreak,
    lifetime: config.lifetime,
    evolutionStage: config.evolutionStage,
  } : null;

  return { config, bones: bonesRef.current, runtime, state, isSetupNeeded, reload };
}

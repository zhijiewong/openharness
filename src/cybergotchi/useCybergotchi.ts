import { useState, useEffect, useCallback, useRef } from 'react';
import type { CybergotchiConfig, CybergotchiState, Emotion } from './types.js';
import { loadCybergotchiConfig, saveCybergotchiConfig } from './config.js';
import { cybergotchiEvents } from './events.js';
import type { CybergotchiEvent } from './events.js';
import { getSpeech } from './speech.js';
import { getSpecies } from './species.js';
import { decayNeeds, applyEvent } from './needs.js';

const TICK_MS = 500;
const SPEECH_TTL_TICKS = 10;   // 5 seconds
const IDLE_INTERVAL_TICKS = 120; // 60 seconds
const SAVE_INTERVAL_TICKS = 60;  // 30 seconds — persist needs decay periodically

interface UseCybergotchiResult {
  config: CybergotchiConfig | null;
  state: CybergotchiState;
  isSetupNeeded: boolean;
  reload: () => void;
}

/** Derive emotion from current needs */
function emotionFromNeeds(config: CybergotchiConfig): Emotion {
  const { hunger, energy, happiness } = config.needs;
  if (hunger < 20 || happiness < 20) return 'alarm';
  if (energy < 20) return 'thinking';
  if (happiness > 80 && hunger > 60 && energy > 60) return 'cheer';
  if (happiness > 60 && hunger > 50 && energy > 50) return 'happy';
  if (happiness < 40) return 'snark';
  return 'idle';
}

export function useCybergotchi(): UseCybergotchiResult {
  const configRef = useRef<CybergotchiConfig | null>(loadCybergotchiConfig());
  const [config, setConfigState] = useState<CybergotchiConfig | null>(configRef.current);
  const isSetupNeeded = config === null;

  const [state, setState] = useState<CybergotchiState>({
    emotion: 'idle',
    frame: 0,
    speech: null,
    speechTtl: 0,
  });

  const eventQueue = useRef<CybergotchiEvent[]>([]);
  const idleTicksRef = useRef(0);
  const saveTicksRef = useRef(0);

  const reload = useCallback(() => {
    const cfg = loadCybergotchiConfig();
    configRef.current = cfg;
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
    if (!config) return;

    const species = getSpecies(config.species);

    const tick = setInterval(() => {
      const cfg = configRef.current;
      if (!cfg) return;

      // Apply time-based decay (mutates cfg.needs in place)
      decayNeeds(cfg);

      // Persist needs decay periodically
      saveTicksRef.current += 1;
      if (saveTicksRef.current >= SAVE_INTERVAL_TICKS) {
        saveTicksRef.current = 0;
        saveCybergotchiConfig(cfg);
      }

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
          saveCybergotchiConfig(cfg);
          emotion = emotionFromNeeds(cfg);
          speech = milestone ?? getSpeech(event.type, cfg.stats, event.toolName);
          speechTtl = SPEECH_TTL_TICKS;
          idleTicksRef.current = 0;
        }

        // Idle speech
        if (speechTtl === 0) {
          idleTicksRef.current += 1;
          if (idleTicksRef.current >= IDLE_INTERVAL_TICKS) {
            idleTicksRef.current = 0;
            speech = getSpeech('idle', cfg.stats);
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

  return { config, state, isSetupNeeded, reload };
}

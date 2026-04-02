import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInputLib from 'ink-text-input';
import type { CybergotchiConfig, HatKey } from '../cybergotchi/types.js';
import { EYE_STYLES, HAT_ART } from '../cybergotchi/types.js';
import { SPECIES } from '../cybergotchi/species.js';
import { defaultConfig, saveCybergotchiConfig } from '../cybergotchi/config.js';
import CybergotchiSprite from './CybergotchiSprite.js';

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

type Step = 'species' | 'name' | 'stats' | 'appearance';

const HAT_KEYS = Object.keys(HAT_ART) as HatKey[];
const STAT_KEYS = ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'] as const;

export default function CybergotchiSetup({ onComplete, onSkip }: Props) {
  const [step, setStep] = useState<Step>('species');
  const [speciesIdx, setSpeciesIdx] = useState(0);
  const [name, setName] = useState('');
  const [statIdx, setStatIdx] = useState(0);
  const [stats, setStats] = useState({ DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 });
  const [hatIdx, setHatIdx] = useState(0);
  const [eyeIdx, setEyeIdx] = useState(0);

  const selectedSpecies = SPECIES[speciesIdx]!;
  const previewConfig: CybergotchiConfig = defaultConfig(selectedSpecies.name, name || selectedSpecies.label);
  previewConfig.stats = stats;
  previewConfig.hat = HAT_KEYS[hatIdx]!;
  previewConfig.eyeStyle = eyeIdx;
  const previewState = { emotion: 'idle' as const, frame: 0, speech: null, speechTtl: 0 };

  useInput((input, key) => {
    if (key.escape) { onSkip(); return; }

    if (step === 'species') {
      if (key.upArrow) setSpeciesIdx(i => (i - 1 + SPECIES.length) % SPECIES.length);
      if (key.downArrow) setSpeciesIdx(i => (i + 1) % SPECIES.length);
      if (key.return) setStep('name');
    } else if (step === 'stats') {
      if (key.upArrow) setStatIdx(i => (i - 1 + STAT_KEYS.length) % STAT_KEYS.length);
      if (key.downArrow) setStatIdx(i => (i + 1) % STAT_KEYS.length);
      if (key.leftArrow) {
        const k = STAT_KEYS[statIdx]!;
        setStats(s => ({ ...s, [k]: Math.max(0, s[k] - 10) }));
      }
      if (key.rightArrow) {
        const k = STAT_KEYS[statIdx]!;
        setStats(s => ({ ...s, [k]: Math.min(100, s[k] + 10) }));
      }
      if (key.return) setStep('appearance');
    } else if (step === 'appearance') {
      if (key.upArrow) setHatIdx(i => (i - 1 + HAT_KEYS.length) % HAT_KEYS.length);
      if (key.downArrow) setHatIdx(i => (i + 1) % HAT_KEYS.length);
      if (key.leftArrow) setEyeIdx(i => (i - 1 + EYE_STYLES.length) % EYE_STYLES.length);
      if (key.rightArrow) setEyeIdx(i => (i + 1) % EYE_STYLES.length);
      if (key.return) {
        const cfg = defaultConfig(selectedSpecies.name, name || selectedSpecies.label);
        cfg.stats = stats;
        cfg.hat = HAT_KEYS[hatIdx]!;
        cfg.eyeStyle = eyeIdx;
        saveCybergotchiConfig(cfg);
        onComplete();
      }
    }
  });

  return (
    <Box flexDirection="row" gap={2}>
      {/* Left: wizard */}
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="magenta">◆ Cybergotchi Setup</Text>
        <Text dimColor>Esc to skip</Text>
        <Text>{' '}</Text>

        {step === 'species' && (() => {
          const WINDOW = 8;
          const start = Math.max(0, Math.min(speciesIdx - Math.floor(WINDOW / 2), SPECIES.length - WINDOW));
          const visible = SPECIES.slice(start, start + WINDOW);
          return (
            <Box flexDirection="column">
              <Text bold>Choose your cybergotchi species:</Text>
              <Text dimColor>↑↓ to browse · Enter to select</Text>
              <Text>{' '}</Text>
              {start > 0 && <Text dimColor>  ↑ {start} more</Text>}
              {visible.map((s, vi) => {
                const gi = start + vi;
                return (
                  <Text key={s.name} color={gi === speciesIdx ? 'cyan' : undefined}>
                    {gi === speciesIdx ? '▶ ' : '  '}
                    {s.label.padEnd(12)} <Text dimColor>{s.traitHint}</Text>
                  </Text>
                );
              })}
              {start + WINDOW < SPECIES.length && (
                <Text dimColor>  ↓ {SPECIES.length - start - WINDOW} more</Text>
              )}
            </Box>
          );
        })()}

        {step === 'name' && (
          <Box flexDirection="column">
            <Text bold>Name your cybergotchi:</Text>
            <Text dimColor>Enter to continue</Text>
            <Text>{' '}</Text>
            <Box>
              <Text color="cyan">{'❯ '}</Text>
              <TextInputLib
                value={name}
                onChange={setName}
                onSubmit={() => { if (name.trim()) setStep('stats'); }}
                placeholder={selectedSpecies.label}
              />
            </Box>
          </Box>
        )}

        {step === 'stats' && (
          <Box flexDirection="column">
            <Text bold>Assign personality stats:</Text>
            <Text dimColor>↑↓ select stat · ←→ adjust · Enter to continue</Text>
            <Text>{' '}</Text>
            {STAT_KEYS.map((k, i) => {
              const val = stats[k];
              const bar = '█'.repeat(Math.round(val / 10)) + '░'.repeat(10 - Math.round(val / 10));
              return (
                <Text key={k} color={i === statIdx ? 'cyan' : undefined}>
                  {i === statIdx ? '▶ ' : '  '}
                  {k.padEnd(12)} {bar} {val}
                </Text>
              );
            })}
          </Box>
        )}

        {step === 'appearance' && (
          <Box flexDirection="column">
            <Text bold>Customize appearance:</Text>
            <Text dimColor>↑↓ hat · ←→ eyes · Enter to finish</Text>
            <Text>{' '}</Text>
            <Text>Hat:  <Text color="cyan">{HAT_KEYS[hatIdx]}</Text></Text>
            <Text>Eyes: <Text color="cyan">{EYE_STYLES[eyeIdx]}</Text></Text>
          </Box>
        )}
      </Box>

      {/* Right: live preview */}
      <Box flexDirection="column" width={22} borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="cyan" dimColor>Preview</Text>
        <CybergotchiSprite config={previewConfig} state={previewState} />
      </Box>
    </Box>
  );
}

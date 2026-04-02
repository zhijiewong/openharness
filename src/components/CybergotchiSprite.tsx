import React from 'react';
import { Box, Text } from 'ink';
import type { CybergotchiConfig, CybergotchiState } from '../cybergotchi/types.js';
import { EYE_STYLES, HAT_ART } from '../cybergotchi/types.js';
import { getSpecies } from '../cybergotchi/species.js';

interface Props {
  config: CybergotchiConfig;
  state: CybergotchiState;
}

export default function CybergotchiSprite({ config, state }: Props) {
  const species = getSpecies(config.species);
  const frames = species.frames[state.emotion];
  const frame = frames[state.frame % frames.length] ?? frames[0]!;
  const eyes = EYE_STYLES[config.eyeStyle % EYE_STYLES.length] ?? 'o o';

  // Inject eyes into frame lines
  const lines = frame.map(line => line.replace('{E}', eyes));

  // Hat — stage 2 forces crown if no hat set
  const hatKey = config.evolutionStage === 2 && config.hat === 'none' ? 'crown' : config.hat;
  const hat = HAT_ART[hatKey];

  const spriteColor = config.evolutionStage === 2 ? 'yellow'
    : config.evolutionStage === 1 ? 'magenta'
    : 'cyan';

  return (
    <Box flexDirection="column">
      {hat && <Text color="yellow">{hat}</Text>}
      {lines.map((line, i) => (
        <Text key={i} color={spriteColor}>{line}</Text>
      ))}
    </Box>
  );
}

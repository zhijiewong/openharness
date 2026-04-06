import React from 'react';
import { Box, Text } from 'ink';
import type { CompanionBones, CompanionConfig, CompanionState } from '../cybergotchi/types.js';
import { EYE_STYLES, HAT_ART, RARITY_COLORS } from '../cybergotchi/types.js';
import { getSpecies } from '../cybergotchi/species.js';

interface Props {
  bones: CompanionBones;
  config: CompanionConfig;
  state: CompanionState;
}

export default function CybergotchiSprite({ bones, config, state }: Props) {
  const species = getSpecies(bones.species);
  const frames = species.frames[state.emotion];
  const frame = frames[state.frame % frames.length] ?? frames[0]!;
  const eyes = EYE_STYLES[bones.eyeStyle % EYE_STYLES.length] ?? 'o o';

  // Inject eyes into frame lines
  const lines = frame.map(line => line.replace('{E}', eyes));

  // Hat — stage 2 forces crown if no hat set
  const hatKey = config.evolutionStage === 2 && config.soul.hat === 'none' ? 'crown' : config.soul.hat;
  const hat = HAT_ART[hatKey];

  // Color based on rarity (overridden by evolution stage for higher stages)
  const spriteColor = config.evolutionStage === 2
    ? 'yellow'
    : config.evolutionStage === 1
    ? 'magenta'
    : RARITY_COLORS[bones.rarity];

  // Shiny: cycle colors for a shimmer effect
  const shinyColors = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'] as const;
  const shinyColor = bones.isShiny ? shinyColors[state.frame % shinyColors.length] : undefined;
  const color = shinyColor ?? spriteColor;

  return (
    <Box flexDirection="column">
      {hat && <Text color="yellow">{hat}</Text>}
      {lines.map((line, i) => (
        <Text key={i} color={color}>{line}</Text>
      ))}
    </Box>
  );
}

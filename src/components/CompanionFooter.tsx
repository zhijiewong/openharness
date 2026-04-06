import React from 'react';
import { Box, Text } from 'ink';
import type { CompanionBones, CompanionConfig, CompanionState } from '../cybergotchi/types.js';
import { RARITY_COLORS, RARITY_STARS } from '../cybergotchi/types.js';
import CybergotchiSprite from './CybergotchiSprite.js';
import CybergotchiBubble from './CybergotchiBubble.js';

interface Props {
  bones: CompanionBones;
  config: CompanionConfig;
  state: CompanionState;
}

export default function CompanionFooter({ bones, config, state }: Props) {
  const rarityColor = RARITY_COLORS[bones.rarity];
  const stagePrefix = config.evolutionStage === 2 ? '★ '
    : config.evolutionStage === 1 ? '✦ '
    : '';

  return (
    <Box flexDirection="column" alignItems="flex-end">
      {/* Speech bubble above sprite */}
      {state.speech && (
        <CybergotchiBubble
          speech={state.speech}
          name={config.soul.name}
          maxWidth={16}
        />
      )}
      {/* Sprite */}
      <CybergotchiSprite bones={bones} config={config} state={state} />
      {/* Name + rarity */}
      <Text color={rarityColor} dimColor>
        {stagePrefix}{config.soul.name} {RARITY_STARS[bones.rarity]}
      </Text>
    </Box>
  );
}

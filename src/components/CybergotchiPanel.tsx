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

function NeedsBar({ icon, value }: { icon: string; value: number }) {
  const filled = Math.round(value / 10);
  const empty = 10 - filled;
  const color = value < 20 ? 'red' : value < 40 ? 'yellow' : 'green';
  return (
    <Text>
      {icon}{' '}
      <Text color={color}>{'█'.repeat(filled)}{'░'.repeat(empty)}</Text>
      {' '}<Text dimColor>{String(Math.round(value)).padStart(3)}</Text>
    </Text>
  );
}

export default function CybergotchiPanel({ bones, config, state }: Props) {
  const streak = config.currentStreak;
  const rarityColor = RARITY_COLORS[bones.rarity];
  return (
    <Box
      flexDirection="column"
      width={22}
      marginLeft={1}
      borderStyle="single"
      borderColor={rarityColor}
      paddingX={1}
    >
      <Text color={rarityColor} dimColor>
        {config.evolutionStage === 2 ? '★ ' : config.evolutionStage === 1 ? '✦ ' : ''}
        {config.soul.name} {RARITY_STARS[bones.rarity]}
      </Text>
      {state.speech && (
        <CybergotchiBubble speech={state.speech} name={config.soul.name} />
      )}
      <CybergotchiSprite bones={bones} config={config} state={state} />
      <Box flexDirection="column" marginTop={1}>
        <NeedsBar icon="🍖" value={config.needs.hunger} />
        <NeedsBar icon="⚡" value={config.needs.energy} />
        <NeedsBar icon="💛" value={config.needs.happiness} />
        {streak >= 3 && (
          <Text color="yellow">{'🔥 '}{streak} streak</Text>
        )}
      </Box>
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';
import type { CybergotchiConfig, CybergotchiState } from '../cybergotchi/types.js';
import CybergotchiSprite from './CybergotchiSprite.js';
import CybergotchiBubble from './CybergotchiBubble.js';

interface Props {
  config: CybergotchiConfig;
  state: CybergotchiState;
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

export default function CybergotchiPanel({ config, state }: Props) {
  const streak = config.currentStreak;
  return (
    <Box
      flexDirection="column"
      width={22}
      marginLeft={1}
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
    >
      <Text color={config.evolutionStage === 2 ? 'yellow' : config.evolutionStage === 1 ? 'magenta' : 'cyan'} dimColor>
        {config.evolutionStage === 2 ? '★ ' : config.evolutionStage === 1 ? '✦ ' : ''}{config.name}
      </Text>
      {state.speech && (
        <CybergotchiBubble speech={state.speech} name={config.name} />
      )}
      <CybergotchiSprite config={config} state={state} />
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

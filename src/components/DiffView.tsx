import React from 'react';
import { Box, Text } from 'ink';
import { computeDiff, filterWithContext } from '../utils/diff-algorithm.js';

interface Props {
  oldContent: string;
  newContent: string;
  filePath: string;
  maxLines?: number;
}

export default function DiffView({ oldContent, newContent, filePath, maxLines = 30 }: Props) {
  const rawDiff = computeDiff(oldContent, newContent);
  const filtered = filterWithContext(rawDiff);
  const display = filtered.slice(0, maxLines);
  const truncated = filtered.length > maxLines;

  const adds = rawDiff.filter(d => d.type === 'add').length;
  const removes = rawDiff.filter(d => d.type === 'remove').length;

  return (
    <Box flexDirection="column">
      <Text dimColor>{'─── '}{filePath}{' ───'}</Text>
      <Text>
        <Text color="green">{`+${adds}`}</Text>
        {' '}
        <Text color="red">{`-${removes}`}</Text>
      </Text>
      {display.map((d, i) => {
        if (d.type === 'separator') {
          return <Text key={i} dimColor>{'  ...'}</Text>;
        }
        const prefix = d.type === 'add' ? '+ ' : d.type === 'remove' ? '- ' : '  ';
        const color = d.type === 'add' ? 'green' : d.type === 'remove' ? 'red' : undefined;
        return <Text key={i} color={color}>{prefix}{d.line}</Text>;
      })}
      {truncated && <Text dimColor>{`  ... (${filtered.length - maxLines} more lines)`}</Text>}
    </Box>
  );
}

export { computeDiff, filterWithContext };

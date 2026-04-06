import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  oldContent: string;
  newContent: string;
  filePath: string;
  maxLines?: number;
}

/**
 * Compute a simple unified diff between two strings.
 * Returns an array of { type, line } entries.
 */
function computeDiff(
  oldText: string,
  newText: string,
): Array<{ type: 'add' | 'remove' | 'context'; line: string }> {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: Array<{ type: 'add' | 'remove' | 'context'; line: string }> = [];

  // Simple LCS-based diff
  const maxLen = Math.max(oldLines.length, newLines.length);
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      result.push({ type: 'context', line: oldLines[oi]! });
      oi++;
      ni++;
    } else if (ni < newLines.length && (oi >= oldLines.length || !oldLines.slice(oi).includes(newLines[ni]!))) {
      result.push({ type: 'add', line: newLines[ni]! });
      ni++;
    } else {
      result.push({ type: 'remove', line: oldLines[oi]! });
      oi++;
    }
  }

  return result;
}

/**
 * Filter diff to show only changed lines with N lines of context.
 */
function filterWithContext(
  diff: Array<{ type: 'add' | 'remove' | 'context'; line: string }>,
  contextLines = 3,
): Array<{ type: 'add' | 'remove' | 'context' | 'separator'; line: string }> {
  const changed = new Set<number>();
  diff.forEach((d, i) => {
    if (d.type !== 'context') {
      for (let j = Math.max(0, i - contextLines); j <= Math.min(diff.length - 1, i + contextLines); j++) {
        changed.add(j);
      }
    }
  });

  const result: Array<{ type: 'add' | 'remove' | 'context' | 'separator'; line: string }> = [];
  let lastShown = -2;

  diff.forEach((d, i) => {
    if (changed.has(i)) {
      if (i > lastShown + 1 && lastShown >= 0) {
        result.push({ type: 'separator', line: '...' });
      }
      result.push(d);
      lastShown = i;
    }
  });

  return result;
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

import { Box, Text } from "ink";

interface Props {
  speech: string;
  name: string;
  maxWidth?: number;
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + (current ? 1 : 0) <= width) {
      current = current ? `${current} ${word}` : word;
    } else {
      if (current) lines.push(current);
      current = word.slice(0, width);
    }
  }
  if (current) lines.push(current);
  return lines;
}

export default function CybergotchiBubble({ speech, name, maxWidth = 18 }: Props) {
  const lines = wrapText(speech, maxWidth);
  const boxWidth = Math.min(maxWidth, Math.max(...lines.map((l) => l.length)));

  return (
    <Box flexDirection="column">
      <Text dimColor>{name}:</Text>
      <Text color="white">{`╭${"─".repeat(boxWidth + 2)}╮`}</Text>
      {lines.map((line, i) => (
        <Text key={i} color="white">
          {"│ "}
          {line.padEnd(boxWidth)}
          {" │"}
        </Text>
      ))}
      <Text color="white">{`╰${"─".repeat(boxWidth + 2)}╯`}</Text>
    </Box>
  );
}

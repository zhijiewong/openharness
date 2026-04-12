import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";

export type ToolCallState = {
  callId: string;
  toolName: string;
  status: "running" | "done" | "error";
  output?: string;
  args?: string;
  rawArgs?: Record<string, unknown>;
  liveOutput?: string[]; // streaming lines
};

type Props = {
  toolCall: ToolCallState;
};

const MAX_LIVE_LINES = 10;

export default function ToolCallDisplay({ toolCall }: Props) {
  const { toolName, status, output, args, liveOutput } = toolCall;

  const liveLines = liveOutput ?? [];
  const overflow = liveLines.length > MAX_LIVE_LINES ? liveLines.length - MAX_LIVE_LINES : 0;
  const visibleLive = overflow > 0 ? liveLines.slice(-MAX_LIVE_LINES) : liveLines;

  return (
    <Box flexDirection="column" marginLeft={2} marginY={0}>
      <Box>
        {status === "running" ? (
          <Text color="yellow">
            <InkSpinner type="dots" />{" "}
          </Text>
        ) : status === "error" ? (
          <Text color="red">{"✗ "}</Text>
        ) : (
          <Text color="green">{"✓ "}</Text>
        )}
        <Text color="yellow" bold>
          {toolName}
        </Text>
        {status === "running" && args && (
          <Text dimColor>
            {" "}
            {args.slice(0, 60)}
            {args.length > 60 ? "..." : ""}
          </Text>
        )}
      </Box>

      {/* Live streaming output while running */}
      {status === "running" && liveLines.length > 0 && (
        <Box flexDirection="column" marginLeft={4}>
          {overflow > 0 && <Text dimColor>{`... (${overflow} earlier lines)`}</Text>}
          {visibleLive.map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}

      {/* Final output after completion */}
      {output != null && status !== "running" && (
        <Box marginLeft={4}>
          <Text color={status === "error" ? "red" : "gray"} dimColor>
            {truncate(output, 3)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function truncate(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n... (${lines.length} lines)`;
}

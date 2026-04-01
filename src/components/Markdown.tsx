import React from "react";
import { Box, Text } from "ink";
import { marked } from "marked";

const MD_RE = /[#*`|[\]>\-_~]|\n\n/;

export default function Markdown({ children }: { children: string }) {
  if (!children.trim()) return null;
  if (!MD_RE.test(children)) {
    return <Text>{children}</Text>;
  }

  let tokens: any[];
  try {
    tokens = marked.lexer(children);
  } catch {
    return <Text>{children}</Text>;
  }

  return (
    <Box flexDirection="column">
      {tokens.map((t: any, i: number) => (
        <TokenView key={i} token={t} />
      ))}
    </Box>
  );
}

function TokenView({ token }: { token: any }): React.ReactElement | null {
  switch (token.type) {
    case "heading":
      return (
        <Text bold color="cyan">
          {"#".repeat(token.depth ?? 1)} {cleanInline(token.text ?? "")}
        </Text>
      );

    case "paragraph":
      return <Text>{cleanInline(token.text ?? "")}</Text>;

    case "code":
      return (
        <Box flexDirection="column" marginY={0}>
          {token.lang ? (
            <Text dimColor>{"```"}{token.lang}</Text>
          ) : (
            <Text dimColor>{"```"}</Text>
          )}
          <Text dimColor>{token.text ?? ""}</Text>
          <Text dimColor>{"```"}</Text>
        </Box>
      );

    case "list":
      return (
        <Box flexDirection="column">
          {(token.items ?? []).map((item: any, i: number) => (
            <Text key={i}>
              {"  "}{token.ordered ? `${i + 1}.` : "•"} {cleanInline(item.text ?? "")}
            </Text>
          ))}
        </Box>
      );

    case "blockquote":
      return <Text dimColor>│ {cleanInline(token.text ?? "")}</Text>;

    case "hr":
      return <Text dimColor>{"─".repeat(40)}</Text>;

    case "space":
      return null;

    default:
      return token.text ? <Text>{cleanInline(token.text)}</Text> : null;
  }
}

function cleanInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");
}

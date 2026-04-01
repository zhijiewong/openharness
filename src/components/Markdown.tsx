import React from "react";
import { Box, Text } from "ink";
import { marked } from "marked";
import { useTheme } from "../utils/theme.js";

// LRU cache for parsed tokens (max 200 entries)
const LRU_MAX = 200;
const cache = new Map<string, any[]>();

function cachedLex(src: string): any[] {
  const hit = cache.get(src);
  if (hit) {
    cache.delete(src);
    cache.set(src, hit);
    return hit;
  }
  const tokens = marked.lexer(src);
  if (cache.size >= LRU_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(src, tokens as any[]);
  return tokens as any[];
}

const MD_RE = /[#*`|[\]>\-_~]|\n\n/;

export default function Markdown({ children }: { children: string }) {
  const theme = useTheme();

  if (!children.trim()) return null;

  // Fast path: no markdown syntax
  if (!MD_RE.test(children)) {
    return <Text color={theme.text}>{children}</Text>;
  }

  let tokens: any[];
  try {
    tokens = cachedLex(children);
  } catch {
    return <Text color={theme.text}>{children}</Text>;
  }

  return (
    <Box flexDirection="column">
      {tokens.map((t, i) => (
        <TokenView key={i} token={t} theme={theme} />
      ))}
    </Box>
  );
}

function TokenView({
  token,
  theme,
}: {
  token: any;
  theme: ReturnType<typeof import("../utils/theme.js").useTheme>;
}): React.ReactElement | null {
  switch (token.type) {
    case "heading": {
      const t = token;
      return (
        <Text bold color={theme.user}>
          {"#".repeat(t.depth)} {cleanInline(t.text)}
        </Text>
      );
    }

    case "paragraph": {
      const t = token;
      return <Text color={theme.text}>{cleanInline(t.text)}</Text>;
    }

    case "code": {
      const t = token;
      return (
        <Box flexDirection="column" marginY={0}>
          <Text color={theme.dim}>
            {"```"}
            {t.lang ?? ""}
          </Text>
          <Text color={theme.dim}>{t.text}</Text>
          <Text color={theme.dim}>{"```"}</Text>
        </Box>
      );
    }

    case "list": {
      const t = token;
      return (
        <Box flexDirection="column">
          {t.items.map((item: any, i: number) => (
            <Text key={i} color={theme.text}>
              {"  "}
              {t.ordered ? `${i + 1}.` : "•"} {cleanInline(item.text)}
            </Text>
          ))}
        </Box>
      );
    }

    case "table": {
      const t = token;
      // Calculate column widths
      const cols = t.header.length;
      const widths = new Array(cols).fill(0);
      for (let c = 0; c < cols; c++) {
        widths[c] = Math.max(
          widths[c],
          cleanInline(t.header[c]?.text ?? "").length,
        );
        for (const row of t.rows) {
          widths[c] = Math.max(
            widths[c],
            cleanInline(row[c]?.text ?? "").length,
          );
        }
      }

      const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
      const headerLine = t.header
        .map((h: any, c: number) => pad(cleanInline(h.text), widths[c]!))
        .join(" | ");
      const sepLine = widths.map((w) => "─".repeat(w)).join("─┼─");

      return (
        <Box flexDirection="column">
          <Text bold color={theme.text}>
            {headerLine}
          </Text>
          <Text color={theme.dim}>{sepLine}</Text>
          {t.rows.map((row: any[], ri: number) => (
            <Text key={ri} color={theme.text}>
              {row.map((cell: any, c: number) => pad(cleanInline(cell.text), widths[c]!)).join(" | ")}
            </Text>
          ))}
        </Box>
      );
    }

    case "blockquote": {
      const t = token;
      return (
        <Text color={theme.dim}>
          {"│ "}
          {cleanInline(t.text ?? "")}
        </Text>
      );
    }

    case "hr":
      return <Text color={theme.dim}>{"─".repeat(40)}</Text>;

    case "space":
      return null;

    default: {
      const t = token as any;
      return t.text ? (
        <Text color={theme.text}>{cleanInline(t.text)}</Text>
      ) : null;
    }
  }
}

function cleanInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");
}

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../utils/theme.js";
import { summarizeToolArgs } from "../utils/tool-summary.js";
import DiffView from "./DiffView.js";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

type Props = {
  toolName: string;
  description: string;
  riskLevel: string;
  onResolve: (allowed: boolean) => void;
};

/** Try to parse file path and content from tool args for diff display */
function extractFileInfo(toolName: string, description: string): {
  filePath?: string;
  oldContent?: string;
  newContent?: string;
  oldString?: string;
  newString?: string;
} | null {
  try {
    const args = JSON.parse(description);
    const name = toolName.toLowerCase();

    if (name.includes('write') && args.file_path && args.content) {
      const old = existsSync(args.file_path) ? readFileSync(args.file_path, 'utf-8') : '';
      return { filePath: args.file_path, oldContent: old, newContent: args.content };
    }

    if (name.includes('edit') && args.file_path && args.old_string && args.new_string) {
      if (existsSync(args.file_path)) {
        const old = readFileSync(args.file_path, 'utf-8');
        const newContent = old.replace(args.old_string, args.new_string);
        return { filePath: args.file_path, oldContent: old, newContent, oldString: args.old_string, newString: args.new_string };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export default function PermissionPrompt({
  toolName,
  description,
  riskLevel,
  onResolve,
}: Props) {
  const theme = useTheme();
  const [showDiff, setShowDiff] = useState(false);

  const fileInfo = extractFileInfo(toolName, description);
  const hasDiff = fileInfo !== null && fileInfo.oldContent !== undefined && fileInfo.newContent !== undefined;

  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") onResolve(true);
    if (key === "n") onResolve(false);
    if (key === "d" && hasDiff) setShowDiff(prev => !prev);
    if (key === "e" && hasDiff && fileInfo?.newContent) {
      // Open new content in $EDITOR
      const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
      const tmpFile = join(tmpdir(), `oh-edit-${Date.now()}.tmp`);
      try {
        writeFileSync(tmpFile, fileInfo.newContent);
        execSync(`${editor} "${tmpFile}"`, { stdio: 'inherit' });
        // User may have modified — we can't easily integrate the edit back into the tool call
        // Just show a message
        unlinkSync(tmpFile);
      } catch { /* ignore */ }
    }
  });

  const borderColor =
    riskLevel === "high"
      ? theme.error
      : riskLevel === "medium"
        ? theme.warning
        : theme.success;

  const suggestion = summarizeToolArgs(toolName, description);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={2}
      paddingY={0}
      marginY={1}
    >
      <Box>
        <Text color={borderColor} bold>
          {"⚠ "}
        </Text>
        <Text bold>{toolName}</Text>
        <Text color={theme.dim}> {riskLevel} risk</Text>
      </Box>

      {suggestion && (
        <Box marginLeft={2}>
          <Text color={theme.dim}>{suggestion}</Text>
        </Box>
      )}

      {!showDiff && (
        <Box marginLeft={2} marginY={0}>
          <Text>{description.slice(0, 300)}</Text>
        </Box>
      )}

      {showDiff && hasDiff && (
        <Box marginLeft={2} marginY={0}>
          <DiffView
            oldContent={fileInfo!.oldContent!}
            newContent={fileInfo!.newContent!}
            filePath={fileInfo!.filePath ?? ''}
          />
        </Box>
      )}

      <Box marginTop={0}>
        <Text>
          [<Text color={theme.success} bold>Y</Text>]es{" "}
          [<Text color={theme.error} bold>N</Text>]o
          {hasDiff && (
            <>
              {" "}[<Text color="cyan" bold>D</Text>]iff
              {" "}[<Text color="yellow" bold>E</Text>]dit
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
}

// extractSuggestion moved to shared utils/tool-summary.ts as summarizeToolArgs

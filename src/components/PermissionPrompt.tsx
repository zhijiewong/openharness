import { execSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { extractDiffInfo } from "../renderer/diff.js";
import { useTheme } from "../utils/theme.js";
import { summarizeToolArgs } from "../utils/tool-summary.js";
import DiffView from "./DiffView.js";

type Props = {
  toolName: string;
  description: string;
  riskLevel: string;
  onResolve: (allowed: boolean) => void;
};

// extractFileInfo moved to shared renderer/diff.ts as extractDiffInfo

export default function PermissionPrompt({ toolName, description, riskLevel, onResolve }: Props) {
  const theme = useTheme();
  const [showDiff, setShowDiff] = useState(false);

  const fileInfo = extractDiffInfo(toolName, description);
  const hasDiff = fileInfo !== null;

  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") onResolve(true);
    if (key === "n") onResolve(false);
    if (key === "d" && hasDiff) setShowDiff((prev) => !prev);
    if (key === "e" && hasDiff && fileInfo?.newContent) {
      // Open new content in $EDITOR
      const editor = process.env.EDITOR || process.env.VISUAL || "vi";
      const tmpFile = join(tmpdir(), `oh-edit-${Date.now()}.tmp`);
      try {
        writeFileSync(tmpFile, fileInfo.newContent);
        execSync(`${editor} "${tmpFile}"`, { stdio: "inherit" });
        // User may have modified — we can't easily integrate the edit back into the tool call
        // Just show a message
        unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }
    }
  });

  const borderColor = riskLevel === "high" ? theme.error : riskLevel === "medium" ? theme.warning : theme.success;

  const suggestion = summarizeToolArgs(toolName, description);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={2} paddingY={0} marginY={1}>
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
            filePath={fileInfo!.filePath ?? ""}
          />
        </Box>
      )}

      <Box marginTop={0}>
        <Text>
          [
          <Text color={theme.success} bold>
            Y
          </Text>
          ]es [
          <Text color={theme.error} bold>
            N
          </Text>
          ]o
          {hasDiff && (
            <>
              {" "}
              [
              <Text color="cyan" bold>
                D
              </Text>
              ]iff [
              <Text color="yellow" bold>
                E
              </Text>
              ]dit
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
}

// extractSuggestion moved to shared utils/tool-summary.ts as summarizeToolArgs

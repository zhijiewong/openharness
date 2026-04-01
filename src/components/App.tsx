import React, { useMemo } from "react";
import type { Provider } from "../providers/base.js";
import type { Tools } from "../Tool.js";
import type { PermissionMode } from "../types/permissions.js";
import type { Message } from "../types/message.js";
import { loadRulesAsPrompt } from "../harness/rules.js";
import { detectProject, projectContextToPrompt } from "../harness/onboarding.js";
import { ThemeProvider, darkTheme } from "../utils/theme.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import REPL from "./REPL.js";

type AppProps = {
  provider: Provider;
  tools: Tools;
  permissionMode: PermissionMode;
  systemPrompt?: string;
  model?: string;
  initialMessages?: Message[];
};

const DEFAULT_SYSTEM_PROMPT = `You are OpenHarness, an AI coding assistant running in the user's terminal.
You have access to tools for reading, writing, and editing files, running shell commands, and searching the codebase.
Be concise. Use tools proactively to help the user.`;

export default function App({
  provider,
  tools,
  permissionMode,
  systemPrompt,
  model,
  initialMessages,
}: AppProps) {
  const fullSystemPrompt = useMemo(() => {
    const parts: string[] = [systemPrompt || DEFAULT_SYSTEM_PROMPT];

    const projectCtx = detectProject();
    const projectPrompt = projectContextToPrompt(projectCtx);
    if (projectPrompt) parts.push(projectPrompt);

    const rulesPrompt = loadRulesAsPrompt();
    if (rulesPrompt) parts.push(rulesPrompt);

    return parts.join("\n\n");
  }, [systemPrompt]);

  return (
    <ThemeProvider value={darkTheme}>
      <ErrorBoundary>
        <REPL
          provider={provider}
          tools={tools}
          permissionMode={permissionMode}
          systemPrompt={fullSystemPrompt}
          model={model}
          initialMessages={initialMessages}
        />
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export { DEFAULT_SYSTEM_PROMPT };

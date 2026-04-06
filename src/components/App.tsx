import React, { useMemo } from "react";
import type { Provider } from "../providers/base.js";
import type { Tools } from "../Tool.js";
import type { PermissionMode } from "../types/permissions.js";
import type { Message } from "../types/message.js";
import { loadRulesAsPrompt } from "../harness/rules.js";
import { detectProject, projectContextToPrompt } from "../harness/onboarding.js";
import { loadCompanionRuntime, getCompanionSystemPrompt } from "../cybergotchi/config.js";
import { readOhConfig } from "../harness/config.js";
import { setToolPermissionRules } from "../types/permissions.js";
import { loadMemories, memoriesToPrompt } from "../harness/memory.js";
import { discoverSkills, skillsToPrompt } from "../harness/plugins.js";
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
  resumeSessionId?: string;
};

const DEFAULT_SYSTEM_PROMPT = `You are OpenHarness, an AI coding assistant running in the user's terminal.

# Core Behavior
- Be concise. Lead with the answer or action, not the reasoning.
- Use tools proactively to help the user. Read files before suggesting changes.
- When asked to modify code, use the appropriate tool — don't just describe what to change.
- If a tool call fails, diagnose why before retrying. Don't repeat identical failed calls.

# Safety
- Do not introduce security vulnerabilities (injection, XSS, etc.).
- Do not run destructive commands (rm -rf, git reset --hard, etc.) without explicit user approval.
- Do not commit or push unless asked. Do not modify files unrelated to the current task.

# Tool Usage Guidelines
- Use FileRead before editing — understand the code first.
- Use FileEdit for targeted changes. Use FileWrite only for new files or complete rewrites.
- Use Bash for shell commands, test running, builds. Quote file paths with spaces.
- Use Glob to find files by pattern. Use Grep to search file contents by regex.
- Use Agent to delegate complex sub-tasks that benefit from isolation.

# Output Style
- Use markdown for formatting. Include file paths with line numbers when referencing code.
- Keep responses short — if you can say it in one sentence, don't use three.`;

export default function App({
  provider,
  tools,
  permissionMode,
  systemPrompt,
  model,
  initialMessages,
  resumeSessionId,
}: AppProps) {
  const fullSystemPrompt = useMemo(() => {
    // Load per-tool permission rules from config
    const ohConfig = readOhConfig();
    if (ohConfig?.toolPermissions) {
      setToolPermissionRules(ohConfig.toolPermissions);
    }

    const parts: string[] = [systemPrompt || DEFAULT_SYSTEM_PROMPT];

    const projectCtx = detectProject();
    const projectPrompt = projectContextToPrompt(projectCtx);
    if (projectPrompt) parts.push(projectPrompt);

    // Permission mode context
    const modeDescriptions: Record<string, string> = {
      ask: "You are in ASK mode. The user will be prompted to approve risky tool calls.",
      trust: "You are in TRUST mode. All tool calls are auto-approved.",
      deny: "You are in DENY mode. Only read-only tools are allowed.",
      plan: "You are in PLAN mode. Only read-only tools are allowed. Do not make changes — only research and plan.",
      acceptEdits: "You are in ACCEPT-EDITS mode. File reads and edits are auto-approved; other risky tools require approval.",
    };
    const modePrompt = modeDescriptions[permissionMode];
    if (modePrompt) parts.push(`# Permission Mode\n${modePrompt}`);

    const rulesPrompt = loadRulesAsPrompt();
    if (rulesPrompt) parts.push(rulesPrompt);

    // Auto-memory: load saved learnings into context
    const memories = loadMemories();
    const memoryPrompt = memoriesToPrompt(memories);
    if (memoryPrompt) parts.push(memoryPrompt);

    // Skills: inject available skill list
    const skills = discoverSkills();
    const skillsPrompt = skillsToPrompt(skills);
    if (skillsPrompt) parts.push(skillsPrompt);

    // Watcher Protocol: inject companion personality into system prompt
    const companionRuntime = loadCompanionRuntime();
    if (companionRuntime) {
      parts.push(getCompanionSystemPrompt(companionRuntime));
    }

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
          resumeSessionId={resumeSessionId}
        />
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export { DEFAULT_SYSTEM_PROMPT };

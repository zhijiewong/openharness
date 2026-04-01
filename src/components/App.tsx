import React from "react";
import type { Provider } from "../providers/base.js";
import type { Tools } from "../Tool.js";
import type { PermissionMode } from "../types/permissions.js";
import type { Message } from "../types/message.js";
import REPL from "./REPL.js";

type AppProps = {
  provider: Provider;
  tools: Tools;
  permissionMode: PermissionMode;
  systemPrompt: string;
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
  return (
    <REPL
      provider={provider}
      tools={tools}
      permissionMode={permissionMode}
      systemPrompt={systemPrompt || DEFAULT_SYSTEM_PROMPT}
      model={model}
      initialMessages={initialMessages}
    />
  );
}

export { DEFAULT_SYSTEM_PROMPT };

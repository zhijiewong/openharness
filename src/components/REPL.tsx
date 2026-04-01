import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import type { Message } from "../types/message.js";
import type { StreamEvent } from "../types/events.js";
import type { Provider } from "../providers/base.js";
import type { Tools } from "../Tool.js";
import type { PermissionMode } from "../types/permissions.js";
import { createAssistantMessage, createUserMessage } from "../types/message.js";
import { query, type QueryConfig } from "../query.js";
import Messages from "./Messages.js";
import Spinner from "./Spinner.js";
import TextInput from "./TextInput.js";
import PermissionPrompt from "./PermissionPrompt.js";
import type { ToolCallState } from "./ToolCallDisplay.js";

type REPLProps = {
  provider: Provider;
  tools: Tools;
  permissionMode: PermissionMode;
  systemPrompt: string;
  model?: string;
  initialMessages?: Message[];
};

type PendingPermission = {
  toolName: string;
  description: string;
  riskLevel: string;
  resolve: (allowed: boolean) => void;
};

export default function REPL({
  provider,
  tools,
  permissionMode,
  systemPrompt,
  model,
  initialMessages,
}: REPLProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolCalls, setToolCalls] = useState<Map<string, ToolCallState>>(
    new Map(),
  );
  const [pendingPermission, setPendingPermission] =
    useState<PendingPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState(model ?? "");

  const handleSubmit = useCallback(
    async (input: string) => {
      if (input.trim() === "/exit" || input.trim() === "/quit") {
        exit();
        return;
      }

      setLoading(true);
      setStreamingText("");
      setError(null);

      // Add user message to display (query.ts also adds it to its internal state,
      // so we pass messages WITHOUT this message to avoid duplication)
      const userMsg = createUserMessage(input);
      const displayMessages = [...messages, userMsg];
      setMessages(displayMessages);

      const askUser = (
        toolName: string,
        description: string,
      ): Promise<boolean> => {
        return new Promise((resolve) => {
          setPendingPermission({
            toolName,
            description,
            riskLevel: "medium",
            resolve: (allowed: boolean) => {
              setPendingPermission(null);
              resolve(allowed);
            },
          });
        });
      };

      const config: QueryConfig = {
        provider,
        tools,
        systemPrompt,
        permissionMode,
        askUser,
      };

      let accumulatedText = "";

      try {
        for await (const event of query(input, config, messages)) {  // messages = state before userMsg
          switch (event.type) {
            case "text_delta":
              accumulatedText += event.content;
              setStreamingText(accumulatedText);
              break;

            case "tool_call_start":
              setToolCalls((prev) => {
                const next = new Map(prev);
                next.set(event.callId, {
                  callId: event.callId,
                  toolName: event.toolName,
                  status: "running",
                });
                return next;
              });
              break;

            case "tool_call_end":
              setToolCalls((prev) => {
                const next = new Map(prev);
                next.set(event.callId, {
                  callId: event.callId,
                  toolName: next.get(event.callId)?.toolName ?? "unknown",
                  status: event.isError ? "error" : "done",
                  output: event.output,
                });
                return next;
              });
              break;

            case "cost_update":
              setCurrentModel(event.model);
              break;

            case "error":
              setError(event.message);
              break;

            case "turn_complete":
              if (accumulatedText) {
                setMessages((prev) => [
                  ...prev,
                  createAssistantMessage(accumulatedText),
                ]);
              }
              break;
          }
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        setLoading(false);
        setStreamingText("");
      }
    },
    [provider, tools, systemPrompt, permissionMode, messages, exit],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan">{`        ___
       /   \\
      (     )        ___  ___  ___ _  _ _  _   _ ___ _  _ ___ ___ ___
       \`~w~\`        / _ \\| _ \\| __| \\| | || | /_\\ | _ \\ \\| | __/ __/ __|
       (( ))       | (_) |  _/| _|| .\` | __ |/ _ \\|   / .\` | _|\\__ \\__ \\
        ))((        \\___/|_|  |___|_|\\_|_||_/_/ \\_\\_|_\\_|\\_|___|___/___/
       ((  ))
        \`--\``}</Text>
        <Box marginTop={0}>
          <Text bold color="cyan">OpenHarness</Text>
          <Text dimColor> v0.1.0</Text>
          {currentModel ? <Text color="green"> {currentModel}</Text> : null}
          <Text dimColor> ({permissionMode} mode)</Text>
        </Box>
        <Text dimColor>Tools: {tools.map(t => t.name).join(", ")}</Text>
        <Text dimColor>Type "exit" or Ctrl+C to quit.</Text>
      </Box>

      <Messages messages={messages} toolCalls={toolCalls} />

      {loading && streamingText && (
        <Box marginY={0}>
          <Text color="blue" bold>
            Assistant:{" "}
          </Text>
          <Text>{streamingText}</Text>
        </Box>
      )}

      {loading && !streamingText && (
        <Spinner model={currentModel} />
      )}

      {error && (
        <Box>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {pendingPermission && (
        <PermissionPrompt
          toolName={pendingPermission.toolName}
          description={pendingPermission.description}
          riskLevel={pendingPermission.riskLevel}
          onResolve={pendingPermission.resolve}
        />
      )}

      <Box marginTop={1}>
        <TextInput onSubmit={handleSubmit} disabled={loading} />
      </Box>
    </Box>
  );
}

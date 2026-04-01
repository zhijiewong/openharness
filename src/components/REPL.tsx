import React, { useState, useCallback, useRef, useEffect } from "react";
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

const BANNER = `        ___
       /   \\
      (     )        ___  ___  ___ _  _ _  _   _ ___ _  _ ___ ___ ___
       \`~w~\`        / _ \\| _ \\| __| \\| | || | /_\\ | _ \\ \\| | __/ __/ __|
       (( ))       | (_) |  _/| _|| .\` | __ |/ _ \\|   / .\` | _|\\__ \\__ \\
        ))((        \\___/|_|  |___|_|\\_|_||_/_/ \\_\\_|_\\_|\\_|___|___/___/
       ((  ))
        \`--\``;

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
  const [toolCalls, setToolCalls] = useState<Map<string, ToolCallState>>(new Map());
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState(model ?? "");

  // Use a ref to queue the next prompt — useEffect picks it up
  const pendingPromptRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Process queued prompt in useEffect so React can render between state updates
  useEffect(() => {
    const prompt = pendingPromptRef.current;
    if (!prompt || loading) return;
    pendingPromptRef.current = null;

    const run = async () => {
      setLoading(true);
      setStreamingText("");
      setError(null);
      setToolCalls(new Map());

      const askUser = (toolName: string, description: string): Promise<boolean> => {
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

      let accumulated = "";

      try {
        for await (const event of query(prompt, config, messagesRef.current)) {
          switch (event.type) {
            case "text_delta":
              accumulated += event.content;
              setStreamingText(accumulated);
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

            case "tool_call_complete":
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
              if (accumulated) {
                setMessages((prev) => [...prev, createAssistantMessage(accumulated)]);
              }
              break;
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setStreamingText("");
      }
    };

    run();
  }, [loading, provider, tools, systemPrompt, permissionMode]);

  const handleSubmit = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (trimmed === "exit" || trimmed === "quit" || trimmed === "/exit" || trimmed === "/quit") {
        exit();
        return;
      }

      const userMsg = createUserMessage(input);
      setMessages((prev) => [...prev, userMsg]);
      pendingPromptRef.current = input;
      // Force re-render so useEffect picks up the queued prompt
      setLoading(false);
    },
    [exit],
  );

  return (
    <Box flexDirection="column">
      {/* Banner */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="magenta">{BANNER}</Text>
        <Box>
          <Text bold color="magenta">OpenHarness</Text>
          <Text dimColor> v0.1.0</Text>
          <Text color="cyan">{currentModel ? ` ${currentModel}` : ""}</Text>
          <Text dimColor>{` (${permissionMode})`}</Text>
        </Box>
        <Text dimColor>{"─".repeat(60)}</Text>
      </Box>

      {/* Messages */}
      <Messages messages={messages} toolCalls={toolCalls} />

      {/* Streaming response */}
      {loading && streamingText && (
        <Box marginY={0}>
          <Text color="magenta" bold>{"◆ "}</Text>
          <Text>{streamingText}</Text>
        </Box>
      )}

      {/* Spinner */}
      {loading && !streamingText && <Spinner model={currentModel} />}

      {/* Error */}
      {error && (
        <Box marginY={1} borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red">{"✗ "}{error}</Text>
        </Box>
      )}

      {/* Permission prompt */}
      {pendingPermission && (
        <PermissionPrompt
          toolName={pendingPermission.toolName}
          description={pendingPermission.description}
          riskLevel={pendingPermission.riskLevel}
          onResolve={pendingPermission.resolve}
        />
      )}

      {/* Input */}
      <Box marginTop={1}>
        <TextInput onSubmit={handleSubmit} disabled={loading} />
      </Box>
    </Box>
  );
}

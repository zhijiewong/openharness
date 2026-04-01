import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import type { Message } from "../types/message.js";
import type { StreamEvent } from "../types/events.js";
import type { Provider } from "../providers/base.js";
import type { Tools } from "../Tool.js";
import type { PermissionMode } from "../types/permissions.js";
import { createAssistantMessage, createUserMessage } from "../types/message.js";
import { query, type QueryConfig } from "../query.js";
import { createSession, saveSession, loadSession, type Session } from "../harness/session.js";
import { CostTracker, estimateCost } from "../harness/cost.js";
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
  resumeSessionId?: string;
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
  resumeSessionId,
}: REPLProps) {
  const { exit } = useApp();

  // Session and cost tracking
  const sessionRef = useRef<Session>(
    resumeSessionId
      ? (() => { try { return loadSession(resumeSessionId); } catch { return createSession("unknown", model ?? ""); } })()
      : createSession("unknown", model ?? ""),
  );
  const costRef = useRef(new CostTracker());
  const [totalCost, setTotalCost] = useState(0);
  const [sessionId] = useState(sessionRef.current.id);

  const [messages, setMessages] = useState<Message[]>(
    resumeSessionId ? sessionRef.current.messages : (initialMessages ?? []),
  );
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolCalls, setToolCalls] = useState<Map<string, ToolCallState>>(new Map());
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState(model ?? "");

  // Save session on exit
  useEffect(() => {
    return () => {
      sessionRef.current.messages = messages;
      sessionRef.current.totalCost = costRef.current.totalCost;
      try { saveSession(sessionRef.current); } catch { /* ignore */ }
    };
  }, [messages]);

  // Queue prompt submissions — useEffect picks them up for async processing
  const pendingPromptRef = useRef<string | null>(null);
  const [submitCount, setSubmitCount] = useState(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

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
              costRef.current.record(
                "provider", event.model,
                event.inputTokens, event.outputTokens,
                event.cost || estimateCost(event.model, event.inputTokens, event.outputTokens),
              );
              setTotalCost(costRef.current.totalCost);
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
  }, [submitCount, loading, provider, tools, systemPrompt, permissionMode]);

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
      // Increment counter to trigger useEffect (refs don't cause re-renders)
      setSubmitCount((c) => c + 1);
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
        <Text dimColor>
          session {sessionId}{totalCost > 0 ? ` | $${totalCost.toFixed(4)}` : ""}
        </Text>
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

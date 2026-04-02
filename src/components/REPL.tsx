import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import type { Message } from "../types/message.js";
import type { StreamEvent } from "../types/events.js";
import type { Provider } from "../providers/base.js";
import type { Tools } from "../Tool.js";
import type { PermissionMode } from "../types/permissions.js";
import { createAssistantMessage, createUserMessage, createMessage, createInfoMessage } from "../types/message.js";
import { query, type QueryConfig } from "../query.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSession, saveSession, loadSession, type Session } from "../harness/session.js";
import { CostTracker, estimateCost, contextUsage } from "../harness/cost.js";
import { processSlashCommand, type CommandContext } from "../commands/index.js";
import { autoCommitAIEdits, isGitRepo } from "../git/index.js";
import Messages from "./Messages.js";
import Spinner from "./Spinner.js";
import TextInput from "./TextInput.js";
import TextInputComponent from "ink-text-input";
import PermissionPrompt from "./PermissionPrompt.js";
import CybergotchiPanel from "./CybergotchiPanel.js";
import CybergotchiSetup from "./CybergotchiSetup.js";
import type { ToolCallState } from "./ToolCallDisplay.js";
import { useCybergotchi } from "../cybergotchi/useCybergotchi.js";
import { cybergotchiEvents } from "../cybergotchi/events.js";
import { loadCybergotchiConfig, saveCybergotchiConfig } from "../cybergotchi/config.js";

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
      ? (() => { try { return loadSession(resumeSessionId); } catch { return createSession(provider.name, model ?? ""); } })()
      : createSession(provider.name, model ?? ""),
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
  const toolCallsRef = useRef(toolCalls);
  toolCallsRef.current = toolCalls;
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<{
    question: string; options?: string[]; resolve: (answer: string) => void;
  } | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState(model ?? "");
  const [showCybergotchiSetup, setShowCybergotchiSetup] = useState(false);
  const cybergotchi = useCybergotchi();

  // Increment session count on mount
  useEffect(() => {
    const cfg = loadCybergotchiConfig();
    if (cfg) {
      cfg.lifetime.totalSessions += 1;
      saveCybergotchiConfig(cfg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save session on exit
  useEffect(() => {
    return () => {
      sessionRef.current.messages = messages;
      sessionRef.current.totalCost = costRef.current.totalCost;
      try { saveSession(sessionRef.current); } catch { /* ignore */ }
    };
  }, [messages]);

  // Long-wait detection: emit cybergotchi event after 30s of loading
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (loading) {
      loadingTimerRef.current = setTimeout(() => {
        cybergotchiEvents.emit('cybergotchi', { type: 'longWait' });
      }, 30_000);
    } else {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    }
    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [loading]);

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

      const askUserQuestion = (question: string, options?: string[]): Promise<string> => {
        return new Promise((resolve) => {
          setQuestionAnswer("");
          setPendingQuestion({ question, options, resolve: (answer: string) => {
            setPendingQuestion(null);
            resolve(answer);
          }});
        });
      };

      const config: QueryConfig = {
        provider,
        tools,
        systemPrompt,
        permissionMode,
        askUser,
        askUserQuestion,
        model: currentModel || undefined,
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
              setToolCalls((prev) => {
                const next = new Map(prev);
                const existing = next.get(event.callId);
                if (existing) {
                  next.set(event.callId, {
                    ...existing,
                    args: JSON.stringify(event.arguments).slice(0, 80),
                    rawArgs: event.arguments,
                  });
                }
                return next;
              });
              break;

            case "tool_output_delta":
              setToolCalls((prev) => {
                const next = new Map(prev);
                const existing = next.get(event.callId);
                if (existing) {
                  const lines = (existing.liveOutput ?? []);
                  // Split chunk by newlines and append
                  const chunks = event.chunk.split("\n");
                  const merged = [...lines];
                  if (merged.length > 0 && !event.chunk.startsWith("\n")) {
                    merged[merged.length - 1] = (merged[merged.length - 1] ?? "") + chunks[0];
                    merged.push(...chunks.slice(1).filter(c => c !== ""));
                  } else {
                    merged.push(...chunks.filter(c => c !== ""));
                  }
                  next.set(event.callId, { ...existing, liveOutput: merged });
                }
                return next;
              });
              break;

            case "tool_call_end": {
              const toolName = toolCallsRef.current?.get(event.callId)?.toolName ?? "unknown";
              setToolCalls((prev) => {
                const next = new Map(prev);
                next.set(event.callId, {
                  callId: event.callId,
                  toolName,
                  status: event.isError ? "error" : "done",
                  output: event.output,
                });
                return next;
              });
              // Emit cybergotchi event
              cybergotchiEvents.emit('cybergotchi', {
                type: event.isError ? 'toolError' : 'toolSuccess',
                toolName,
              });
              // Git auto-commit for write tools
              if (!event.isError && isGitRepo()) {
                const writeTool = ["Edit", "Write", "Bash"].includes(toolName);
                if (writeTool) {
                  const rawArgs = toolCallsRef.current?.get(event.callId)?.rawArgs ?? {};
                  const filePath = typeof rawArgs.file_path === "string" ? rawArgs.file_path : null;
                  const files = filePath ? [filePath] : [];
                  const hash = autoCommitAIEdits(toolName, files, process.cwd());
                  if (hash) {
                    setMessages((prev) => [...prev, createInfoMessage(`git: committed ${hash}`)]);
                    cybergotchiEvents.emit('cybergotchi', { type: 'commit' });
                  }
                }
              }
              break;
            }

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
              // Auto-save session
              sessionRef.current.messages = messagesRef.current;
              sessionRef.current.totalCost = costRef.current.totalCost;
              try { saveSession(sessionRef.current); } catch { /* ignore */ }
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

      // Check if user is addressing the cybergotchi
      if (cybergotchi.config) {
        const name = cybergotchi.config.name.toLowerCase();
        const lower = trimmed.toLowerCase();
        if (lower.startsWith(`@${name}`) || lower.startsWith(`${name},`) || lower.startsWith(`${name} `)) {
          cybergotchiEvents.emit('cybergotchi', { type: 'userAddressed', text: trimmed });
          return;
        }
      }

      // Process slash commands
      if (trimmed.startsWith("/")) {
        const ctx: CommandContext = {
          messages: messagesRef.current,
          model: currentModel,
          permissionMode,
          totalCost: costRef.current.totalCost,
          totalInputTokens: costRef.current.totalInputTokens,
          totalOutputTokens: costRef.current.totalOutputTokens,
          sessionId,
        };
        const result = processSlashCommand(trimmed, ctx);
        if (result) {
          if (result.openCybergotchiSetup) {
            setShowCybergotchiSetup(true);
            return;
          }
          if (result.resumeSessionId) {
            const sessionDir = join(homedir(), ".oh", "sessions");
            try {
              const sess = loadSession(result.resumeSessionId, sessionDir);
              sessionRef.current = sess;
              setMessages(sess.messages);
            } catch { /* already shown error in output */ }
          }
          if (result.clearMessages) {
            setMessages([]);
          }
          if (result.compactedMessages) {
            setMessages(result.compactedMessages);
          }
          if (result.newModel) {
            setCurrentModel(result.newModel);
          }
          if (result.output) {
            // Show command output as a system message
            setMessages((prev) => [...prev, createInfoMessage(result.output)]);
          }
          if (result.handled) return;
          // If not handled, fall through to send to LLM (e.g., /plan, /review)
          if (result.prependToPrompt) {
            const effectiveInput = result.prependToPrompt + input;
            const userMsg = createUserMessage(input); // show original to user
            setMessages((prev) => [...prev, userMsg]);
            pendingPromptRef.current = effectiveInput; // send augmented to LLM
            setSubmitCount((c) => c + 1);
            return;
          }
        }
      }

      const userMsg = createUserMessage(input);
      setMessages((prev) => [...prev, userMsg]);
      pendingPromptRef.current = input;
      setSubmitCount((c) => c + 1);
    },
    [exit, currentModel, permissionMode, sessionId, cybergotchi.config],
  );

  // Show cybergotchi setup if needed (first run or /cybergotchi reset)
  if (cybergotchi.isSetupNeeded || showCybergotchiSetup) {
    return (
      <CybergotchiSetup
        onComplete={() => {
          cybergotchi.reload();
          setShowCybergotchiSetup(false);
        }}
        onSkip={() => setShowCybergotchiSetup(false)}
      />
    );
  }

  return (
    <Box flexDirection="row">
      {/* Main chat column */}
      <Box flexDirection="column" flexGrow={1}>
        {/* Banner */}
        <Box flexDirection="column" marginBottom={1}>
          <Text color="magenta" wrap="truncate">{BANNER}</Text>
          <Box>
            <Text bold color="magenta">OpenHarness</Text>
            <Text dimColor> v0.3.0</Text>
            <Text color="cyan">{currentModel ? ` ${currentModel}` : ""}</Text>
            <Text dimColor>{` (${permissionMode})`}</Text>
          </Box>
          <Text dimColor>
            session {sessionId}{totalCost > 0 ? ` | $${totalCost.toFixed(4)}` : ""}
          </Text>
          <Text dimColor>{"─".repeat(60)}</Text>
          {cybergotchi.isSetupNeeded && (
            <Text color="cyan">{"✦ No cybergotchi yet — run /cybergotchi to hatch one"}</Text>
          )}
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
        {loading && !streamingText && <Spinner model={currentModel} tokens={costRef.current.totalOutputTokens} />}

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

        {/* AskUser question prompt */}
        {pendingQuestion && (
          <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
            <Text color="yellow">❓ {pendingQuestion.question}</Text>
            {pendingQuestion.options && pendingQuestion.options.length > 0 && (
              <Box flexDirection="column">
                {pendingQuestion.options.map((o, i) => (
                  <Text key={i} dimColor>  {i + 1}. {o}</Text>
                ))}
              </Box>
            )}
            <Box>
              <Text color="yellow">{'❯ '}</Text>
              <TextInputComponent
                value={questionAnswer}
                onChange={setQuestionAnswer}
                onSubmit={(val) => { if (val.trim()) pendingQuestion.resolve(val.trim()); }}
                focus={true}
              />
            </Box>
          </Box>
        )}

        {/* Input */}
        <Box marginTop={1}>
          <TextInput onSubmit={handleSubmit} disabled={loading || !!pendingQuestion} />
        </Box>

        {/* Keybinding hints */}
        <Text dimColor>
          {"exit to quit"}{loading ? " | Ctrl+C to interrupt" : ""}
          {cybergotchi.config ? ` | @${cybergotchi.config.name} to chat` : ""}
        </Text>

        {/* Token context warning */}
        {(() => {
          const usage = contextUsage(currentModel, costRef.current.totalInputTokens);
          if (!usage || usage < 0.75) return null;
          const critical = usage >= 0.9;
          return (
            <Text color={critical ? "yellow" : undefined} bold={critical} dimColor={!critical}>
              {`⚠ Context ~${Math.round(usage * 100)}% full — consider /compact`}
            </Text>
          );
        })()}
      </Box>

      {/* Cybergotchi side panel */}
      {cybergotchi.config && (
        <CybergotchiPanel config={cybergotchi.config} state={cybergotchi.state} />
      )}
    </Box>
  );
}

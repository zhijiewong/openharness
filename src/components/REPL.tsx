import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
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
import { CostTracker, estimateCost, getContextWindow } from "../harness/cost.js";
import { processSlashCommand, type CommandContext } from "../commands/index.js";
import { autoCommitAIEdits, isGitRepo } from "../git/index.js";
import Spinner from "./Spinner.js";
import TextInput from "./TextInput.js";
import TextInputComponent from "ink-text-input";
import PermissionPrompt from "./PermissionPrompt.js";
import CybergotchiPanelConnected from "./CybergotchiPanelConnected.js";
import CybergotchiSetup from "./CybergotchiSetup.js";
import type { ToolCallState } from "./ToolCallDisplay.js";
import { cybergotchiEvents } from "../cybergotchi/events.js";

/** Minimum terminal width to show the companion */
const MIN_WIDTH_FOR_COMPANION = 40;

function getTerminalWidth(): number {
  return process.stdout.columns ?? 80;
}

import { loadCompanionConfig, saveCompanionConfig } from "../cybergotchi/config.js";
import { detectMemories, saveMemory } from "../harness/memory.js";
import { resolveMcpMention } from "../mcp/loader.js";
import { createKeybindingMatcher } from "../harness/keybindings.js";

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
  const abortControllerRef = useRef<AbortController | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
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
  const [vimMode, setVimMode] = useState(false);
  const cybergotchiConfigRef = useRef(loadCompanionConfig());

  // Increment session count on mount
  useEffect(() => {
    const cfg = cybergotchiConfigRef.current;
    if (cfg) {
      cfg.lifetime.totalSessions += 1;
      saveCompanionConfig(cfg);
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

  // Keybinding matcher + pending action ref
  const keybindingMatcher = useRef(createKeybindingMatcher()).current;
  const pendingKeybindAction = useRef<string | null>(null);

  // Ctrl+C during loading aborts; custom keybindings queue actions
  useInput((_input, key) => {
    if (key.ctrl && _input === "c" && loading && abortControllerRef.current) {
      abortControllerRef.current.abort();
      return;
    }

    // Custom keybinding check (only when not loading and not in a prompt)
    if (!loading && !pendingPermission && !pendingQuestion) {
      const action = keybindingMatcher.match(_input, { ctrl: key.ctrl, meta: key.meta, shift: key.shift });
      if (action) {
        pendingKeybindAction.current = action;
      }
    }
  });

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
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setLoading(true);
      setStreamingText("");
      setThinkingText("");
      setError(null);
      setToolCalls(new Map());

      const askUser = (toolName: string, description: string, riskLevel?: string): Promise<boolean> => {
        return new Promise((resolve) => {
          setPendingPermission({
            toolName,
            description,
            riskLevel: riskLevel ?? "medium",
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
        abortSignal: abortController.signal,
      };

      // Resolve @mentions to MCP resource content
      let resolvedPrompt = prompt;
      const mentionPattern = /@(\w[\w.-]*)/g;
      const mentions = [...prompt.matchAll(mentionPattern)].map(m => m[1]!);
      const companionName = cybergotchiConfigRef.current?.soul?.name?.toLowerCase();
      for (const mention of mentions) {
        if (companionName && mention.toLowerCase() === companionName) continue;
        try {
          const content = await resolveMcpMention(mention);
          if (content) {
            resolvedPrompt += `\n\n[Resource @${mention}]:\n${content.slice(0, 5000)}`;
          }
        } catch { /* ignore */ }
      }

      let accumulated = "";

      try {
        for await (const event of query(resolvedPrompt, config, messagesRef.current)) {
          switch (event.type) {
            case "rate_limited":
              setStreamingText(`⏳ Rate limited — retrying in ${event.retryIn}s… (attempt ${event.attempt}/3)`);
              break;

            case "thinking_delta":
              setThinkingText((prev) => prev + event.content);
              break;

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
              setThinkingText("");
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
        if (abortController.signal.aborted) {
          // Interrupted by user — not an error
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        abortControllerRef.current = null;
        setLoading(false);
        setStreamingText("");

        // Auto-memory: detect learnable patterns every 5 turns (async, non-blocking)
        const msgCount = messagesRef.current.length;
        if (msgCount > 0 && msgCount % 10 === 0) {
          detectMemories(provider, messagesRef.current.slice(-10), model)
            .then(memories => {
              for (const m of memories) {
                saveMemory(m.name, m.type, m.description, m.content);
              }
            })
            .catch(() => {/* ignore memory detection errors */});
        }
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
      {
        const gotchiCfg = cybergotchiConfigRef.current;
        if (gotchiCfg) {
          const name = gotchiCfg.soul.name.toLowerCase();
          const lower = trimmed.toLowerCase();
          if (lower.startsWith(`@${name}`) || lower.startsWith(`${name},`) || lower.startsWith(`${name} `)) {
            cybergotchiEvents.emit('cybergotchi', { type: 'userAddressed', text: trimmed });
            return;
          }
        }
      }

      // Handle /vim toggle directly
      if (trimmed === "/vim") {
        setVimMode(v => !v);
        setMessages((prev) => [...prev, createInfoMessage(vimMode ? "Vim mode OFF" : "Vim mode ON")]);
        return;
      }

      // Process slash commands
      if (trimmed.startsWith("/")) {
        const ctx: CommandContext = {
          messages: messagesRef.current,
          model: currentModel,
          providerName: provider.name,
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
            // prependToPrompt already contains the full LLM prompt; don't append the raw slash command
            const userMsg = createUserMessage(input); // show original to user
            setMessages((prev) => [...prev, userMsg]);
            pendingPromptRef.current = result.prependToPrompt;
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
    [exit, currentModel, permissionMode, sessionId],
  );

  // Process pending keybinding actions
  useEffect(() => {
    const action = pendingKeybindAction.current;
    if (action && !loading) {
      pendingKeybindAction.current = null;
      handleSubmit(action);
    }
  });

  // Show cybergotchi setup if needed (first run or /cybergotchi reset)
  if (cybergotchiConfigRef.current === null || showCybergotchiSetup) {
    return (
      <CybergotchiSetup
        onComplete={() => { cybergotchiConfigRef.current = loadCompanionConfig(); setShowCybergotchiSetup(false); }}
        onSkip={() => { cybergotchiConfigRef.current = loadCompanionConfig(); setShowCybergotchiSetup(false); }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {/* Message history — rendered via Static (locked, never re-renders) */}
      <Static items={messages}>
        {(msg: Message, i: number) => {
          const showDivider = msg.role === "user" && i > 0;
          if (msg.role === "user") {
            return (
              <Box key={msg.uuid} flexDirection="column">
                {showDivider && <Text dimColor>{"─".repeat(60)}</Text>}
                <Box><Text color="cyan" bold>{"❯ "}</Text><Text bold>{msg.content}</Text></Box>
              </Box>
            );
          }
          if (msg.role === "assistant") {
            return (
              <Box key={msg.uuid} flexDirection="column">
                {msg.content ? (
                  <Box><Text color="magenta" bold>{"◆ "}</Text><Text>{msg.content}</Text></Box>
                ) : null}
              </Box>
            );
          }
          if (msg.role === "system") {
            return (
              <Box key={msg.uuid}>
                <Text dimColor>{"  "}{msg.content}</Text>
              </Box>
            );
          }
          return <Box key={msg.uuid} />;
        }}
      </Static>

      {/* Live area: streaming, spinner, prompts, input, companion (re-renders freely) */}
      <Box flexDirection="column">

        {/* Thinking */}
        {thinkingText && (
          <Box marginY={0}>
            <Text dimColor>{"💭 "}{thinkingText.length > 200 ? thinkingText.slice(-200) + "…" : thinkingText}</Text>
          </Box>
        )}

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

        {/* Input + Companion footer */}
        <Box flexDirection="row" marginTop={1}>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <TextInput onSubmit={handleSubmit} disabled={loading || !!pendingQuestion} vimMode={vimMode} />
          </Box>
          {/* Companion next to input — hidden on narrow terminals */}
          {getTerminalWidth() >= MIN_WIDTH_FOR_COMPANION && (
            <Box flexShrink={0} width={16}>
              <CybergotchiPanelConnected />
            </Box>
          )}
        </Box>

        {/* Keybinding hints */}
        <Text dimColor>
          {"exit to quit"}{loading ? " | Ctrl+C to interrupt" : ""}
          {cybergotchiConfigRef.current?.soul?.name ? ` | @${cybergotchiConfigRef.current!.soul.name} to chat` : ""}
        </Text>

        {/* Token context warning — estimate from actual message content */}
        {(() => {
          const estimatedTokens = messages.reduce((sum, m) => {
            let t = Math.ceil(m.content.length / 3.5);
            if (m.toolCalls) for (const tc of m.toolCalls) t += Math.ceil(JSON.stringify(tc.arguments).length / 3.5);
            if (m.toolResults) for (const tr of m.toolResults) t += Math.ceil(tr.output.length / 3.5);
            return sum + t;
          }, 0);
          const window = getContextWindow(currentModel);
          const usage = window > 0 ? estimatedTokens / window : 0;
          if (usage < 0.75) return null;
          const critical = usage >= 0.9;
          return (
            <Text color={critical ? "yellow" : undefined} bold={critical} dimColor={!critical}>
              {`⚠ Context ~${Math.round(usage * 100)}% full — consider /compact`}
            </Text>
          );
        })()}
      </Box>
    </Box>
  );
}

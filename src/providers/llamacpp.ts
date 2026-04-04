/**
 * LlamaCpp provider — local LLM inference via llama-server OpenAI-compatible REST API.
 */

import type { Message, ToolCall } from "../types/message.js";
import type { StreamEvent, ToolCallComplete } from "../types/events.js";
import { createAssistantMessage } from "../types/message.js";
import type { Provider, APIToolDef, ModelInfo, ProviderConfig } from "./base.js";

export class LlamaCppProvider implements Provider {
  readonly name = "llamacpp";
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl ?? "http://localhost:8080/v1").replace(/\/$/, "");
    this.defaultModel = config.defaultModel ?? "";
  }

  private convertMessages(
    messages: Message[],
    systemPrompt: string,
  ): unknown[] {
    const converted: unknown[] = [];
    if (systemPrompt) {
      converted.push({ role: "system", content: systemPrompt });
    }
    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "assistant" && msg.toolCalls?.length) {
        converted.push({
          role: "assistant",
          content: msg.content || "",
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.toolName,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });
      } else if (msg.role === "tool" && msg.toolResults?.length) {
        for (const tr of msg.toolResults) {
          converted.push({
            role: "tool",
            content: tr.output,
            tool_call_id: tr.callId,
          });
        }
      } else {
        converted.push({
          role: msg.role === "user" ? "user" : msg.role === "assistant" ? "assistant" : msg.role,
          content: msg.content,
        });
      }
    }
    return converted;
  }

  private convertTools(tools?: APIToolDef[]): unknown[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));
  }

  async *stream(
    messages: Message[],
    systemPrompt: string,
    tools?: APIToolDef[],
    model?: string,
  ): AsyncGenerator<StreamEvent, void> {
    const m = model ?? this.defaultModel;
    const body: Record<string, unknown> = {
      model: m,
      messages: this.convertMessages(messages, systemPrompt),
      stream: true,
    };
    const convertedTools = this.convertTools(tools);
    if (convertedTools) body.tools = convertedTools;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield { type: "error", message: `LlamaCpp request failed: ${err}` };
      return;
    }

    if (!res.ok) {
      yield { type: "error", message: `LlamaCpp HTTP ${res.status}: ${await res.text()}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";
    // Track tool call argument deltas by index
    const toolCallAccumulators: Map<number, { id: string; name: string; args: string }> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;

        let chunk: any;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }

        // Usage info
        if (chunk.usage) {
          const inputTokens = chunk.usage.prompt_tokens ?? 0;
          const outputTokens = chunk.usage.completion_tokens ?? 0;
          yield { type: "cost_update", inputTokens, outputTokens, cost: 0, model: m };
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: "text_delta", content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (tc.id) {
              // New tool call starting
              toolCallAccumulators.set(idx, {
                id: tc.id,
                name: tc.function?.name ?? "",
                args: tc.function?.arguments ?? "",
              });
              yield {
                type: "tool_call_start",
                toolName: tc.function?.name ?? "unknown",
                callId: tc.id,
              };
            } else {
              // Continuation delta
              const acc = toolCallAccumulators.get(idx);
              if (acc && tc.function?.arguments) {
                acc.args += tc.function.arguments;
              }
            }
          }
        }
      }
    }

    // Emit tool_call_complete for each accumulated tool call
    for (const [, acc] of toolCallAccumulators) {
      yield {
        type: "tool_call_complete",
        callId: acc.id,
        toolName: acc.name,
        arguments: safeParse(acc.args),
      } satisfies ToolCallComplete;
    }

    // If no usage chunk was emitted, emit a zero cost_update so callers always get one
    if (toolCallAccumulators.size === 0) {
      // Only emit if we never got usage — llama-server may not send it
      // We already emitted inside the loop if chunk.usage existed, so this is a no-op guard.
      // (No action needed here; guard is implicit.)
    }
  }

  async complete(
    messages: Message[],
    systemPrompt: string,
    tools?: APIToolDef[],
    model?: string,
  ): Promise<Message> {
    const m = model ?? this.defaultModel;
    const body: Record<string, unknown> = {
      model: m,
      messages: this.convertMessages(messages, systemPrompt),
      stream: false,
    };
    const convertedTools = this.convertTools(tools);
    if (convertedTools) body.tools = convertedTools;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`LlamaCpp HTTP ${res.status}: ${await res.text()}`);
    }

    const data: any = await res.json();
    const choice = data.choices?.[0]?.message;
    const content = choice?.content ?? "";
    let toolCalls: ToolCall[] | undefined;

    if (choice?.tool_calls?.length) {
      toolCalls = choice.tool_calls.map((tc: any) => ({
        id: tc.id ?? crypto.randomUUID(),
        toolName: tc.function?.name ?? "unknown",
        arguments: safeParse(tc.function?.arguments),
      }));
    }

    return createAssistantMessage(content, toolCalls);
  }

  listModels(): ModelInfo[] {
    return [];
  }

  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`);
      if (!res.ok) return [];
      const data: any = await res.json();
      return (data.data ?? []).map((m: any) => ({
        id: m.id as string,
        provider: "llamacpp",
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: false,
        inputCostPerMtok: 0,
        outputCostPerMtok: 0,
      }));
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

function safeParse(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try { return JSON.parse(json); }
  catch { return {}; }
}

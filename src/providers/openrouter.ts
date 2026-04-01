/**
 * OpenRouter provider — aggregated LLM access via OpenAI-compatible API.
 */

import type { Message, ToolCall } from "../types/message.js";
import type { StreamEvent, ToolCallComplete } from "../types/events.js";
import { createAssistantMessage } from "../types/message.js";
import type { Provider, APIToolDef, ModelInfo, ProviderConfig } from "./base.js";

export class OpenRouterProvider implements Provider {
  readonly name = "openrouter";
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private cachedModels: ModelInfo[] | null = null;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? "";
    this.baseUrl = (config.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.defaultModel = config.defaultModel ?? "anthropic/claude-sonnet-4-6";
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "HTTP-Referer": "https://github.com/openharness",
      "X-Title": "OpenHarness CLI",
    };
  }

  private convertMessages(messages: Message[], systemPrompt: string): unknown[] {
    const out: unknown[] = [{ role: "system", content: systemPrompt }];

    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "assistant" && msg.toolCalls?.length) {
        out.push({
          role: "assistant",
          content: msg.content || null,
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
          out.push({
            role: "tool",
            tool_call_id: tr.callId,
            content: tr.output,
          });
        }
      } else {
        out.push({ role: msg.role, content: msg.content });
      }
    }
    return out;
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
    if (tools?.length) body.tools = tools;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield { type: "error", message: `OpenRouter request failed: ${err}` };
      return;
    }

    if (!res.ok) {
      yield { type: "error", message: `OpenRouter HTTP ${res.status}: ${await res.text()}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";
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

        if (chunk.usage) {
          const inputTokens = chunk.usage.prompt_tokens ?? 0;
          const outputTokens = chunk.usage.completion_tokens ?? 0;
          yield {
            type: "cost_update",
            inputTokens,
            outputTokens,
            cost: 0, // OpenRouter pricing varies; let caller resolve
            model: m,
          };
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
        arguments: acc.args ? JSON.parse(acc.args) : {},
      } satisfies ToolCallComplete;
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
    if (tools?.length) body.tools = tools;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text()}`);
    }

    const data: any = await res.json();
    const choice = data.choices?.[0]?.message;
    const content = choice?.content ?? "";
    let toolCalls: ToolCall[] | undefined;

    if (choice?.tool_calls?.length) {
      toolCalls = choice.tool_calls.map((tc: any) => ({
        id: tc.id,
        toolName: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    return createAssistantMessage(content, toolCalls);
  }

  listModels(): ModelInfo[] {
    // Return cached models if fetched, otherwise a curated default set
    if (this.cachedModels) return this.cachedModels;
    return [
      {
        id: "anthropic/claude-sonnet-4-6",
        provider: "openrouter",
        contextWindow: 200_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: true,
        inputCostPerMtok: 3,
        outputCostPerMtok: 15,
      },
      {
        id: "openai/gpt-4o",
        provider: "openrouter",
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: true,
        inputCostPerMtok: 2.5,
        outputCostPerMtok: 10,
      },
      {
        id: "google/gemini-2.5-pro",
        provider: "openrouter",
        contextWindow: 1_000_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: true,
        inputCostPerMtok: 1.25,
        outputCostPerMtok: 10,
      },
      {
        id: "meta-llama/llama-3.1-405b-instruct",
        provider: "openrouter",
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: false,
        inputCostPerMtok: 2,
        outputCostPerMtok: 2,
      },
    ];
  }

  /**
   * Fetch and cache the full model list from OpenRouter.
   */
  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
      });
      if (!res.ok) return this.listModels();

      const data: any = await res.json();
      this.cachedModels = (data.data ?? []).map((m: any) => ({
        id: m.id,
        provider: "openrouter",
        contextWindow: m.context_length ?? 4096,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: false,
        inputCostPerMtok: parseFloat(m.pricing?.prompt ?? "0") * 1_000_000,
        outputCostPerMtok: parseFloat(m.pricing?.completion ?? "0") * 1_000_000,
      }));
      return this.cachedModels!;
    } catch {
      return this.listModels();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

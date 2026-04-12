/**
 * OpenAI-compatible provider — works with OpenAI, DeepSeek, Groq, Together, etc.
 */

import { IMAGE_PREFIX } from "../tools/ImageReadTool/index.js";
import type { StreamEvent, ToolCallComplete } from "../types/events.js";
import type { Message, ToolCall } from "../types/message.js";
import { createAssistantMessage } from "../types/message.js";
import type { APIToolDef, ModelInfo, Provider, ProviderConfig } from "./base.js";

export class OpenAIProvider implements Provider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.name = config.name || "openai";
    this.apiKey = config.apiKey ?? "";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.defaultModel = config.defaultModel ?? "gpt-4o";
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
          if (!tr.isError && tr.output.startsWith(`${IMAGE_PREFIX}:`)) {
            const [, mediaType, data] = tr.output.split(":");
            out.push({
              role: "tool",
              tool_call_id: tr.callId,
              content: [{ type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } }],
            });
          } else {
            out.push({
              role: "tool",
              tool_call_id: tr.callId,
              content: tr.output,
            });
          }
        }
      } else {
        out.push({ role: msg.role, content: msg.content });
      }
    }
    return out;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
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
      stream_options: { include_usage: true },
    };
    if (tools?.length) body.tools = tools;

    // Enable reasoning for o-series models
    if (m.startsWith("o1") || m.startsWith("o3")) {
      body.reasoning_effort = "medium";
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield { type: "error", message: `OpenAI request failed: ${err}` };
      return;
    }

    if (!res.ok) {
      yield { type: "error", message: `OpenAI HTTP ${res.status}: ${await res.text()}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { type: "error", message: "OpenAI: response body is not readable" };
      return;
    }

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

        // Usage info (final chunk with stream_options)
        if (chunk.usage) {
          const inputTokens = chunk.usage.prompt_tokens ?? 0;
          const outputTokens = chunk.usage.completion_tokens ?? 0;
          const info = this.getModelInfo(m);
          const cost =
            (inputTokens * (info?.inputCostPerMtok ?? 0) + outputTokens * (info?.outputCostPerMtok ?? 0)) / 1_000_000;
          yield { type: "cost_update", inputTokens, outputTokens, cost, model: m };
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: "text_delta", content: delta.content };
        }

        if (delta.reasoning_content) {
          yield { type: "thinking_delta" as const, content: delta.reasoning_content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (tc.id) {
              // New tool call
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
  }

  async complete(messages: Message[], systemPrompt: string, tools?: APIToolDef[], model?: string): Promise<Message> {
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
      throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
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

  getModelInfo(id: string): ModelInfo | undefined {
    return this.listModels().find((m) => m.id === id);
  }

  listModels(): ModelInfo[] {
    return [
      {
        id: "gpt-4o",
        provider: this.name,
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: true,
        inputCostPerMtok: 2.5,
        outputCostPerMtok: 10,
      },
      {
        id: "gpt-4o-mini",
        provider: this.name,
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: true,
        inputCostPerMtok: 0.15,
        outputCostPerMtok: 0.6,
      },
      {
        id: "o3-mini",
        provider: this.name,
        contextWindow: 200_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: false,
        inputCostPerMtok: 1.1,
        outputCostPerMtok: 4.4,
      },
    ];
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

function safeParse(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

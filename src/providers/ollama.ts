/**
 * Ollama provider — local LLM inference via Ollama REST API.
 */

import type { Message, ToolCall } from "../types/message.js";
import type { StreamEvent, ToolCallComplete } from "../types/events.js";
import { createAssistantMessage } from "../types/message.js";
import type { Provider, APIToolDef, ModelInfo, ProviderConfig } from "./base.js";

export class OllamaProvider implements Provider {
  readonly name = "ollama";
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.defaultModel = config.defaultModel ?? "llama3.1";
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
    const msgs = this.convertMessages(messages, systemPrompt);
    const body: Record<string, unknown> = {
      model: m,
      messages: msgs,
      stream: true,
    };
    const ollamaTools = this.convertTools(tools);
    if (ollamaTools) body.tools = ollamaTools;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield { type: "error", message: `Ollama request failed: ${err}` };
      return;
    }

    if (!res.ok) {
      yield { type: "error", message: `Ollama HTTP ${res.status}: ${await res.text()}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { type: "error", message: "Ollama: response body is not readable" };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let inThinkBlock = false;
    let thinkBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let chunk: any;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }

        // Handle Ollama errors embedded in the stream
        if (chunk.error) {
          yield { type: "error", message: `Ollama: ${chunk.error}` };
          return;
        }

        if (chunk.message?.content) {
          // Parse <think> tags — yield thinking_delta for think blocks, text_delta for normal text
          let remaining = chunk.message.content;
          while (remaining.length > 0) {
            if (inThinkBlock) {
              const closeIdx = remaining.indexOf("</think>");
              if (closeIdx !== -1) {
                thinkBuffer += remaining.slice(0, closeIdx);
                if (thinkBuffer) {
                  yield { type: "thinking_delta" as const, content: thinkBuffer };
                }
                thinkBuffer = "";
                inThinkBlock = false;
                remaining = remaining.slice(closeIdx + "</think>".length);
              } else {
                thinkBuffer += remaining;
                remaining = "";
              }
            } else {
              const openIdx = remaining.indexOf("<think>");
              if (openIdx !== -1) {
                if (openIdx > 0) {
                  yield { type: "text_delta", content: remaining.slice(0, openIdx) };
                }
                inThinkBlock = true;
                remaining = remaining.slice(openIdx + "<think>".length);
              } else {
                yield { type: "text_delta", content: remaining };
                remaining = "";
              }
            }
          }
        }

        if (chunk.message?.tool_calls) {
          for (const tc of chunk.message.tool_calls) {
            const callId = tc.id ?? crypto.randomUUID();
            const toolName = tc.function?.name ?? "unknown";
            yield {
              type: "tool_call_start",
              toolName,
              callId,
            };
            const args =
              typeof tc.function?.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function?.arguments ?? {};
            yield {
              type: "tool_call_complete",
              callId,
              toolName,
              arguments: args,
            } satisfies ToolCallComplete;
          }
        }

        if (chunk.done) {
          const inputTokens = chunk.prompt_eval_count ?? 0;
          const outputTokens = chunk.eval_count ?? 0;
          yield {
            type: "cost_update",
            inputTokens,
            outputTokens,
            cost: 0,
            model: m,
          };
        }
      }
    }
  }

  async complete(
    messages: Message[],
    systemPrompt: string,
    tools?: APIToolDef[],
    model?: string,
  ): Promise<Message> {
    const m = model ?? this.defaultModel;
    const msgs = this.convertMessages(messages, systemPrompt);
    const body: Record<string, unknown> = {
      model: m,
      messages: msgs,
      stream: false,
    };
    const ollamaTools = this.convertTools(tools);
    if (ollamaTools) body.tools = ollamaTools;

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }

    const data: any = await res.json();
    const content = data.message?.content ?? "";
    let toolCalls: ToolCall[] | undefined;

    if (data.message?.tool_calls?.length) {
      toolCalls = data.message.tool_calls.map((tc: any) => ({
        id: tc.id ?? crypto.randomUUID(),
        toolName: tc.function?.name ?? "unknown",
        arguments:
          typeof tc.function?.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function?.arguments ?? {},
      }));
    }

    return createAssistantMessage(content, toolCalls);
  }

  listModels(): ModelInfo[] {
    return [];
  }

  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data: any = await res.json();
      return (data.models ?? []).map((m: any) => {
        // Detect vision support from model families
        // Presence of "clip" or "llava" in families indicates vision capability
        const families = m.details?.families ?? [];
        const supportsVision = Array.isArray(families) &&
          families.some((f: string) => f.includes("clip") || f.includes("llava"));

        return {
          id: m.name as string,
          provider: "ollama",
          // Default context window: Ollama's /api/tags doesn't expose context_window,
          // so 128K is a reasonable default for modern LLMs
          contextWindow: 128_000,
          // Safe default: modern models typically support tools
          supportsTools: true,
          supportsStreaming: true,
          supportsVision,
          inputCostPerMtok: 0,
          outputCostPerMtok: 0,
        };
      });
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

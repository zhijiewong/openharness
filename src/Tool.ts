/**
 * Tool interface — defines how tools are registered, validated, and executed.
 * Every tool implements this interface with Zod input validation.
 */

import type { z } from "zod";
import type { PermissionMode, RiskLevel } from "./types/permissions.js";
import type { Provider } from "./providers/base.js";

export type ToolResult = {
  output: string;
  isError: boolean;
};

export type ToolContext = {
  workingDir: string;
  abortSignal?: AbortSignal;
  callId?: string;
  onOutputChunk?: (callId: string, chunk: string) => void;
  /** Available for sub-agent tools (AgentTool) */
  provider?: Provider;
  model?: string;
  tools?: Tool[];
  systemPrompt?: string;
  /** Permission mode inherited from parent session */
  permissionMode?: PermissionMode;
  /** Ask the user a question; resolves with their answer string */
  askUserQuestion?: (question: string, options?: string[]) => Promise<string>;
};

export type Tool<Input extends z.ZodType = z.ZodType> = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Input;
  readonly riskLevel: RiskLevel;

  /** Whether this invocation is read-only (no side effects). */
  isReadOnly(input: z.infer<Input>): boolean;

  /** Whether this tool can run in parallel with other tools. */
  isConcurrencySafe(input: z.infer<Input>): boolean;

  /** Execute the tool. */
  call(input: z.infer<Input>, context: ToolContext): Promise<ToolResult>;

  /** Generate the prompt description for the LLM. */
  prompt(): string;
};

export type Tools = Tool[];

/**
 * Convert tool to the format expected by OpenAI-compatible APIs.
 */
export function toolToAPIFormat(tool: Tool): {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
} {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.prompt(),
      parameters: zodToJsonSchema(tool.inputSchema),
    },
  };
}

/**
 * Simple Zod-to-JSON-Schema converter for tool parameters.
 * Handles the common cases (object, string, number, boolean, optional).
 */
function zodToJsonSchema(schema: z.ZodType): unknown {
  // Zod provides .description and ._def for introspection
  const def = (schema as any)._def;

  if (def?.typeName === "ZodObject") {
    const shape = (schema as z.ZodObject<any>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const field = value as z.ZodType;
      const fieldDef = (field as any)._def;

      if (fieldDef?.typeName === "ZodOptional") {
        properties[key] = zodToJsonSchema(fieldDef.innerType);
      } else {
        properties[key] = zodToJsonSchema(field);
        required.push(key);
      }

      // Add description if present
      if ((field as any).description) {
        (properties[key] as any).description = (field as any).description;
      }
    }

    return { type: "object", properties, required };
  }

  if (def?.typeName === "ZodString") return { type: "string" };
  if (def?.typeName === "ZodNumber") return { type: "number" };
  if (def?.typeName === "ZodBoolean") return { type: "boolean" };
  if (def?.typeName === "ZodArray")
    return { type: "array", items: zodToJsonSchema(def.type) };

  return { type: "string" }; // fallback
}

/**
 * Find a tool by name from a list of tools.
 */
export function findToolByName(tools: Tools, name: string): Tool | undefined {
  return tools.find((t) => t.name === name);
}

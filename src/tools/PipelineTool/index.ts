import { z } from "zod";
import { formatPipelineResults, PipelineExecutor } from "../../services/PipelineExecutor.js";
import type { Tool, ToolContext, ToolResult } from "../../Tool.js";

const stepSchema = z.object({
  id: z.string().describe("Unique step identifier"),
  tool: z.string().describe("Tool name to execute (Glob, Grep, Read, Bash, etc.)"),
  args: z.record(z.unknown()).describe("Tool arguments. Use $stepId to reference output of a prior step."),
  dependsOn: z.array(z.string()).optional().describe("Step IDs that must complete before this step runs"),
});

const inputSchema = z.object({
  steps: z.array(stepSchema).min(1).describe("Pipeline steps to execute in dependency order"),
  description: z.string().optional().describe("What this pipeline does"),
});

export const PipelineTool: Tool<typeof inputSchema> = {
  name: "Pipeline",
  description:
    "Execute a declarative multi-step tool pipeline. Steps run in dependency order with variable substitution.",
  inputSchema,
  riskLevel: "medium",

  isReadOnly(_input) {
    // Pipeline is read-only only if ALL steps use read-only tools
    // Conservative: assume not read-only
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(input, context: ToolContext): Promise<ToolResult> {
    if (!context.tools) {
      return { output: "Pipeline unavailable: no tools in context.", isError: true };
    }

    const executor = new PipelineExecutor(context.tools, context);
    const results = await executor.execute(input.steps);
    const summary = formatPipelineResults(results);
    const hasErrors = results.some((r) => r.isError);

    return { output: summary, isError: hasErrors };
  },

  prompt() {
    return `Execute a declarative multi-step tool pipeline. Each step specifies a tool and its arguments, with optional dependencies on prior steps. Use $stepId in args to reference the output of a completed step.

Example:
{
  "steps": [
    { "id": "find", "tool": "Glob", "args": { "pattern": "src/**/*.ts" } },
    { "id": "search", "tool": "Grep", "args": { "pattern": "TODO", "path": "$find" }, "dependsOn": ["find"] }
  ],
  "description": "Find all TODO comments in TypeScript files"
}

Parameters:
- steps (array, required): Pipeline steps with id, tool, args, and optional dependsOn
- description (string, optional): What this pipeline does`;
  },
};

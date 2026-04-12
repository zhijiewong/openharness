import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

/**
 * Generate a memorable plan filename from three random words.
 * Pattern: adjective-verb-noun (e.g., "twinkling-riding-crown")
 */
function generatePlanName(): string {
  const adjectives = [
    "bright",
    "calm",
    "dark",
    "eager",
    "fast",
    "gentle",
    "happy",
    "keen",
    "light",
    "merry",
    "noble",
    "plain",
    "quiet",
    "rare",
    "sharp",
    "tall",
    "vivid",
    "warm",
    "young",
    "bold",
    "clean",
    "deep",
    "fair",
    "grand",
  ];
  const verbs = [
    "flying",
    "riding",
    "singing",
    "dancing",
    "running",
    "walking",
    "building",
    "crafting",
    "drawing",
    "growing",
    "hiding",
    "jumping",
    "leading",
    "making",
    "passing",
    "rising",
    "saving",
    "taking",
    "turning",
    "watching",
  ];
  const nouns = [
    "arrow",
    "badge",
    "crown",
    "dream",
    "flame",
    "grove",
    "heart",
    "ivory",
    "jewel",
    "knot",
    "latch",
    "maple",
    "night",
    "ocean",
    "pearl",
    "quest",
    "ridge",
    "stone",
    "tower",
    "vault",
    "whale",
    "zenith",
  ];
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(adjectives)}-${pick(verbs)}-${pick(nouns)}`;
}

const inputSchema = z.object({});

export const EnterPlanModeTool: Tool<typeof inputSchema> = {
  name: "EnterPlanMode",
  description: "Enter plan mode, creating a unique plan file in .oh/plans/.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(_input, context): Promise<ToolResult> {
    const plansDir = path.join(context.workingDir, ".oh", "plans");
    const planName = generatePlanName();
    const filePath = path.join(plansDir, `${planName}.md`);

    try {
      await fs.mkdir(plansDir, { recursive: true });
      await fs.writeFile(filePath, `# Plan\n\n<!-- Write your plan here -->\n`, "utf-8");

      return {
        output: `Plan mode entered. Plan file: ${filePath}\nWrite your plan to this file using the Write or Edit tool.`,
        isError: false,
      };
    } catch (err: any) {
      return { output: `Error entering plan mode: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Enter plan mode. Creates a unique plan file at .oh/plans/<name>.md. Write your plan to this file, then call ExitPlanMode when done. No parameters required.`;
  },
};

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../Tool.js";

const SUPPORTED_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

const inputSchema = z.object({
  file_path: z.string(),
});

export const IMAGE_PREFIX = "__IMAGE__";

export const ImageReadTool: Tool<typeof inputSchema> = {
  name: "ImageRead",
  description: "Read an image file and return it as base64 for multimodal analysis.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return true;
  },

  async call(input, context: ToolContext): Promise<ToolResult> {
    const filePath = path.isAbsolute(input.file_path)
      ? input.file_path
      : path.resolve(context.workingDir, input.file_path);

    const ext = path.extname(filePath).toLowerCase();
    const mediaType = SUPPORTED_TYPES[ext];
    if (!mediaType) {
      return {
        output: `Unsupported image type: ${ext}. Supported: ${Object.keys(SUPPORTED_TYPES).join(", ")}`,
        isError: true,
      };
    }

    try {
      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString("base64");
      return {
        output: `${IMAGE_PREFIX}:${mediaType}:${base64}`,
        isError: false,
      };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { output: `File not found: ${filePath}`, isError: true };
      }
      return { output: `Error reading image: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Read an image or PDF file and send it to the model for visual analysis. Parameters:
- file_path (string, required): Path to an image file (.png, .jpg, .jpeg, .gif, .webp, .pdf).`;
  },
};

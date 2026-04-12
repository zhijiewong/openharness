import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  file_path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
  pages: z.string().optional(),
});

const DEFAULT_LIMIT = 2000;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const NOTEBOOK_EXTENSION = ".ipynb";

function parsePageRange(pages: string): number[] {
  const result: number[] = [];
  for (const part of pages.split(",")) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      const [start, end] = trimmed.split("-").map(Number);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        for (let i = start; i <= Math.min(end, start + 19); i++) result.push(i);
      }
    } else {
      const n = Number(trimmed);
      if (!Number.isNaN(n)) result.push(n);
    }
  }
  return result.slice(0, 20); // Max 20 pages
}

export const FileReadTool: Tool<typeof inputSchema> = {
  name: "Read",
  description: "Read a file from the filesystem. Supports text files, images, PDFs, and Jupyter notebooks.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return true;
  },

  async call(input, context): Promise<ToolResult> {
    const filePath = path.isAbsolute(input.file_path)
      ? input.file_path
      : path.resolve(context.workingDir, input.file_path);

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        return { output: `Error: ${filePath} is a directory, not a file.`, isError: true };
      }

      const ext = path.extname(filePath).toLowerCase();

      // Image files: return as base64
      if (IMAGE_EXTENSIONS.has(ext)) {
        const buffer = await fs.readFile(filePath);
        const base64 = buffer.toString("base64");
        const mimeTypes: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".bmp": "image/bmp",
          ".svg": "image/svg+xml",
        };
        return { output: `__IMAGE__:${mimeTypes[ext] ?? "image/png"}:${base64}`, isError: false };
      }

      // PDF files: extract text per page (basic extraction)
      if (ext === ".pdf") {
        // Guard against very large PDFs without page filter
        if (stat.size > 20 * 1024 * 1024 && !input.pages) {
          return {
            output: `PDF is ${(stat.size / 1024 / 1024).toFixed(1)} MB. Provide a 'pages' parameter (e.g., "1-5") to read specific pages.`,
            isError: true,
          };
        }
        const buffer = await fs.readFile(filePath);
        // Basic PDF text extraction — look for text between BT/ET markers or stream content
        const text = buffer.toString("latin1");
        const pages = input.pages ? parsePageRange(input.pages) : undefined;

        // Simple page boundary detection via /Page markers
        const pageTexts: string[] = [];
        const pageMatches = text.split(/\/Type\s*\/Page[^s]/);
        // Skip first chunk (PDF header)
        for (let i = 1; i < pageMatches.length; i++) {
          if (pages && !pages.includes(i)) continue;
          // Extract text content between parentheses in BT..ET blocks
          const btEtRegex = /BT\s*([\s\S]*?)ET/g;
          let pageText = "";
          let match;
          while ((match = btEtRegex.exec(pageMatches[i])) !== null) {
            const tjRegex = /\(([^)]*)\)\s*Tj/g;
            let tj;
            while ((tj = tjRegex.exec(match[1])) !== null) {
              pageText += tj[1];
            }
          }
          if (pageText.trim()) {
            pageTexts.push(`--- Page ${i} ---\n${pageText.trim()}`);
          }
        }

        if (pageTexts.length > 0) {
          return { output: pageTexts.join("\n\n"), isError: false };
        }

        // Fallback: return as base64 for multimodal analysis
        const base64 = buffer.toString("base64");
        return { output: `__IMAGE__:application/pdf:${base64}`, isError: false };
      }

      // Jupyter notebooks: render cells
      if (ext === NOTEBOOK_EXTENSION) {
        const raw = await fs.readFile(filePath, "utf-8");
        const notebook = JSON.parse(raw);
        const cells = notebook.cells ?? [];
        const parts: string[] = [];
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source;
          const cellType = cell.cell_type ?? "code";
          parts.push(`[Cell ${i} - ${cellType}]\n${source}`);
          // Include text outputs
          if (cell.outputs) {
            for (const out of cell.outputs) {
              if (out.text) {
                const text = Array.isArray(out.text) ? out.text.join("") : out.text;
                parts.push(`[Output]\n${text}`);
              }
            }
          }
        }
        return { output: parts.join("\n\n"), isError: false };
      }

      // Default: text file
      const content = await fs.readFile(filePath, "utf-8");
      const allLines = content.split("\n");
      const offset = Math.max(0, (input.offset ?? 1) - 1);
      const limit = input.limit ?? DEFAULT_LIMIT;
      const lines = allLines.slice(offset, offset + limit);

      const numbered = lines.map((line, i) => `${offset + i + 1}\t${line}`).join("\n");

      const total = allLines.length;
      const shown = lines.length;
      let result = numbered;
      if (shown < total) {
        result += `\n\n(Showing lines ${offset + 1}-${offset + shown} of ${total})`;
      }

      return { output: result, isError: false };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { output: `Error: File not found: ${filePath}`, isError: true };
      }
      if (err.code === "EACCES") {
        return { output: `Error: Permission denied: ${filePath}`, isError: true };
      }
      return { output: `Error reading file: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Read a file and return its contents. Supports text files, images, PDFs, and Jupyter notebooks. Parameters:
- file_path (string, required): Absolute or relative path to the file.
- offset (number, optional): Line number to start from (1-based, default 1). For text files only.
- limit (number, optional): Maximum number of lines to return (default 2000). For text files only.
- pages (string, optional): Page range for PDF files (e.g., "1-5", "3", "10-20"). Max 20 pages per request.
Images are returned as base64 for multimodal analysis. Jupyter notebooks show all cells with outputs.`;
  },
};

import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";
import { LspClient } from "../../lsp/client.js";

const inputSchema = z.object({
  file_path: z.string().describe("Absolute path to the file to check"),
  action: z.enum(["diagnostics", "definition", "references", "hover"]).default("diagnostics")
    .describe("Action: diagnostics (errors/warnings), definition (go-to-def), references (find-refs), hover (type info)"),
  line: z.number().optional().describe("Line number (0-indexed) for definition/references"),
  character: z.number().optional().describe("Column number (0-indexed) for definition/references"),
});

// Singleton LSP client per language server
const lspClients = new Map<string, LspClient>();

function getLspCommand(filePath: string): { command: string; args: string[] } | null {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
    return { command: 'npx', args: ['typescript-language-server', '--stdio'] };
  }
  if (filePath.endsWith('.py')) {
    return { command: 'pylsp', args: [] };
  }
  if (filePath.endsWith('.go')) {
    return { command: 'gopls', args: ['serve'] };
  }
  if (filePath.endsWith('.rs')) {
    return { command: 'rust-analyzer', args: [] };
  }
  return null;
}

async function getClient(filePath: string, workingDir: string): Promise<LspClient | null> {
  const lspCmd = getLspCommand(filePath);
  if (!lspCmd) return null;

  const key = `${lspCmd.command}:${workingDir}`;
  if (lspClients.has(key)) return lspClients.get(key)!;

  try {
    const client = await LspClient.connect(lspCmd.command, lspCmd.args, workingDir);
    lspClients.set(key, client);
    return client;
  } catch {
    return null;
  }
}

export const DiagnosticsTool: Tool<typeof inputSchema> = {
  name: "Diagnostics",
  description: "Get code diagnostics (errors, warnings), go-to-definition, or find-references using the language server.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() { return true; },
  isConcurrencySafe() { return true; },

  async call(input, context: ToolContext): Promise<ToolResult> {
    const client = await getClient(input.file_path, context.workingDir);
    if (!client) {
      return {
        output: `No language server available for ${input.file_path}. Install typescript-language-server (TS/JS) or pylsp (Python).`,
        isError: true,
      };
    }

    try {
      if (input.action === "diagnostics") {
        await client.openFile(input.file_path);
        const diags = client.getDiagnostics(input.file_path);
        if (diags.length === 0) return { output: "No diagnostics found.", isError: false };

        const severityMap: Record<number, string> = { 1: "Error", 2: "Warning", 3: "Info", 4: "Hint" };
        const lines = diags.map(d => {
          const sev = severityMap[d.severity ?? 1] ?? "Unknown";
          return `${sev} [${d.source ?? ""}] L${d.range.start.line + 1}:${d.range.start.character}: ${d.message}`;
        });
        return { output: lines.join('\n'), isError: false };
      }

      if (input.action === "definition") {
        if (input.line === undefined || input.character === undefined) {
          return { output: "line and character are required for definition lookup.", isError: true };
        }
        await client.openFile(input.file_path);
        const locs = await client.getDefinition(input.file_path, input.line, input.character);
        if (locs.length === 0) return { output: "No definition found.", isError: false };
        const lines = locs.map(l =>
          `${l.uri.replace('file://', '')}:${l.range.start.line + 1}:${l.range.start.character}`
        );
        return { output: lines.join('\n'), isError: false };
      }

      if (input.action === "references") {
        if (input.line === undefined || input.character === undefined) {
          return { output: "line and character are required for references lookup.", isError: true };
        }
        await client.openFile(input.file_path);
        const refs = await client.getReferences(input.file_path, input.line, input.character);
        if (refs.length === 0) return { output: "No references found.", isError: false };
        const lines = refs.map(r =>
          `${r.uri.replace('file://', '')}:${r.range.start.line + 1}:${r.range.start.character}`
        );
        return { output: `${refs.length} reference(s):\n${lines.join('\n')}`, isError: false };
      }

      if (input.action === "hover") {
        if (input.line === undefined || input.character === undefined) {
          return { output: "line and character are required for hover.", isError: true };
        }
        await client.openFile(input.file_path);
        // Hover uses textDocument/hover which returns MarkupContent
        try {
          const result = await (client as any).send('textDocument/hover', {
            textDocument: { uri: `file://${input.file_path.replace(/\\/g, '/')}` },
            position: { line: input.line, character: input.character },
          });
          if (!result || !result.contents) return { output: "No hover information.", isError: false };
          const content = typeof result.contents === 'string'
            ? result.contents
            : result.contents.value ?? JSON.stringify(result.contents);
          return { output: content, isError: false };
        } catch {
          return { output: "Hover not supported by this language server.", isError: false };
        }
      }

      return { output: `Unknown action: ${input.action}`, isError: true };
    } catch (err) {
      return {
        output: `LSP error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },

  prompt() {
    return `Get code intelligence from the language server. Supports TypeScript, JavaScript, Python, Go, and Rust. Actions:
- diagnostics: Get errors and warnings for a file
- definition: Go to definition of a symbol at a given position
- references: Find all references to a symbol at a given position
- hover: Get type information and documentation for a symbol
Parameters:
- file_path (string, required): Absolute path to the file
- action (string): "diagnostics" | "definition" | "references" | "hover" (default: diagnostics)
- line (number, optional): 0-indexed line for definition/references/hover
- character (number, optional): 0-indexed column for definition/references/hover`;
  },
};

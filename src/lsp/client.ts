/**
 * Lightweight LSP client — connects to a language server subprocess
 * and provides diagnostics, go-to-definition, and find-references.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type LspMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

type Diagnostic = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
};

type Location = {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
};

export class LspClient {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private contentLength = -1;
  private diagnostics = new Map<string, Diagnostic[]>();
  private ready = false;

  private constructor(proc: ChildProcess) {
    this.proc = proc;

    // Parse LSP messages from stdout (Content-Length framed)
    proc.stdout!.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.parseMessages();
    });

    proc.on("exit", () => {
      for (const p of this.pending.values()) {
        p.reject(new Error("LSP server exited"));
      }
      this.pending.clear();
    });
  }

  private parseMessages(): void {
    while (true) {
      if (this.contentLength === -1) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;
        const header = this.buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }
        this.contentLength = parseInt(match[1]!);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }

      if (this.buffer.length < this.contentLength) break;

      const body = this.buffer.slice(0, this.contentLength);
      this.buffer = this.buffer.slice(this.contentLength);
      this.contentLength = -1;

      try {
        const msg: LspMessage = JSON.parse(body);
        this.handleMessage(msg);
      } catch {
        /* ignore parse errors */
      }
    }
  }

  private handleMessage(msg: LspMessage): void {
    // Response to a request
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error.message));
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    // Server notification
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as { uri: string; diagnostics: Diagnostic[] };
      this.diagnostics.set(params.uri, params.diagnostics);
    }
  }

  private send(method: string, params: unknown, isNotification = false): Promise<any> {
    const id = isNotification ? undefined : this.nextId++;
    const msg: LspMessage = { jsonrpc: "2.0", id, method, params };
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.proc.stdin!.write(header + body);

    if (isNotification) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.pending.set(id!, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id!)) {
          this.pending.delete(id!);
          reject(new Error("LSP request timeout"));
        }
      }, 10_000);
    });
  }

  static async connect(command: string, args: string[], rootPath: string): Promise<LspClient> {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const client = new LspClient(proc);

    // Initialize
    await client.send("initialize", {
      processId: process.pid,
      rootUri: `file://${rootPath.replace(/\\/g, "/")}`,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
        },
      },
    });

    client.send("initialized", {}, true);
    client.ready = true;
    return client;
  }

  /** Get diagnostics for a file (must be opened first) */
  async openFile(filePath: string): Promise<void> {
    const uri = `file://${filePath.replace(/\\/g, "/")}`;
    const content = readFileSync(filePath, "utf-8");
    await this.send(
      "textDocument/didOpen",
      {
        textDocument: { uri, languageId: this.guessLanguage(filePath), version: 1, text: content },
      },
      true,
    );
    // Wait briefly for diagnostics to arrive
    await new Promise((r) => setTimeout(r, 1000));
  }

  /** Get cached diagnostics for a file */
  getDiagnostics(filePath: string): Diagnostic[] {
    const uri = `file://${filePath.replace(/\\/g, "/")}`;
    return this.diagnostics.get(uri) ?? [];
  }

  /** Go to definition */
  async getDefinition(filePath: string, line: number, character: number): Promise<Location[]> {
    const uri = `file://${filePath.replace(/\\/g, "/")}`;
    const result = await this.send("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    });
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  /** Find references */
  async getReferences(filePath: string, line: number, character: number): Promise<Location[]> {
    const uri = `file://${filePath.replace(/\\/g, "/")}`;
    const result = await this.send("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    });
    return result ?? [];
  }

  private guessLanguage(path: string): string {
    if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
    if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
    if (path.endsWith(".py")) return "python";
    if (path.endsWith(".rs")) return "rust";
    if (path.endsWith(".go")) return "go";
    if (path.endsWith(".java")) return "java";
    return "plaintext";
  }

  disconnect(): void {
    this.send("shutdown", {})
      .then(() => {
        this.send("exit", null, true);
        this.proc.kill();
      })
      .catch(() => {
        this.proc.kill();
      });
  }
}

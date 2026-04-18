/**
 * Shared submit/input handler — processes user input before sending to LLM.
 * Used by both cell renderer REPL and Ink REPL.
 */

import { type CommandContext, processSlashCommand } from "../commands/index.js";
import { cybergotchiEvents } from "../cybergotchi/events.js";
import type { CompanionConfig } from "../cybergotchi/types.js";
import { resolveMcpMention } from "../mcp/loader.js";
import type { Message } from "../types/message.js";
import { createInfoMessage, createUserMessage } from "../types/message.js";
import type { PermissionMode } from "../types/permissions.js";
import type { CostTracker } from "./cost.js";

export type SubmitContext = {
  messages: Message[];
  currentModel: string;
  providerName: string;
  permissionMode: PermissionMode;
  cost: CostTracker;
  sessionId: string;
  companionConfig: CompanionConfig | null;
};

export type SubmitResult = {
  /** Whether the input was fully handled (don't send to LLM) */
  handled: boolean;
  /** Updated messages array */
  messages: Message[];
  /** Prompt to send to LLM (may differ from input due to @mentions) */
  prompt?: string;
  /** New model if changed by slash command */
  newModel?: string;
  /** Whether vim mode was toggled */
  vimToggled?: boolean;
  /** Whether fast mode was toggled */
  fastModeToggled?: boolean;
};

/**
 * Process user input: handle exit, companion mentions, slash commands,
 * @mentions, and prepare the prompt for the LLM.
 */
export async function handleUserInput(input: string, ctx: SubmitContext): Promise<SubmitResult> {
  const trimmed = input.trim();
  let messages = ctx.messages;

  // Companion address
  if (ctx.companionConfig) {
    const name = ctx.companionConfig.soul.name.toLowerCase();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith(`@${name}`) || lower.startsWith(`${name},`) || lower.startsWith(`${name} `)) {
      cybergotchiEvents.emit("cybergotchi", { type: "userAddressed", text: trimmed });
      return { handled: true, messages };
    }
  }

  // ! Bash mode — direct shell execution, output added to context
  if (trimmed.startsWith("!") && trimmed.length > 1) {
    const command = trimmed.slice(1).trim();
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(command, {
        encoding: "utf-8",
        cwd: process.cwd(),
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      messages = [...messages, createInfoMessage(`$ ${command}\n${output.trimEnd()}`)];
    } catch (err: any) {
      const output = String(err.stdout ?? err.stderr ?? err.message ?? "Command failed");
      messages = [...messages, createInfoMessage(`$ ${command}\n${output.trimEnd()}`)];
    }
    return { handled: true, messages };
  }

  // Vim toggle
  if (trimmed === "/vim") {
    return { handled: true, messages, vimToggled: true };
  }

  // Slash commands
  if (trimmed.startsWith("/")) {
    const cmdCtx: CommandContext = {
      messages,
      model: ctx.currentModel,
      providerName: ctx.providerName,
      permissionMode: ctx.permissionMode,
      totalCost: ctx.cost.totalCost,
      totalInputTokens: ctx.cost.totalInputTokens,
      totalOutputTokens: ctx.cost.totalOutputTokens,
      sessionId: ctx.sessionId,
    };
    const result = await processSlashCommand(trimmed, cmdCtx);
    if (result) {
      if (result.clearMessages) messages = [];
      if (result.compactedMessages) messages = result.compactedMessages;
      if (result.output) messages = [...messages, createInfoMessage(result.output)];

      if (result.toggleFastMode) {
        return { handled: true, messages, fastModeToggled: true };
      }
      if (result.handled && !result.prependToPrompt) {
        return {
          handled: true,
          messages,
          newModel: result.newModel ?? undefined,
        };
      }
      if (result.prependToPrompt) {
        messages = [...messages, createUserMessage(input)];
        return {
          handled: false,
          messages,
          prompt: result.prependToPrompt,
          newModel: result.newModel ?? undefined,
        };
      }
    }
  }

  // Normal prompt — add user message
  messages = [...messages, createUserMessage(input)];

  // Resolve @mentions — supports @file, @file#L5-10, @file#5-10, MCP resources
  let resolvedInput = input;
  const mentionPattern = /@([\w][\w./-]*)(?:#L?(\d+)(?:-(\d+))?)?/g;
  const mentions = [...input.matchAll(mentionPattern)];
  const companionName = ctx.companionConfig?.soul?.name?.toLowerCase();

  for (const match of mentions) {
    const mention = match[1]!;
    const startLine = match[2] ? parseInt(match[2], 10) : undefined;
    const endLine = match[3] ? parseInt(match[3], 10) : startLine;
    const fullRef = match[0];

    if (companionName && mention.toLowerCase() === companionName) continue;

    // Try local file first (supports paths like @src/main.ts, @README.md#L5-10)
    try {
      const { existsSync, readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const filePath = resolve(process.cwd(), mention);
      if (existsSync(filePath)) {
        let content = readFileSync(filePath, "utf-8");

        // Apply line range if specified
        if (startLine !== undefined) {
          const lines = content.split("\n");
          const start = Math.max(0, startLine - 1); // 1-indexed to 0-indexed
          const end = endLine !== undefined ? endLine : start + 1;
          content = lines.slice(start, end).join("\n");
          resolvedInput += `\n\n[File ${fullRef} (lines ${startLine}-${endLine ?? startLine})]:\n${content}`;
        } else {
          const truncated = content.length > 10_000 ? `${content.slice(0, 10_000)}\n[...truncated]` : content;
          resolvedInput += `\n\n[File @${mention}]:\n${truncated}`;
        }
        continue;
      }
    } catch {
      /* ignore */
    }

    // Fall back to MCP resource
    try {
      const content = await resolveMcpMention(mention);
      if (content) resolvedInput += `\n\n[Resource @${mention}]:\n${content.slice(0, 5000)}`;
    } catch {
      /* ignore */
    }
  }

  return { handled: false, messages, prompt: resolvedInput };
}

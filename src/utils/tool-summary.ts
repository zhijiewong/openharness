/**
 * Shared tool argument summary utilities.
 * Used by both the cell renderer and Ink permission prompt.
 */

/**
 * Extract a human-readable suggestion from tool name + args JSON.
 * Returns null if no meaningful suggestion can be derived.
 */
export function summarizeToolArgs(toolName: string, argsJson: string): string | null {
  const lower = toolName.toLowerCase();

  if (lower === 'bash' || lower === 'shell' || lower === 'execute') {
    const cmdMatch = argsJson.match(/command[:\s]+["`]?(.+?)["`]?(?:\n|$)/i);
    if (cmdMatch) return `$ ${cmdMatch[1]}`;
    try {
      const args = JSON.parse(argsJson);
      if (args.command) return `$ ${(args.command as string).slice(0, 60)}`;
    } catch { /* ignore */ }
  }

  if (lower.includes('read') || lower.includes('write') || lower.includes('edit') || lower.includes('glob') || lower.includes('grep')) {
    try {
      const args = JSON.parse(argsJson);
      if (args.file_path) {
        const action = lower.includes('read') ? 'reading' : lower.includes('write') ? 'writing' : lower.includes('edit') ? 'editing' : lower;
        return `${action} ${args.file_path}`;
      }
      if (args.pattern) return `pattern: ${args.pattern as string}`;
    } catch {
      const pathMatch = argsJson.match(/(?:path|file)[:\s]+["`]?([^\s"`]+)/i);
      if (pathMatch) {
        const action = lower.includes('read') ? 'reading' : lower.includes('write') ? 'writing' : lower.includes('edit') ? 'editing' : lower;
        return `${action} ${pathMatch[1]}`;
      }
    }
  }

  return null;
}

/**
 * Extract a readable summary of tool arguments for display.
 * Simpler version for inline display (tool call rows).
 */
export function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
  if (args.file_path) return args.file_path as string;
  if (args.command) return `$ ${(args.command as string).slice(0, 60)}`;
  if (args.pattern) return `pattern: ${args.pattern as string}`;
  return JSON.stringify(args).slice(0, 80);
}

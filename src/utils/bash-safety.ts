/**
 * Bash command safety analysis — lightweight AST-style parsing to detect
 * dangerous command patterns. Replaces simple regex matching with structural
 * analysis of shell command syntax.
 *
 * Inspired by Claude Code's bash AST analysis for permission gating.
 */

export type BashRisk = {
  level: "safe" | "moderate" | "dangerous";
  reasons: string[];
};

// Commands that destroy data or are hard to reverse
const DESTRUCTIVE_COMMANDS = new Set(["rm", "rmdir", "mkfs", "dd", "shred", "truncate", "wipefs"]);

// Git commands that are destructive or affect shared state
const DANGEROUS_GIT = new Set([
  "push --force",
  "push -f",
  "reset --hard",
  "clean -f",
  "clean -fd",
  "clean -fx",
  "checkout .",
  "checkout --",
  "restore .",
  "branch -D",
  "branch -d",
]);

// Commands that change system/file permissions or ownership
const PERMISSION_COMMANDS = new Set(["chmod", "chown", "chgrp", "setfacl"]);

// Commands that install or modify system packages
const INSTALL_COMMANDS = new Set([
  "apt",
  "apt-get",
  "yum",
  "dnf",
  "brew",
  "pacman",
  "snap",
  "pip",
  "npm",
  "yarn",
  "pnpm",
]);

// Commands that send data externally
const NETWORK_EXFIL = new Set(["curl", "wget", "nc", "ncat", "socat", "ssh", "scp", "rsync"]);

/**
 * Pure read-only commands. A bash invocation consisting only of these
 * commands (optionally piped/chained with each other) is safe to auto-approve
 * without a permission prompt. Mirrors Claude Code's read-only allowlist so
 * common inspection flows (`ls`, `cat file | head`, `git status`) don't pester
 * the user.
 *
 * Strict criteria: no side effects, no network, no filesystem writes.
 */
const READ_ONLY_COMMANDS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "egrep",
  "fgrep",
  "find",
  "wc",
  "diff",
  "stat",
  "du",
  "df",
  "pwd",
  "echo",
  "printf",
  "whoami",
  "which",
  "type",
  "file",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "date",
  "true",
  "false",
  "sort",
  "uniq",
  "cut",
  "tr",
  "sed", // sed without -i is read-only (checked below)
  "awk",
  "column",
  "tee", // tee IS a write, handled below
  "tree",
  "jq",
  "yq",
  "xxd",
  "od",
  "md5sum",
  "sha1sum",
  "sha256sum",
  "env", // reading env; `export` / `env X=Y cmd` is not here
]);

// Git subcommands that don't mutate the repo or working tree.
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "log",
  "show",
  "diff",
  "blame",
  "branch",
  "tag",
  "describe",
  "rev-parse",
  "rev-list",
  "ls-files",
  "ls-tree",
  "cat-file",
  "config",
  "remote",
  "reflog",
  "stash",
  "for-each-ref",
  "shortlog",
  "grep",
  "bisect",
  "worktree",
]);

/**
 * Return true iff every sub-command in the pipeline/chain is a read-only
 * operation. Any side-effecting sub-command disqualifies the whole command.
 * Respects quotes and command substitution via the existing splitCommands/tokenize.
 */
export function isReadOnlyBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Refuse any redirection that creates/overwrites files ( > >> | tee -a ... ).
  // Append is still a write. `2>&1` alone is fine, but `> file` is not.
  if (/(?<![<&])>+\s*[^&]/.test(trimmed)) return false;

  const subCommands = splitCommands(trimmed);
  if (subCommands.length === 0) return false;

  for (const sub of subCommands) {
    const tokens = tokenize(sub);
    if (tokens.length === 0) continue;
    const cmd = tokens[0]!;
    const args = tokens.slice(1);

    // `git <subcmd>` with read-only subcommand
    if (cmd === "git") {
      const sub = args.find((a) => !a.startsWith("-"));
      if (!sub || !READ_ONLY_GIT_SUBCOMMANDS.has(sub)) return false;
      // `git stash push`, `git stash pop`, `git stash drop` are writes — refuse.
      if (sub === "stash") {
        const action = args[args.indexOf("stash") + 1];
        if (action && ["push", "pop", "drop", "apply", "clear", "save"].includes(action)) return false;
      }
      // `git branch -d`, `git branch -D` delete branches — refuse.
      if (sub === "branch" && args.some((a) => a === "-d" || a === "-D")) return false;
      // `git config --global foo=bar` writes config — only read forms are safe.
      if (
        sub === "config" &&
        args.some((a) => !a.startsWith("-") && args.indexOf(a) > args.indexOf("config") && a.includes("="))
      ) {
        return false;
      }
      continue;
    }

    // `sed -i` is in-place edit — writes.
    if (cmd === "sed" && args.some((a) => a === "-i" || a.startsWith("-i"))) return false;

    // `tee` without `-a` is a write; `tee -a` is also a write. Refuse always.
    if (cmd === "tee") return false;

    if (!READ_ONLY_COMMANDS.has(cmd)) return false;
  }

  return true;
}

/**
 * Analyze a bash command string for safety risks.
 * Does lightweight structural parsing — splits on pipes, semicolons,
 * and && / || operators to analyze each sub-command.
 */
export function analyzeBashCommand(command: string): BashRisk {
  const reasons: string[] = [];
  const trimmed = command.trim();

  // Split into sub-commands (pipes, semicolons, &&, ||)
  const subCommands = splitCommands(trimmed);

  for (const sub of subCommands) {
    const tokens = tokenize(sub);
    if (tokens.length === 0) continue;

    const cmd = tokens[0]!;
    const args = tokens.slice(1).join(" ");
    const _fullCmd = `${cmd} ${args}`.trim();

    // 1. Destructive commands (also check xargs + destructive)
    const effectiveCmd = cmd === "xargs" && tokens[1] ? tokens[1] : cmd;
    if (DESTRUCTIVE_COMMANDS.has(effectiveCmd)) {
      reasons.push(`destructive command: ${effectiveCmd}`);
      // rm -rf / is especially dangerous
      const fullArgs = tokens.slice(1).join(" ");
      if (effectiveCmd === "rm" && /\s-[a-zA-Z]*r[a-zA-Z]*f|\s-[a-zA-Z]*f[a-zA-Z]*r/.test(` ${fullArgs}`)) {
        reasons.push("recursive force delete (rm -rf)");
      }
    }

    // 2. Dangerous git operations
    if (cmd === "git") {
      for (const pattern of DANGEROUS_GIT) {
        if (args.includes(pattern.replace("git ", ""))) {
          reasons.push(`dangerous git operation: git ${pattern}`);
        }
      }
      // git push to main/master
      if (args.includes("push") && (/\bmain\b/.test(args) || /\bmaster\b/.test(args))) {
        if (args.includes("--force") || args.includes("-f")) {
          reasons.push("force push to main/master");
        }
      }
    }

    // 3. Pipe to execution (curl | bash, wget | sh)
    if (NETWORK_EXFIL.has(cmd)) {
      // Check if this command's output is piped to an executor
      const pipeIdx = subCommands.indexOf(sub);
      if (pipeIdx < subCommands.length - 1) {
        const nextCmd = tokenize(subCommands[pipeIdx + 1]!)[0];
        if (
          nextCmd &&
          ["bash", "sh", "zsh", "eval", "source", ".", "python", "node", "perl", "ruby"].includes(nextCmd)
        ) {
          reasons.push(`pipe to execution: ${cmd} | ${nextCmd}`);
        }
      }
    }

    // 4. Command substitution with execution
    if (/\$\(.*\)/.test(sub) || /`[^`]+`/.test(sub)) {
      // Command substitution is common and usually fine, only flag if combined with destructive
      const innerCmd = sub.match(/\$\((.+?)\)/)?.[1] ?? sub.match(/`([^`]+)`/)?.[1];
      if (innerCmd) {
        const innerTokens = tokenize(innerCmd);
        if (innerTokens[0] && DESTRUCTIVE_COMMANDS.has(innerTokens[0])) {
          reasons.push(`command substitution with destructive command: $(${innerCmd})`);
        }
      }
    }

    // 5. Permission/ownership changes
    if (PERMISSION_COMMANDS.has(cmd)) {
      reasons.push(`permission change: ${cmd}`);
      if (args.includes("777") || args.includes("+s") || args.includes("u+s")) {
        reasons.push("dangerous permission mode");
      }
    }

    // 6. Package installation (moderate risk)
    if (INSTALL_COMMANDS.has(cmd) && (args.includes("install") || args.includes("add") || args.includes("-S"))) {
      reasons.push(`package installation: ${cmd}`);
    }

    // 7. Environment variable manipulation that could affect security
    if (cmd === "export" && /PATH|LD_PRELOAD|LD_LIBRARY_PATH/.test(args)) {
      reasons.push(`modifying security-sensitive env var: ${args.split("=")[0]}`);
    }

    // 8. Process killing
    if ((cmd === "kill" || cmd === "killall" || cmd === "pkill") && args.includes("-9")) {
      reasons.push(`force kill: ${cmd} -9`);
    }

    // 9. Disk operations
    if (cmd === "dd" || cmd === "mkfs" || cmd === "fdisk" || cmd === "parted") {
      reasons.push(`disk operation: ${cmd}`);
    }

    // 10. Redirect overwrite to important files
    if (/>\s*\/etc\/|>\s*~\/\.\w/.test(sub)) {
      reasons.push("redirect to system/dotfile");
    }
  }

  if (reasons.length === 0) {
    return { level: "safe", reasons: [] };
  }

  // Classify: any pipe-to-exec, destructive, or force-push is 'dangerous'; rest is 'moderate'
  const isDangerous = reasons.some(
    (r) =>
      r.includes("pipe to execution") ||
      r.includes("recursive force delete") ||
      r.includes("force push to main") ||
      r.includes("disk operation") ||
      r.includes("dangerous permission mode"),
  );

  return {
    level: isDangerous ? "dangerous" : "moderate",
    reasons,
  };
}

/**
 * Split a command string into sub-commands on |, ;, &&, ||
 * Respects quoted strings and command substitutions.
 */
function splitCommands(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let depth = 0; // $() nesting

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    const next = cmd[i + 1];

    if (ch === "'" && !inDouble && depth === 0) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle && depth === 0) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (inSingle || inDouble) {
      current += ch;
      continue;
    }

    if (ch === "$" && next === "(") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth--;
      current += ch;
      continue;
    }
    if (depth > 0) {
      current += ch;
      continue;
    }

    // Split on pipe, semicolon, &&, ||
    if (ch === "|" && next !== "|") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    if (ch === ";" || (ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      parts.push(current.trim());
      current = "";
      if (next === "&" || next === "|") i++; // skip second char of && or ||
      continue;
    }

    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Tokenize a simple command into words, respecting quotes.
 */
function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (const ch of cmd) {
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === " " && !inSingle && !inDouble) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

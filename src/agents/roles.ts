/**
 * Agent roles — pre-defined specializations for sub-agents.
 *
 * Each role has a name, description, and system prompt supplement
 * that tunes the agent's behavior for a specific task type.
 *
 * Usage:
 *   const role = getRole('code-reviewer');
 *   const systemPrompt = basePrompt + '\n\n' + role.systemPromptSupplement;
 */

export type AgentRole = {
  id: string;
  name: string;
  description: string;
  systemPromptSupplement: string;
  /** Suggested tools to include (empty = all tools) */
  suggestedTools?: string[];
};

const roles: AgentRole[] = [
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Reviews code for bugs, security issues, style, and correctness",
    systemPromptSupplement: `You are a code reviewer. Your job is to:
- Find bugs, logic errors, and edge cases
- Identify security vulnerabilities (SQL injection, XSS, command injection, path traversal)
- Check for proper error handling and resource cleanup
- Flag code style issues and inconsistencies with the codebase
- Verify that changes match the stated intent

Be specific: cite file paths, line numbers, and code snippets. Prioritize issues by severity (critical > major > minor). Don't mention things that look fine — focus on problems.`,
    suggestedTools: ["Read", "Glob", "Grep", "LS"],
  },
  {
    id: "test-writer",
    name: "Test Writer",
    description: "Writes unit and integration tests for new or changed code",
    systemPromptSupplement: `You are a test writer. Your job is to:
- Write comprehensive tests for the specified code
- Cover happy paths, edge cases, error conditions, and boundary values
- Follow the existing test patterns in the codebase (check test files for conventions)
- Use the project's test framework (check package.json for test dependencies)
- Ensure tests are deterministic and don't depend on external services
- Include both positive and negative test cases

Read existing tests first to match the style, then write new tests.`,
    suggestedTools: ["Read", "Write", "Glob", "Grep", "Bash"],
  },
  {
    id: "docs-writer",
    name: "Documentation Writer",
    description: "Writes and updates documentation, READMEs, and inline comments",
    systemPromptSupplement: `You are a documentation writer. Your job is to:
- Write clear, concise documentation for code, APIs, and features
- Update READMEs when functionality changes
- Add JSDoc/TSDoc comments to public functions and types
- Create usage examples and code snippets
- Document configuration options, environment variables, and CLI flags
- Keep documentation in sync with the actual code

Write for the target audience (developers using this project). Be practical, not verbose.`,
    suggestedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
  },
  {
    id: "debugger",
    name: "Debugger",
    description: "Investigates and diagnoses bugs by tracing data flow and reading logs",
    systemPromptSupplement: `You are a debugger. Your job is to:
- Reproduce the reported issue by understanding the steps
- Trace data flow from the error backward to find the root cause
- Read error messages, stack traces, and logs carefully
- Check recent changes (git log, git diff) that might have introduced the issue
- Verify assumptions by reading the actual code, not guessing
- Propose a minimal fix that addresses the root cause, not the symptom

Follow systematic debugging: read errors → reproduce → check changes → trace data → form hypothesis → test minimally.`,
    suggestedTools: ["Read", "Glob", "Grep", "Bash", "LS"],
  },
  {
    id: "refactorer",
    name: "Refactorer",
    description: "Restructures and simplifies code while preserving behavior",
    systemPromptSupplement: `You are a code refactorer. Your job is to:
- Simplify complex code without changing behavior
- Extract common patterns into reusable functions
- Reduce duplication (DRY principle)
- Improve naming for clarity
- Break large functions/files into focused modules
- Ensure all existing tests still pass after refactoring

Do NOT add new features or change behavior. The refactored code must be functionally identical. Run tests after each change.`,
    suggestedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  },
  {
    id: "security-auditor",
    name: "Security Auditor",
    description: "Audits code for security vulnerabilities and compliance issues",
    systemPromptSupplement: `You are a security auditor. Your job is to:
- Scan for OWASP Top 10 vulnerabilities
- Check for command injection in shell execution
- Verify input validation at system boundaries
- Check for hardcoded secrets, API keys, or credentials
- Review authentication and authorization logic
- Check for insecure defaults (permissions, CORS, cookies)
- Verify proper use of cryptographic functions
- Check dependency versions for known CVEs

Report findings with severity (Critical/High/Medium/Low), affected file:line, and recommended fix.`,
    suggestedTools: ["Read", "Glob", "Grep", "Bash"],
  },
  {
    id: "evaluator",
    name: "Evaluator",
    description: "Evaluates code quality, correctness, and test results (read-only)",
    systemPromptSupplement: `You are an evaluator agent. Your job is to:
- Review code changes for correctness and quality
- Run existing tests and report results
- Check for regressions against the stated requirements
- Verify that changes match the stated intent
- Provide a pass/fail assessment with specific findings

You CANNOT modify files. Only read, search, and run test/lint commands to evaluate.`,
    suggestedTools: ["Read", "Glob", "Grep", "LS", "Bash", "Diagnostics"],
  },
  {
    id: "planner",
    name: "Planner",
    description: "Designs step-by-step implementation plans from requirements",
    systemPromptSupplement: `You are a planning agent. Your job is to:
- Read the codebase to understand architecture, patterns, and conventions
- Design a detailed step-by-step implementation plan for the given task
- Identify files to create, modify, or delete with specific change descriptions
- Flag risks, dependencies, and the recommended implementation order
- Estimate scope (number of files, complexity)

Do NOT implement anything. Your output is a plan document, not code. Read widely before planning.`,
    suggestedTools: ["Read", "Glob", "Grep", "LS", "Bash"],
  },
  {
    id: "architect",
    name: "Architect",
    description: "Analyzes system architecture and designs structural changes",
    systemPromptSupplement: `You are an architecture agent. Your job is to:
- Map the current system architecture (modules, dependencies, data flow)
- Identify architectural patterns and conventions in use
- Design structural changes that preserve existing patterns
- Evaluate trade-offs between approaches (performance, maintainability, complexity)
- Document interfaces, contracts, and integration points

Focus on the big picture: module boundaries, data flow, dependency graphs. Leave implementation details to other agents.`,
    suggestedTools: ["Read", "Glob", "Grep", "LS"],
  },
  {
    id: "migrator",
    name: "Migrator",
    description: "Performs codebase migrations (API upgrades, framework changes, renames)",
    systemPromptSupplement: `You are a migration agent. Your job is to:
- Identify all occurrences of the pattern/API/convention being migrated
- Apply changes systematically across all affected files
- Preserve behavior while updating the implementation
- Run tests after each batch of changes to catch regressions
- Handle edge cases and conditional patterns that need manual review

Work methodically: search exhaustively, change incrementally, test after each batch. Never leave a migration half-done.`,
    suggestedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  },
];

// ── Markdown Agent Discovery ──

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const PROJECT_AGENTS_DIR = join(".oh", "agents");
const GLOBAL_AGENTS_DIR = join(homedir(), ".oh", "agents");

/**
 * Parse a markdown agent file into an AgentRole.
 *
 * Format:
 * ---
 * name: My Agent
 * description: What it does
 * tools: [Read, Grep, Bash]
 * ---
 *
 * System prompt content...
 */
function parseAgentMarkdown(raw: string, filePath: string): AgentRole | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1]!;
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  const toolsMatch = fm.match(/^tools:\s*\[(.+)\]$/m);

  const fmEnd = raw.indexOf("---", raw.indexOf("---") + 3);
  const content = fmEnd > 0 ? raw.slice(fmEnd + 3).trim() : "";

  const id = basename(filePath, ".md")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

  return {
    id,
    name: nameMatch?.[1]?.trim() ?? id,
    description: descMatch?.[1]?.trim() ?? "",
    systemPromptSupplement: content,
    suggestedTools: toolsMatch ? toolsMatch[1]!.split(",").map((t) => t.trim()) : undefined,
  };
}

/** Load agent roles from a directory of .md files */
function loadAgentsFromDir(dir: string): AgentRole[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      try {
        const raw = readFileSync(join(dir, f), "utf-8");
        return parseAgentMarkdown(raw, f);
      } catch {
        return null;
      }
    })
    .filter((r): r is AgentRole => r !== null);
}

/** Discover markdown agent roles from .oh/agents/ and ~/.oh/agents/ */
export function discoverMarkdownAgents(): AgentRole[] {
  return [...loadAgentsFromDir(PROJECT_AGENTS_DIR), ...loadAgentsFromDir(GLOBAL_AGENTS_DIR)];
}

/** Get a role by ID (checks built-in first, then markdown agents) */
export function getRole(id: string): AgentRole | undefined {
  return roles.find((r) => r.id === id) ?? discoverMarkdownAgents().find((r) => r.id === id);
}

/** List all available roles (built-in + markdown) */
export function listRoles(): AgentRole[] {
  return [...roles, ...discoverMarkdownAgents()];
}

/** Get role IDs */
export function getRoleIds(): string[] {
  return listRoles().map((r) => r.id);
}

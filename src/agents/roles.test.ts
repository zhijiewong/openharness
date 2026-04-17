import assert from "node:assert";
import { describe, it } from "node:test";
import { makeTmpDir, writeFile } from "../test-helpers.js";
import { discoverMarkdownAgents, getRole, getRoleIds, listRoles } from "./roles.js";

function withTmpCwd(fn: (dir: string) => void) {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  try {
    fn(dir);
  } finally {
    process.chdir(original);
  }
}

describe("agent roles", () => {
  it("lists all roles", () => {
    const roles = listRoles();
    assert.ok(roles.length >= 10);
    assert.ok(roles.find((r) => r.id === "code-reviewer"));
    assert.ok(roles.find((r) => r.id === "test-writer"));
    assert.ok(roles.find((r) => r.id === "debugger"));
    assert.ok(roles.find((r) => r.id === "security-auditor"));
    assert.ok(roles.find((r) => r.id === "evaluator"));
    assert.ok(roles.find((r) => r.id === "planner"));
    assert.ok(roles.find((r) => r.id === "architect"));
    assert.ok(roles.find((r) => r.id === "migrator"));
  });

  it("gets role by ID", () => {
    const role = getRole("code-reviewer");
    assert.ok(role);
    assert.strictEqual(role.name, "Code Reviewer");
    assert.ok(role.systemPromptSupplement.length > 50);
    assert.ok(role.suggestedTools!.includes("Read"));
  });

  it("returns undefined for unknown role", () => {
    assert.strictEqual(getRole("nonexistent"), undefined);
  });

  it("getRoleIds returns all IDs", () => {
    const ids = getRoleIds();
    assert.ok(ids.includes("code-reviewer"));
    assert.ok(ids.includes("test-writer"));
    assert.ok(ids.includes("refactorer"));
  });

  it("every role has required fields", () => {
    for (const role of listRoles()) {
      assert.ok(role.id, `role missing id`);
      assert.ok(role.name, `role ${role.id} missing name`);
      assert.ok(role.description, `role ${role.id} missing description`);
      assert.ok(role.systemPromptSupplement.length > 20, `role ${role.id} has short prompt`);
    }
  });

  it("evaluator role has read-only suggested tools", () => {
    const role = getRole("evaluator");
    assert.ok(role);
    assert.strictEqual(role.name, "Evaluator");
    assert.ok(role.suggestedTools!.includes("Read"));
    assert.ok(role.suggestedTools!.includes("Glob"));
    assert.ok(role.suggestedTools!.includes("Grep"));
    assert.ok(role.suggestedTools!.includes("Bash"));
    assert.ok(role.suggestedTools!.includes("Diagnostics"));
    // Evaluator should NOT have write tools
    assert.ok(!role.suggestedTools!.includes("Write"));
    assert.ok(!role.suggestedTools!.includes("Edit"));
  });

  it("all roles use actual tool names (not FileRead/FileWrite/FileEdit)", () => {
    const invalidNames = ["FileRead", "FileWrite", "FileEdit"];
    for (const role of listRoles()) {
      if (!role.suggestedTools) continue;
      for (const toolName of role.suggestedTools) {
        assert.ok(
          !invalidNames.includes(toolName),
          `role ${role.id} uses invalid tool name '${toolName}' — should be 'Read', 'Write', or 'Edit'`,
        );
      }
    }
  });

  // ── Claude Code interop ──

  it("parses tools as space-separated string (Claude Code style)", () => {
    withTmpCwd((dir) => {
      writeFile(
        dir,
        ".oh/agents/cc-style.md",
        `---\nname: CC Style\ndescription: x\ntools: Read Glob Grep\n---\nbody\n`,
      );
      const agents = discoverMarkdownAgents();
      const a = agents.find((r) => r.id === "cc-style");
      assert.ok(a);
      assert.deepEqual(a!.suggestedTools, ["Read", "Glob", "Grep"]);
    });
  });

  it("parses tools as comma-separated string", () => {
    withTmpCwd((dir) => {
      writeFile(dir, ".oh/agents/comma.md", `---\nname: Comma\ndescription: x\ntools: Read, Edit, Bash\n---\nbody\n`);
      const a = discoverMarkdownAgents().find((r) => r.id === "comma");
      assert.ok(a);
      assert.deepEqual(a!.suggestedTools, ["Read", "Edit", "Bash"]);
    });
  });

  it("parses model + isolation + disallowedTools fields", () => {
    withTmpCwd((dir) => {
      writeFile(
        dir,
        ".oh/agents/full.md",
        `---\nname: Full\ndescription: x\ntools: Read Edit Bash\ndisallowedTools: Write\nmodel: sonnet\nisolation: worktree\n---\nbody\n`,
      );
      const a = discoverMarkdownAgents().find((r) => r.id === "full");
      assert.ok(a);
      assert.equal(a!.model, "sonnet");
      assert.equal(a!.isolation, "worktree");
      assert.deepEqual(a!.disallowedTools, ["Write"]);
    });
  });

  it("rejects invalid isolation value (silently ignored)", () => {
    withTmpCwd((dir) => {
      writeFile(dir, ".oh/agents/badiso.md", `---\nname: Bad\ndescription: x\nisolation: bogus\n---\n`);
      const a = discoverMarkdownAgents().find((r) => r.id === "badiso");
      assert.ok(a);
      assert.equal(a!.isolation, undefined);
    });
  });

  it("discovers agents from .claude/agents/ in addition to .oh/agents/", () => {
    withTmpCwd((dir) => {
      writeFile(dir, ".oh/agents/oh-one.md", `---\nname: OH One\ndescription: x\n---\n`);
      writeFile(dir, ".claude/agents/cc-one.md", `---\nname: CC One\ndescription: y\n---\n`);
      const agents = discoverMarkdownAgents();
      assert.ok(agents.find((r) => r.id === "oh-one"));
      assert.ok(agents.find((r) => r.id === "cc-one"));
    });
  });

  it("OH paths take precedence over .claude paths on id collision", () => {
    withTmpCwd((dir) => {
      writeFile(dir, ".oh/agents/dup.md", `---\nname: From OH\ndescription: oh\n---\n`);
      writeFile(dir, ".claude/agents/dup.md", `---\nname: From CC\ndescription: cc\n---\n`);
      const agents = discoverMarkdownAgents().filter((r) => r.id === "dup");
      assert.equal(agents.length, 1);
      assert.equal(agents[0]!.name, "From OH");
    });
  });
});

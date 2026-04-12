import assert from "node:assert";
import { describe, it } from "node:test";
import { getRole, getRoleIds, listRoles } from "./roles.js";

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
});

import assert from "node:assert/strict";
import test from "node:test";
import { makeTmpDir, writeFile } from "../test-helpers.js";
import { discoverSkills, findSkill, findTriggeredSkills, type SkillMetadata, skillsToPrompt } from "./plugins.js";

const SKILL_CONTENT = `---
name: deploy
description: Deploy the app
trigger: deploy
tools: [Bash, Read]
---

Run the deploy script.
`;

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

test("discoverSkills loads a skill from .oh/skills/", () => {
  withTmpCwd((dir) => {
    writeFile(dir, ".oh/skills/deploy.md", SKILL_CONTENT);
    const skills = discoverSkills();
    const local = skills.filter((s) => s.source === "project");
    assert.ok(local.length >= 1);
    const deploy = local.find((s) => s.name === "deploy");
    assert.ok(deploy);
    assert.equal(deploy!.description, "Deploy the app");
    assert.equal(deploy!.trigger, "deploy");
    assert.deepEqual(deploy!.tools, ["Bash", "Read"]);
  });
});

test("discoverSkills returns [] when no .oh/skills/ dir", () => {
  withTmpCwd(() => {
    const skills = discoverSkills();
    const local = skills.filter((s) => s.source === "project");
    assert.equal(local.length, 0);
  });
});

test("findSkill case-insensitive match", () => {
  withTmpCwd((dir) => {
    writeFile(dir, ".oh/skills/deploy.md", SKILL_CONTENT);
    const skill = findSkill("DEPLOY");
    assert.ok(skill);
    assert.equal(skill!.name, "deploy");
  });
});

test("findSkill returns null when not found", () => {
  withTmpCwd(() => {
    const skill = findSkill("nonexistent-skill");
    assert.equal(skill, null);
  });
});

test("findTriggeredSkills matches trigger text in user message", () => {
  withTmpCwd((dir) => {
    writeFile(dir, ".oh/skills/deploy.md", SKILL_CONTENT);
    const matched = findTriggeredSkills("please deploy the app");
    const local = matched.filter((s) => s.source === "project");
    assert.ok(local.length >= 1);
    assert.equal(local[0]!.name, "deploy");
  });
});

test("findTriggeredSkills returns [] when no match", () => {
  withTmpCwd((dir) => {
    writeFile(dir, ".oh/skills/deploy.md", SKILL_CONTENT);
    const matched = findTriggeredSkills("hello world");
    const local = matched.filter((s) => s.source === "project");
    assert.equal(local.length, 0);
  });
});

test("skillsToPrompt formats as markdown list", () => {
  const skills: SkillMetadata[] = [
    {
      name: "deploy",
      description: "Deploy the app",
      trigger: "deploy",
      tools: ["Bash"],
      args: undefined,
      content: "",
      filePath: "/tmp/deploy.md",
      source: "project",
      invokeModel: true,
    },
  ];
  const prompt = skillsToPrompt(skills);
  assert.ok(prompt.includes("# Available Skills"));
  assert.ok(prompt.includes("- deploy: Deploy the app"));
  assert.ok(prompt.includes('(auto-trigger: "deploy")'));
});

test("skillsToPrompt hides skills with invokeModel: false", () => {
  const skills: SkillMetadata[] = [
    {
      name: "visible",
      description: "Visible skill",
      trigger: undefined,
      tools: undefined,
      args: undefined,
      content: "",
      filePath: "/tmp/visible.md",
      source: "project",
      invokeModel: true,
    },
    {
      name: "hidden",
      description: "Hidden skill",
      trigger: undefined,
      tools: undefined,
      args: undefined,
      content: "",
      filePath: "/tmp/hidden.md",
      source: "project",
      invokeModel: false,
    },
  ];
  const prompt = skillsToPrompt(skills);
  assert.ok(prompt.includes("visible"));
  assert.ok(!prompt.includes("hidden"));
});

test("skillsToPrompt returns empty string for empty array", () => {
  assert.equal(skillsToPrompt([]), "");
});

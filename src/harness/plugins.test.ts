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
      whenToUse: undefined,
      license: undefined,
      paths: undefined,
      context: undefined,
      agent: undefined,
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
      whenToUse: undefined,
      license: undefined,
      paths: undefined,
      context: undefined,
      agent: undefined,
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
      whenToUse: undefined,
      license: undefined,
      paths: undefined,
      context: undefined,
      agent: undefined,
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

// ── Anthropic-style frontmatter alias tests ──

test("parses Anthropic kebab `allowed-tools` (space-separated)", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/skills/cc-style.md",
      `---
name: cc-style
description: Anthropic-style skill
allowed-tools: Read Glob Grep
---
body
`,
    );
    const skill = findSkill("cc-style");
    assert.ok(skill);
    assert.deepEqual(skill!.tools, ["Read", "Glob", "Grep"]);
  });
});

test("parses `allowed-tools` array form alongside camelCase `allowedTools`", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/skills/dual.md",
      `---
name: dual
description: Mixed style
allowed-tools: [Bash, Read]
---
`,
    );
    const skill = findSkill("dual");
    assert.ok(skill);
    assert.deepEqual(skill!.tools!.sort(), ["Bash", "Read"]);
  });
});

test("`disable-model-invocation: true` sets invokeModel false", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/skills/hidden.md",
      `---
name: hidden
description: Hidden skill
disable-model-invocation: true
---
`,
    );
    const skill = findSkill("hidden");
    assert.ok(skill);
    assert.equal(skill!.invokeModel, false);
  });
});

test("`argument-hint` aliases to args", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/skills/with-args.md",
      `---
name: with-args
description: Has args
argument-hint: [--prod, --force]
---
`,
    );
    const skill = findSkill("with-args");
    assert.ok(skill);
    assert.deepEqual(skill!.args, ["--prod", "--force"]);
  });
});

test("parses `license` and `paths` fields", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/skills/licensed.md",
      `---
name: licensed
description: Has license + paths
license: MIT
paths: [src/**/*.ts, tests/**/*.ts]
---
`,
    );
    const skill = findSkill("licensed");
    assert.ok(skill);
    assert.equal(skill!.license, "MIT");
    assert.deepEqual(skill!.paths, ["src/**/*.ts", "tests/**/*.ts"]);
  });
});

// ── Directory-packaged skill (skill-name/SKILL.md) tests ──

test("directory-packaged skill: SKILL.md surfaces, sibling .md files are companions", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/skills/pdf-vision/SKILL.md",
      `---
name: pdf-vision
description: Extract data from PDF drawings
---
Main skill content
`,
    );
    writeFile(dir, ".oh/skills/pdf-vision/reference.md", "# Reference docs (companion, not a skill)\n");
    writeFile(dir, ".oh/skills/pdf-vision/forms.md", "# Forms guide (companion, not a skill)\n");
    const skills = discoverSkills();
    const project = skills.filter((s) => s.source === "project");
    // Only ONE skill registers, despite 3 .md files in the dir
    assert.equal(project.length, 1);
    assert.equal(project[0]!.name, "pdf-vision");
  });
});

test("flat layout still works alongside directory layout", () => {
  withTmpCwd((dir) => {
    // Flat file
    writeFile(dir, ".oh/skills/flat.md", `---\nname: flat\ndescription: Flat skill\n---\n`);
    // Directory-packaged
    writeFile(dir, ".oh/skills/dirsk/SKILL.md", `---\nname: dirsk\ndescription: Dir skill\n---\n`);
    writeFile(dir, ".oh/skills/dirsk/notes.md", "# Companion\n");
    const skills = discoverSkills();
    const project = skills.filter((s) => s.source === "project");
    assert.equal(project.length, 2);
    const names = project.map((s) => s.name).sort();
    assert.deepEqual(names, ["dirsk", "flat"]);
  });
});

test("parses `context: fork` + `agent: <type>` skill fields", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/skills/fork-skill.md",
      `---
name: fork-skill
description: Delegates to a sub-agent
context: fork
agent: code-reviewer
---
body
`,
    );
    const s = findSkill("fork-skill");
    assert.ok(s);
    assert.equal(s!.context, "fork");
    assert.equal(s!.agent, "code-reviewer");
  });
});

test("invalid context value is silently ignored", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/skills/bad-context.md",
      `---
name: bad-context
description: x
context: bogus
---
`,
    );
    const s = findSkill("bad-context");
    assert.ok(s);
    assert.equal(s!.context, undefined);
  });
});

test("nested directory without SKILL.md still recurses (legacy behavior)", () => {
  withTmpCwd((dir) => {
    writeFile(dir, ".oh/skills/nested/a.md", `---\nname: a\ndescription: A\n---\n`);
    writeFile(dir, ".oh/skills/nested/b.md", `---\nname: b\ndescription: B\n---\n`);
    const skills = discoverSkills();
    const project = skills.filter((s) => s.source === "project");
    assert.equal(project.length, 2);
  });
});

test("`whenToUse` (Anthropic style) is parsed and stored", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/skills/whentouse.md",
      `---
name: whentouse
description: x
when-to-use: When the user asks to refactor legacy code
---
`,
    );
    const skill = findSkill("whentouse");
    assert.ok(skill);
    assert.equal(skill!.whenToUse, "When the user asks to refactor legacy code");
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { invalidateConfigCache } from "../harness/config.js";
import { makeTmpDir, writeFile } from "../test-helpers.js";
import { safeEnv } from "./safe-env.js";

function withTmpCwd(fn: (dir: string) => void) {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  try {
    fn(dir);
  } finally {
    process.chdir(original);
    invalidateConfigCache();
  }
}

test("safeEnv filters blocked credential vars", () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-should-be-blocked";
  try {
    const env = safeEnv();
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test("safeEnv merges call-site extras with highest precedence", () => {
  const env = safeEnv({ MY_VAR: "from-extra" });
  assert.equal(env.MY_VAR, "from-extra");
});

test("safeEnv injects .oh/config.yaml env block (Claude Code parity)", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/config.yaml",
      "provider: mock\nmodel: mock\npermissionMode: ask\nenv:\n  EXCEL_FILE_PATH: /tmp/bom.xlsx\n  CUSTOM_FLAG: enabled\n",
    );
    invalidateConfigCache();
    const env = safeEnv();
    assert.equal(env.EXCEL_FILE_PATH, "/tmp/bom.xlsx");
    assert.equal(env.CUSTOM_FLAG, "enabled");
  });
});

test("safeEnv call-site extra overrides config env", () => {
  withTmpCwd((dir) => {
    writeFile(
      dir,
      ".oh/config.yaml",
      "provider: mock\nmodel: mock\npermissionMode: ask\nenv:\n  MY_VAR: from-config\n",
    );
    invalidateConfigCache();
    const env = safeEnv({ MY_VAR: "from-call-site" });
    assert.equal(env.MY_VAR, "from-call-site");
  });
});

test("safeEnv config env wins over process.env", () => {
  withTmpCwd((dir) => {
    const prev = process.env.OH_TEST_OVERRIDE_VAR;
    process.env.OH_TEST_OVERRIDE_VAR = "from-process";
    try {
      writeFile(
        dir,
        ".oh/config.yaml",
        "provider: mock\nmodel: mock\npermissionMode: ask\nenv:\n  OH_TEST_OVERRIDE_VAR: from-config\n",
      );
      invalidateConfigCache();
      const env = safeEnv();
      assert.equal(env.OH_TEST_OVERRIDE_VAR, "from-config");
    } finally {
      if (prev !== undefined) process.env.OH_TEST_OVERRIDE_VAR = prev;
      else delete process.env.OH_TEST_OVERRIDE_VAR;
    }
  });
});

test("safeEnv works when no config file exists", () => {
  withTmpCwd(() => {
    invalidateConfigCache();
    const env = safeEnv({ MY_VAR: "x" });
    assert.equal(env.MY_VAR, "x");
    // PATH should still flow through from process.env
    assert.ok(env.PATH || env.Path);
  });
});

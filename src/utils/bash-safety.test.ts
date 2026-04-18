import assert from "node:assert";
import { describe, it } from "node:test";
import { analyzeBashCommand, isReadOnlyBashCommand } from "./bash-safety.js";

describe("analyzeBashCommand", () => {
  describe("safe commands", () => {
    it("marks simple read commands as safe", () => {
      assert.strictEqual(analyzeBashCommand("ls -la").level, "safe");
      assert.strictEqual(analyzeBashCommand("cat file.txt").level, "safe");
      assert.strictEqual(analyzeBashCommand("echo hello").level, "safe");
      assert.strictEqual(analyzeBashCommand("git status").level, "safe");
      assert.strictEqual(analyzeBashCommand("git log --oneline -10").level, "safe");
      assert.strictEqual(analyzeBashCommand("grep -r pattern .").level, "safe");
      assert.strictEqual(analyzeBashCommand('find . -name "*.ts"').level, "safe");
      assert.strictEqual(analyzeBashCommand("node --version").level, "safe");
    });
  });

  describe("destructive commands", () => {
    it("detects rm -rf as dangerous", () => {
      const result = analyzeBashCommand("rm -rf /tmp/foo");
      assert.strictEqual(result.level, "dangerous");
      assert.ok(result.reasons.some((r) => r.includes("recursive force delete")));
    });

    it("detects rm -fr as dangerous", () => {
      const result = analyzeBashCommand("rm -fr .");
      assert.strictEqual(result.level, "dangerous");
    });

    it("detects rm without -rf as moderate", () => {
      const result = analyzeBashCommand("rm file.txt");
      assert.strictEqual(result.level, "moderate");
      assert.ok(result.reasons.some((r) => r.includes("destructive")));
    });

    it("detects dd as dangerous", () => {
      const result = analyzeBashCommand("dd if=/dev/zero of=/dev/sda");
      assert.strictEqual(result.level, "dangerous");
    });
  });

  describe("dangerous git operations", () => {
    it("detects git push --force", () => {
      const result = analyzeBashCommand("git push --force origin main");
      assert.strictEqual(result.level, "dangerous");
      assert.ok(result.reasons.some((r) => r.includes("force push to main")));
    });

    it("detects git reset --hard", () => {
      const result = analyzeBashCommand("git reset --hard HEAD~3");
      assert.strictEqual(result.level, "moderate");
      assert.ok(result.reasons.some((r) => r.includes("dangerous git")));
    });

    it("detects git clean -f", () => {
      const result = analyzeBashCommand("git clean -fd");
      assert.strictEqual(result.level, "moderate");
    });

    it("allows safe git operations", () => {
      assert.strictEqual(analyzeBashCommand("git add .").level, "safe");
      assert.strictEqual(analyzeBashCommand('git commit -m "fix"').level, "safe");
      assert.strictEqual(analyzeBashCommand("git push origin feature").level, "safe");
    });
  });

  describe("pipe to execution", () => {
    it("detects curl | bash as dangerous", () => {
      const result = analyzeBashCommand("curl https://example.com/install.sh | bash");
      assert.strictEqual(result.level, "dangerous");
      assert.ok(result.reasons.some((r) => r.includes("pipe to execution")));
    });

    it("detects wget | sh as dangerous", () => {
      const result = analyzeBashCommand("wget -O - https://example.com | sh");
      assert.strictEqual(result.level, "dangerous");
    });

    it("allows curl without pipe to exec", () => {
      const result = analyzeBashCommand("curl https://api.example.com/data");
      assert.strictEqual(result.level, "safe");
    });

    it("allows curl piped to jq (not execution)", () => {
      const result = analyzeBashCommand("curl https://api.example.com | jq .");
      assert.strictEqual(result.level, "safe");
    });
  });

  describe("permission changes", () => {
    it("detects chmod 777 as dangerous", () => {
      const result = analyzeBashCommand("chmod 777 /usr/bin/app");
      assert.strictEqual(result.level, "dangerous");
    });

    it("detects chmod as moderate", () => {
      const result = analyzeBashCommand("chmod +x script.sh");
      assert.strictEqual(result.level, "moderate");
    });
  });

  describe("package installation", () => {
    it("detects npm install as moderate", () => {
      const result = analyzeBashCommand("npm install lodash");
      assert.strictEqual(result.level, "moderate");
    });

    it("detects pip install as moderate", () => {
      const result = analyzeBashCommand("pip install requests");
      assert.strictEqual(result.level, "moderate");
    });
  });

  describe("compound commands", () => {
    it("detects dangerous commands in pipelines", () => {
      const result = analyzeBashCommand('find . -name "*.log" | xargs rm -rf');
      assert.strictEqual(result.level, "dangerous");
    });

    it("detects dangerous commands after &&", () => {
      const result = analyzeBashCommand("cd /tmp && rm -rf *");
      assert.strictEqual(result.level, "dangerous");
    });

    it("handles quoted strings with special chars", () => {
      const result = analyzeBashCommand('echo "hello | world && foo"');
      assert.strictEqual(result.level, "safe");
    });
  });
});

describe("isReadOnlyBashCommand", () => {
  it("accepts simple read-only commands", () => {
    assert.ok(isReadOnlyBashCommand("ls -la"));
    assert.ok(isReadOnlyBashCommand("cat file.txt"));
    assert.ok(isReadOnlyBashCommand("pwd"));
    assert.ok(isReadOnlyBashCommand("echo hello"));
    assert.ok(isReadOnlyBashCommand("grep -r foo ."));
    assert.ok(isReadOnlyBashCommand("find . -name '*.ts'"));
    assert.ok(isReadOnlyBashCommand("wc -l file.txt"));
    assert.ok(isReadOnlyBashCommand("head -n 20 log"));
  });

  it("accepts piped read-only pipelines", () => {
    assert.ok(isReadOnlyBashCommand("ls | head"));
    assert.ok(isReadOnlyBashCommand("cat file | grep foo | wc -l"));
    assert.ok(isReadOnlyBashCommand("git log --oneline | head -20"));
  });

  it("accepts read-only git subcommands", () => {
    assert.ok(isReadOnlyBashCommand("git status"));
    assert.ok(isReadOnlyBashCommand("git log --oneline -10"));
    assert.ok(isReadOnlyBashCommand("git diff HEAD~1"));
    assert.ok(isReadOnlyBashCommand("git show HEAD"));
    assert.ok(isReadOnlyBashCommand("git branch"));
    assert.ok(isReadOnlyBashCommand("git config --get user.name"));
  });

  it("rejects git write operations", () => {
    assert.strictEqual(isReadOnlyBashCommand("git commit -m x"), false);
    assert.strictEqual(isReadOnlyBashCommand("git push"), false);
    assert.strictEqual(isReadOnlyBashCommand("git branch -d feat"), false);
    assert.strictEqual(isReadOnlyBashCommand("git stash push"), false);
    assert.strictEqual(isReadOnlyBashCommand("git config user.name=foo"), false);
  });

  it("rejects destructive commands", () => {
    assert.strictEqual(isReadOnlyBashCommand("rm file.txt"), false);
    assert.strictEqual(isReadOnlyBashCommand("rm -rf /tmp/foo"), false);
    assert.strictEqual(isReadOnlyBashCommand("mv a b"), false);
    assert.strictEqual(isReadOnlyBashCommand("cp a b"), false);
  });

  it("rejects pipelines containing any write command", () => {
    assert.strictEqual(isReadOnlyBashCommand("ls | tee out.txt"), false);
    assert.strictEqual(isReadOnlyBashCommand("cat a && git commit -am x"), false);
    assert.strictEqual(isReadOnlyBashCommand("echo hi > /tmp/file"), false);
  });

  it("rejects sed -i (in-place edit)", () => {
    assert.strictEqual(isReadOnlyBashCommand("sed -i 's/a/b/' file"), false);
    assert.ok(isReadOnlyBashCommand("sed 's/a/b/' file")); // without -i is read-only
  });

  it("rejects redirection to files", () => {
    assert.strictEqual(isReadOnlyBashCommand("echo hi > /tmp/f"), false);
    assert.strictEqual(isReadOnlyBashCommand("ls >> log"), false);
  });

  it("rejects unknown commands by default", () => {
    assert.strictEqual(isReadOnlyBashCommand("custom-tool --flag"), false);
    assert.strictEqual(isReadOnlyBashCommand("npm install"), false);
  });

  it("rejects empty input", () => {
    assert.strictEqual(isReadOnlyBashCommand(""), false);
    assert.strictEqual(isReadOnlyBashCommand("   "), false);
  });
});

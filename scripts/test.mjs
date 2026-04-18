// Integration tests live under tests/integration/ and are opt-in; run them with:
//   OH_INTEGRATION=1 npx tsx --test tests/integration/<name>.test.ts
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

function findTests(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...findTests(full));
    } else if (entry.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

const tests = findTests("src");
execSync(`tsx --test ${tests.map((f) => `"${f}"`).join(" ")}`, {
  stdio: "inherit",
});

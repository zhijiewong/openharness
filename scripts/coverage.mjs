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
execSync(
  `npx c8 --reporter=text --reporter=text-summary --src=src --exclude="**/*.test.ts" --exclude="dist/**" tsx --test ${tests.map((f) => `"${f}"`).join(" ")}`,
  { stdio: "inherit" },
);

/**
 * Skills Registry — search and install community skills from a remote registry.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_REGISTRY_URL = "https://raw.githubusercontent.com/zhijiewong/openharness/main/data/registry.json";
const GLOBAL_SKILLS_DIR = join(homedir(), ".oh", "skills");

/** SPDX identifiers for licenses we install without explicit user acceptance. */
export const PERMISSIVE_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "CC0-1.0",
  "Unlicense",
]);

export type RegistrySkill = {
  name: string;
  description: string;
  author: string;
  version: string;
  source: string; // URL to raw .md file
  tags: string[];
  /** SPDX license identifier (e.g. "MIT"). Required for new entries; absent for legacy. */
  license?: string;
  /** Attribution string to preserve when installing (e.g. "© 2025 Jesse Vincent"). */
  attribution?: string;
  /** Upstream homepage / repo URL. */
  upstream?: string;
  /** When false, skill cannot be installed via this command — only linked to upstream. Used for viral licenses (CC-BY-SA, GPL). */
  installable?: boolean;
};

export type Registry = {
  skills: RegistrySkill[];
};

/** Fetch the registry from remote URL */
export async function fetchRegistry(url: string = DEFAULT_REGISTRY_URL): Promise<Registry> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch registry: ${response.status}`);
  return (await response.json()) as Registry;
}

/** Search registry by query (matches name, description, tags) */
export function searchRegistry(registry: Registry, query: string): RegistrySkill[] {
  const q = query.toLowerCase();
  return registry.skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

/** Result returned by installSkill — either success with path, or refusal with reason. */
export type InstallResult =
  | { ok: true; filePath: string }
  | { ok: false; reason: "not-installable" | "license-not-accepted"; message: string };

/** Install a skill from the registry to ~/.oh/skills/.
 * Refuses non-permissive licenses unless `acceptLicense` matches the entry's license.
 * Refuses entries with `installable: false` (e.g. viral-license skills that must be installed upstream).
 */
export async function installSkill(
  skill: RegistrySkill,
  opts: { acceptLicense?: string } = {},
): Promise<InstallResult> {
  // Gate 1: link-only entries
  if (skill.installable === false) {
    const upstream = skill.upstream ? ` Visit ${skill.upstream} to install under its license terms.` : "";
    return {
      ok: false,
      reason: "not-installable",
      message: `Skill "${skill.name}" is link-only (license: ${skill.license ?? "unknown"}).${upstream}`,
    };
  }

  // Gate 2: license check
  if (skill.license && !PERMISSIVE_LICENSES.has(skill.license)) {
    if (opts.acceptLicense !== skill.license) {
      return {
        ok: false,
        reason: "license-not-accepted",
        message:
          `Skill "${skill.name}" is licensed under ${skill.license}, which is not in the auto-install allowlist.\n` +
          `To install, re-run with --accept-license=${skill.license} to acknowledge its terms.`,
      };
    }
  }

  const response = await fetch(skill.source);
  if (!response.ok) throw new Error(`Failed to download skill: ${response.status}`);
  let content = await response.text();

  // Preserve attribution by prepending an HTML comment if present and not already in the file
  if (skill.attribution && !content.includes(skill.attribution)) {
    const header = `<!-- Source: ${skill.upstream ?? skill.source}\n     License: ${skill.license ?? "unknown"}\n     ${skill.attribution} -->\n`;
    content = header + content;
  }

  mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
  const slug = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const filePath = join(GLOBAL_SKILLS_DIR, `${slug}.md`);
  writeFileSync(filePath, content);
  return { ok: true, filePath };
}

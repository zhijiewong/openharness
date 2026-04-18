/**
 * Plugin Marketplace — discover, install, and manage plugins from curated registries.
 *
 * Marketplaces are JSON files listing available plugins with versions and sources.
 * Plugins are downloaded and cached to ~/.oh/plugins/cache/ for security and versioning.
 *
 * Inspired by Claude Code's marketplace model.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const MARKETPLACE_DIR = join(homedir(), ".oh", "marketplaces");
const PLUGIN_CACHE_DIR = join(homedir(), ".oh", "plugins", "cache");
const INSTALLED_PLUGINS_FILE = join(homedir(), ".oh", "plugins", "installed.json");

// Claude Code plugin manifest path relative to plugin root
const CC_MANIFEST_PATH = join(".claude-plugin", "plugin.json");

// ── Types ──

export type MarketplaceEntry = {
  name: string;
  description: string;
  version: string;
  author?: string;
  source: MarketplaceSource;
  keywords?: string[];
};

export type MarketplaceSource =
  | { type: "github"; repo: string }
  | { type: "npm"; package: string }
  | { type: "url"; url: string };

export type Marketplace = {
  name: string;
  version: number;
  description?: string;
  plugins: MarketplaceEntry[];
};

export type InstalledPlugin = {
  name: string;
  version: string;
  marketplace: string;
  installedAt: number;
  cachePath: string;
  /** Optional fields populated from `.claude-plugin/plugin.json` if present */
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  keywords?: string[];
};

/** Claude Code plugin manifest (`.claude-plugin/plugin.json`).
 * Required: name, description. All other fields optional.
 */
export type CcPluginManifest = {
  name: string;
  description: string;
  version?: string;
  author?: { name?: string; email?: string } | string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
};

/** Parse a `.claude-plugin/plugin.json` file at the given plugin root, or null if missing/invalid. */
export function parseCcPluginManifest(pluginRoot: string): CcPluginManifest | null {
  const path = join(pluginRoot, CC_MANIFEST_PATH);
  if (!existsSync(path)) return null;
  try {
    const m = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof m?.name !== "string" || typeof m?.description !== "string") return null;
    return m as CcPluginManifest;
  } catch {
    return null;
  }
}

/** Claude Code marketplace.json format — superset of OH's marketplace.json with source-typed entries. */
export type CcMarketplacePluginSource =
  | string // relative path "./plugins/foo"
  | { source: "github"; repo: string; ref?: string }
  | { source: "url"; url: string }
  | { source: "npm"; package: string; version?: string };

export type CcMarketplaceEntry = {
  name: string;
  description?: string;
  version?: string;
  author?: { name?: string; email?: string } | string;
  source: CcMarketplacePluginSource;
};

export type CcMarketplace = {
  name: string;
  description?: string;
  owner?: { name?: string; email?: string };
  plugins: CcMarketplaceEntry[];
};

/** Convert a CcMarketplace to OH's internal Marketplace type (lossy: dropped fields like `owner` are not stored). */
export function ccMarketplaceToOh(cc: CcMarketplace): Marketplace {
  const plugins: MarketplaceEntry[] = [];
  for (const p of cc.plugins) {
    const ohSource = ccSourceToOh(p.source);
    if (!ohSource) continue; // Skip relative-path sources — only resolvable inside the marketplace repo
    plugins.push({
      name: p.name,
      description: p.description ?? "",
      version: p.version ?? "0.0.0",
      author: typeof p.author === "string" ? p.author : p.author?.name,
      source: ohSource,
    });
  }
  return { name: cc.name, version: 1, description: cc.description, plugins };
}

function ccSourceToOh(src: CcMarketplacePluginSource): MarketplaceSource | null {
  if (typeof src === "string") return null; // relative paths require marketplace-repo context
  if (src.source === "github") return { type: "github", repo: src.repo };
  if (src.source === "url") return { type: "url", url: src.url };
  if (src.source === "npm") return { type: "npm", package: src.package };
  return null;
}

/** Parse marketplace JSON text. Tries CC format (.claude-plugin/marketplace.json shape) first, falls back to OH-native. */
export function parseMarketplaceJson(text: string): Marketplace | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.plugins)) return null;

  // Detect CC format: any plugin entry has either a string `source` or `source.source` (kind tag)
  const looksCc = obj.plugins.some((p: unknown) => {
    if (!p || typeof p !== "object") return false;
    const s = (p as Record<string, unknown>).source;
    return typeof s === "string" || (s !== null && typeof s === "object" && "source" in (s as Record<string, unknown>));
  });

  if (looksCc) {
    return ccMarketplaceToOh(obj as unknown as CcMarketplace);
  }
  // OH-native format
  return obj as unknown as Marketplace;
}

/** Discover plugin-shipped MCP servers from `cachePath/.mcp.json`. Returns raw object for the runtime to merge. */
export function getPluginMcpServers(cachePath: string): Record<string, unknown> | null {
  const path = join(cachePath, ".mcp.json");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    // Claude Code shape: { "mcpServers": { name: { command, args, env, ... } } }
    // Some plugins store the inner map directly. Accept both.
    if (data && typeof data === "object") {
      if ("mcpServers" in data && typeof data.mcpServers === "object")
        return data.mcpServers as Record<string, unknown>;
      return data as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Discover plugin-shipped hooks from `cachePath/hooks/hooks.json`. Returns raw config for the runtime to register. */
export function getPluginHooks(cachePath: string): Record<string, unknown> | null {
  const path = join(cachePath, "hooks", "hooks.json");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (data && typeof data === "object") return data as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/** Discover plugin-shipped LSP servers from `cachePath/.lsp.json`. Returns raw config for the runtime to register. */
export function getPluginLspServers(cachePath: string): Record<string, unknown> | null {
  const path = join(cachePath, ".lsp.json");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (data && typeof data === "object") {
      if ("lspServers" in data && typeof data.lspServers === "object")
        return data.lspServers as Record<string, unknown>;
      return data as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Marketplace Management ──

/** Add a marketplace from a URL, GitHub repo, or local path.
 * Probes for both OH-native `marketplace.json` and Claude Code `.claude-plugin/marketplace.json`.
 */
export function addMarketplace(nameOrUrl: string): Marketplace | null {
  mkdirSync(MARKETPLACE_DIR, { recursive: true });

  // Candidate filenames to try, in priority order
  const candidatePaths = ["marketplace.json", ".claude-plugin/marketplace.json"];

  let data: string | null = null;
  let marketplaceName: string;

  if (nameOrUrl.startsWith("http")) {
    marketplaceName = new URL(nameOrUrl).hostname;
    for (const fname of candidatePaths) {
      try {
        const text = execSync(`curl -sfL "${nameOrUrl}/${fname}"`, { encoding: "utf-8", timeout: 10_000 });
        if (text.trim()) {
          data = text;
          break;
        }
      } catch {
        /* try next */
      }
    }
  } else if (nameOrUrl.includes("/") && !nameOrUrl.startsWith(".")) {
    marketplaceName = nameOrUrl.replace("/", "-");
    for (const fname of candidatePaths) {
      try {
        const url = `https://raw.githubusercontent.com/${nameOrUrl}/main/${fname}`;
        const text = execSync(`curl -sfL "${url}"`, { encoding: "utf-8", timeout: 10_000 });
        if (text.trim()) {
          data = text;
          break;
        }
      } catch {
        /* try next */
      }
    }
  } else {
    marketplaceName = basename(nameOrUrl);
    for (const fname of candidatePaths) {
      const path = join(nameOrUrl, fname);
      if (existsSync(path)) {
        data = readFileSync(path, "utf-8");
        break;
      }
    }
  }

  if (!data) return null;

  const marketplace = parseMarketplaceJson(data);
  if (!marketplace) return null;
  marketplace.name = marketplace.name ?? marketplaceName;
  writeFileSync(join(MARKETPLACE_DIR, `${marketplace.name}.json`), JSON.stringify(marketplace, null, 2));
  return marketplace;
}

/** Remove a marketplace */
export function removeMarketplace(name: string): boolean {
  const path = join(MARKETPLACE_DIR, `${name}.json`);
  if (!existsSync(path)) return false;
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

/** List all configured marketplaces */
export function listMarketplaces(): Marketplace[] {
  if (!existsSync(MARKETPLACE_DIR)) return [];
  return readdirSync(MARKETPLACE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(MARKETPLACE_DIR, f), "utf-8")) as Marketplace;
      } catch {
        return null;
      }
    })
    .filter((m): m is Marketplace => m !== null);
}

/** Search all marketplaces for plugins matching a query */
export function searchMarketplace(query: string): Array<MarketplaceEntry & { marketplace: string }> {
  const q = query.toLowerCase();
  const results: Array<MarketplaceEntry & { marketplace: string }> = [];

  for (const mp of listMarketplaces()) {
    for (const plugin of mp.plugins) {
      if (
        plugin.name.toLowerCase().includes(q) ||
        plugin.description.toLowerCase().includes(q) ||
        plugin.keywords?.some((k) => k.toLowerCase().includes(q))
      ) {
        results.push({ ...plugin, marketplace: mp.name });
      }
    }
  }

  return results;
}

// ── Plugin Installation ──

/** Install a plugin from a marketplace */
export function installPlugin(pluginName: string, marketplaceName?: string): InstalledPlugin | null {
  // Find the plugin in marketplaces
  const marketplaces = listMarketplaces();
  let entry: MarketplaceEntry | null = null;
  let fromMarketplace = "";

  for (const mp of marketplaces) {
    if (marketplaceName && mp.name !== marketplaceName) continue;
    const found = mp.plugins.find((p) => p.name === pluginName);
    if (found) {
      entry = found;
      fromMarketplace = mp.name;
      break;
    }
  }

  if (!entry) return null;

  // Download to cache
  const cacheDir = join(PLUGIN_CACHE_DIR, entry.name, entry.version);
  mkdirSync(cacheDir, { recursive: true });

  try {
    switch (entry.source.type) {
      case "github": {
        // Clone the repo to cache
        execSync(`git clone --depth 1 "https://github.com/${entry.source.repo}.git" "${cacheDir}"`, {
          stdio: "pipe",
          timeout: 30_000,
        });
        break;
      }
      case "npm": {
        // Install npm package to cache
        execSync(`npm pack "${entry.source.package}" --pack-destination "${cacheDir}"`, {
          stdio: "pipe",
          timeout: 30_000,
        });
        // Extract the tarball
        const tgz = readdirSync(cacheDir).find((f) => f.endsWith(".tgz"));
        if (tgz) {
          execSync(`tar xzf "${join(cacheDir, tgz)}" -C "${cacheDir}" --strip-components=1`, { stdio: "pipe" });
        }
        break;
      }
      case "url": {
        execSync(`curl -sL "${entry.source.url}" -o "${join(cacheDir, "plugin.tar.gz")}"`, {
          stdio: "pipe",
          timeout: 30_000,
        });
        execSync(`tar xzf "${join(cacheDir, "plugin.tar.gz")}" -C "${cacheDir}"`, { stdio: "pipe" });
        break;
      }
    }
  } catch {
    // Clean up failed install
    try {
      rmSync(cacheDir, { recursive: true });
    } catch {
      /* ignore */
    }
    return null;
  }

  // Record installation
  const installed: InstalledPlugin = {
    name: entry.name,
    version: entry.version,
    marketplace: fromMarketplace,
    installedAt: Date.now(),
    cachePath: cacheDir,
  };

  saveInstalledPlugin(installed);
  return installed;
}

/** Uninstall a plugin */
export function uninstallPlugin(name: string): boolean {
  const installed = getInstalledPlugins();
  const plugin = installed.find((p) => p.name === name);
  if (!plugin) return false;

  // Remove from cache
  try {
    rmSync(plugin.cachePath, { recursive: true });
  } catch {
    /* ignore */
  }

  // Remove from installed list
  const remaining = installed.filter((p) => p.name !== name);
  saveInstalledPluginList(remaining);
  return true;
}

/** Get all installed plugins.
 * Sources merged in priority order:
 * 1. installed.json (plugins installed via /plugin install or addMarketplace flow)
 * 2. CC-style plugins discovered in PLUGIN_CACHE_DIR via .claude-plugin/plugin.json
 *    (covers plugins manually dropped in the cache, or installed by parallel tooling)
 * Plugins from #1 are enriched with manifest data if their cachePath has one.
 * De-duplication is by cachePath.
 */
export function getInstalledPlugins(): InstalledPlugin[] {
  const recorded: InstalledPlugin[] = (() => {
    if (!existsSync(INSTALLED_PLUGINS_FILE)) return [];
    try {
      return JSON.parse(readFileSync(INSTALLED_PLUGINS_FILE, "utf-8")) as InstalledPlugin[];
    } catch {
      return [];
    }
  })();

  // Enrich recorded plugins from their CC manifest if present
  const enriched = recorded.map((p) => mergeManifest(p, parseCcPluginManifest(p.cachePath)));
  const seenPaths = new Set(enriched.map((p) => p.cachePath));

  // Discover CC-style plugins in PLUGIN_CACHE_DIR not already recorded
  const discovered: InstalledPlugin[] = [];
  if (existsSync(PLUGIN_CACHE_DIR)) {
    try {
      for (const nameEntry of readdirSync(PLUGIN_CACHE_DIR)) {
        const nameDir = join(PLUGIN_CACHE_DIR, nameEntry);
        if (!safeIsDirectory(nameDir)) continue;
        // Plugin can sit either at <name>/ or <name>/<version>/
        const candidates = [nameDir, ...listSubdirs(nameDir)];
        for (const root of candidates) {
          if (seenPaths.has(root)) continue;
          const manifest = parseCcPluginManifest(root);
          if (!manifest) continue;
          discovered.push({
            name: manifest.name,
            version: manifest.version ?? "0.0.0",
            marketplace: "discovered",
            installedAt: tryStatTime(root),
            cachePath: root,
            ...projectManifestFields(manifest),
          });
          seenPaths.add(root);
        }
      }
    } catch {
      /* ignore */
    }
  }

  return [...enriched, ...discovered];
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((entry) => join(dir, entry))
      .filter((p) => safeIsDirectory(p));
  } catch {
    return [];
  }
}

function tryStatTime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return Date.now();
  }
}

function projectManifestFields(
  m: CcPluginManifest,
): Pick<InstalledPlugin, "description" | "author" | "license" | "homepage" | "keywords"> {
  return {
    description: m.description,
    author: typeof m.author === "string" ? m.author : m.author?.name,
    license: m.license,
    homepage: m.homepage,
    keywords: m.keywords,
  };
}

function mergeManifest(plugin: InstalledPlugin, manifest: CcPluginManifest | null): InstalledPlugin {
  if (!manifest) return plugin;
  return { ...plugin, ...projectManifestFields(manifest) };
}

function saveInstalledPlugin(plugin: InstalledPlugin): void {
  const installed = getInstalledPlugins();
  // Replace existing version
  const idx = installed.findIndex((p) => p.name === plugin.name);
  if (idx >= 0) installed[idx] = plugin;
  else installed.push(plugin);
  saveInstalledPluginList(installed);
}

function saveInstalledPluginList(plugins: InstalledPlugin[]): void {
  const dir = join(homedir(), ".oh", "plugins");
  mkdirSync(dir, { recursive: true });
  writeFileSync(INSTALLED_PLUGINS_FILE, JSON.stringify(plugins, null, 2));
}

// ── Formatting ──

/** Format marketplace entries for display */
export function formatMarketplaceSearch(results: Array<MarketplaceEntry & { marketplace: string }>): string {
  if (results.length === 0) return "No plugins found.";

  const lines: string[] = [`Found ${results.length} plugin(s):\n`];
  for (const r of results) {
    lines.push(`  ${r.name}@${r.version}  [${r.marketplace}]`);
    lines.push(`    ${r.description}`);
    if (r.author) lines.push(`    by ${r.author}`);
    lines.push("");
  }
  lines.push("Install with: /plugin install <name>");
  return lines.join("\n");
}

/** Format installed plugins for display */
export function formatInstalledPlugins(plugins: InstalledPlugin[]): string {
  if (plugins.length === 0) return "No plugins installed from marketplaces.";

  const lines: string[] = [`Installed Plugins (${plugins.length}):\n`];
  for (const p of plugins) {
    const age = Math.round((Date.now() - p.installedAt) / (1000 * 60 * 60 * 24));
    lines.push(`  ${p.name}@${p.version}  [${p.marketplace}]  ${age}d ago`);
  }
  return lines.join("\n");
}

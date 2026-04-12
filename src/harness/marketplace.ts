/**
 * Plugin Marketplace — discover, install, and manage plugins from curated registries.
 *
 * Marketplaces are JSON files listing available plugins with versions and sources.
 * Plugins are downloaded and cached to ~/.oh/plugins/cache/ for security and versioning.
 *
 * Inspired by Claude Code's marketplace model.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const MARKETPLACE_DIR = join(homedir(), ".oh", "marketplaces");
const PLUGIN_CACHE_DIR = join(homedir(), ".oh", "plugins", "cache");
const INSTALLED_PLUGINS_FILE = join(homedir(), ".oh", "plugins", "installed.json");

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
};

// ── Marketplace Management ──

/** Add a marketplace from a URL, GitHub repo, or local path */
export function addMarketplace(nameOrUrl: string): Marketplace | null {
  mkdirSync(MARKETPLACE_DIR, { recursive: true });

  // Fetch marketplace.json
  let data: string;
  let marketplaceName: string;

  if (nameOrUrl.startsWith("http")) {
    // URL
    try {
      data = execSync(`curl -sL "${nameOrUrl}/marketplace.json"`, { encoding: "utf-8", timeout: 10_000 });
      marketplaceName = new URL(nameOrUrl).hostname;
    } catch {
      return null;
    }
  } else if (nameOrUrl.includes("/") && !nameOrUrl.startsWith(".")) {
    // GitHub repo (owner/repo format)
    try {
      const url = `https://raw.githubusercontent.com/${nameOrUrl}/main/marketplace.json`;
      data = execSync(`curl -sL "${url}"`, { encoding: "utf-8", timeout: 10_000 });
      marketplaceName = nameOrUrl.replace("/", "-");
    } catch {
      return null;
    }
  } else if (existsSync(join(nameOrUrl, "marketplace.json"))) {
    // Local path
    data = readFileSync(join(nameOrUrl, "marketplace.json"), "utf-8");
    marketplaceName = basename(nameOrUrl);
  } else {
    return null;
  }

  try {
    const marketplace = JSON.parse(data) as Marketplace;
    if (!marketplace.plugins || !Array.isArray(marketplace.plugins)) return null;

    marketplace.name = marketplace.name ?? marketplaceName;
    writeFileSync(join(MARKETPLACE_DIR, `${marketplace.name}.json`), JSON.stringify(marketplace, null, 2));
    return marketplace;
  } catch {
    return null;
  }
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

/** Get all installed plugins */
export function getInstalledPlugins(): InstalledPlugin[] {
  if (!existsSync(INSTALLED_PLUGINS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(INSTALLED_PLUGINS_FILE, "utf-8"));
  } catch {
    return [];
  }
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

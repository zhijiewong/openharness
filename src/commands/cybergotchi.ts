import { roll } from "../cybergotchi/bones.js";
import { loadCompanionConfig, saveCompanionConfig } from "../cybergotchi/config.js";
import { adjustNeed } from "../cybergotchi/needs.js";
import { RARITY_STARS } from "../cybergotchi/types.js";
import type { CommandResult } from "./index.js";

function needsBar(value: number): string {
  const filled = Math.round(value / 10);
  return `${"█".repeat(filled) + "░".repeat(10 - filled)} ${String(Math.round(value)).padStart(3)}`;
}

export function handleCybergotchiCommand(args: string): CommandResult {
  const config = loadCompanionConfig();
  if (!config) {
    return { output: "", handled: true, openCybergotchiSetup: true } as CommandResult & {
      openCybergotchiSetup: boolean;
    };
  }

  const bones = roll(config.seed);
  const name = config.soul.name;
  const sub = args.trim().toLowerCase();

  if (sub === "feed") {
    adjustNeed(config, "hunger", 30);
    saveCompanionConfig(config);
    return { output: `${name} munches happily! 🍖 Hunger: ${Math.round(config.needs.hunger)}`, handled: true };
  }

  if (sub === "pet") {
    adjustNeed(config, "happiness", 20);
    saveCompanionConfig(config);
    return { output: `${name} purrs with joy! 💛 Happiness: ${Math.round(config.needs.happiness)}`, handled: true };
  }

  if (sub === "rest") {
    adjustNeed(config, "energy", 40);
    saveCompanionConfig(config);
    return { output: `${name} takes a nap... ⚡ Energy: ${Math.round(config.needs.energy)}`, handled: true };
  }

  if (sub === "status") {
    const { hunger, energy, happiness } = config.needs;
    const { totalSessions, totalCommits, totalErrors, totalTasksCompleted, longestStreak } = config.lifetime;
    const lines = [
      `${name} (${bones.species}) — ${bones.rarity} ${RARITY_STARS[bones.rarity]}${bones.isShiny ? " ✨ SHINY" : ""}`,
      config.soul.personality ? `"${config.soul.personality}"` : "",
      "",
      `🍖 Hunger    ${needsBar(hunger)}`,
      `⚡ Energy    ${needsBar(energy)}`,
      `💛 Happiness ${needsBar(happiness)}`,
      `🔥 Streak    ${config.currentStreak} (best: ${longestStreak})`,
      "",
      "Stats:",
      ...Object.entries(bones.baseStats).map(
        ([k, v]) => `  ${k.padEnd(12)} ${"█".repeat(Math.round(v / 10))}${"░".repeat(10 - Math.round(v / 10))} ${v}`,
      ),
      "",
      "Lifetime:",
      `  Sessions:  ${totalSessions}`,
      `  Commits:   ${totalCommits}`,
      `  Errors:    ${totalErrors}`,
      `  Tasks:     ${totalTasksCompleted}`,
      `  Evolution: Stage ${config.evolutionStage}`,
    ].filter(Boolean);
    return { output: lines.join("\n"), handled: true };
  }

  if (sub.startsWith("rename ")) {
    const newName = args.trim().slice(7).trim();
    if (!newName) return { output: "Usage: /cybergotchi rename <name>", handled: true };
    config.soul.name = newName;
    saveCompanionConfig(config);
    return { output: `Renamed to ${newName}!`, handled: true };
  }

  if (sub === "reset") {
    return { output: "", handled: true, openCybergotchiSetup: true } as CommandResult & {
      openCybergotchiSetup: boolean;
    };
  }

  // Default: show summary
  return {
    output: [
      `${name} (${bones.species}) — ${bones.rarity} ${RARITY_STARS[bones.rarity]}${bones.isShiny ? " ✨" : ""} | hat: ${config.soul.hat}`,
      `🍖 ${Math.round(config.needs.hunger)}  ⚡ ${Math.round(config.needs.energy)}  💛 ${Math.round(config.needs.happiness)}  🔥 ${config.currentStreak}`,
      "",
      "Commands: feed · pet · rest · status · rename <name> · reset",
    ].join("\n"),
    handled: true,
  };
}

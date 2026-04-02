import type { CommandResult } from './index.js';
import { loadCybergotchiConfig, saveCybergotchiConfig } from '../cybergotchi/config.js';
import { adjustNeed } from '../cybergotchi/needs.js';

function needsBar(value: number): string {
  const filled = Math.round(value / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ' ' + String(Math.round(value)).padStart(3);
}

export function handleCybergotchiCommand(args: string): CommandResult {
  const config = loadCybergotchiConfig();
  if (!config) {
    return { output: '', handled: true, openCybergotchiSetup: true } as CommandResult & { openCybergotchiSetup: boolean };
  }

  const sub = args.trim().toLowerCase();

  if (sub === 'feed') {
    adjustNeed(config, 'hunger', 30);
    saveCybergotchiConfig(config);
    return { output: `${config.name} munches happily! 🍖 Hunger: ${Math.round(config.needs.hunger)}`, handled: true };
  }

  if (sub === 'pet') {
    adjustNeed(config, 'happiness', 20);
    saveCybergotchiConfig(config);
    return { output: `${config.name} purrs with joy! 💛 Happiness: ${Math.round(config.needs.happiness)}`, handled: true };
  }

  if (sub === 'rest') {
    adjustNeed(config, 'energy', 40);
    saveCybergotchiConfig(config);
    return { output: `${config.name} takes a nap... ⚡ Energy: ${Math.round(config.needs.energy)}`, handled: true };
  }

  if (sub === 'status') {
    const { hunger, energy, happiness } = config.needs;
    const { totalSessions, totalCommits, totalErrors, totalTasksCompleted, longestStreak } = config.lifetime;
    const lines = [
      `${config.name} (${config.species})`,
      '',
      `🍖 Hunger    ${needsBar(hunger)}`,
      `⚡ Energy    ${needsBar(energy)}`,
      `💛 Happiness ${needsBar(happiness)}`,
      `🔥 Streak    ${config.currentStreak} (best: ${longestStreak})`,
      '',
      'Lifetime:',
      `  Sessions:  ${totalSessions}`,
      `  Commits:   ${totalCommits}`,
      `  Errors:    ${totalErrors}`,
      `  Tasks:     ${totalTasksCompleted}`,
    ];
    return { output: lines.join('\n'), handled: true };
  }

  if (sub.startsWith('rename ')) {
    const newName = args.trim().slice(7).trim();
    if (!newName) return { output: 'Usage: /cybergotchi rename <name>', handled: true };
    config.name = newName;
    saveCybergotchiConfig(config);
    return { output: `Renamed to ${newName}!`, handled: true };
  }

  if (sub === 'reset') {
    return { output: '', handled: true, openCybergotchiSetup: true } as CommandResult & { openCybergotchiSetup: boolean };
  }

  // Default: show summary
  const statLines = Object.entries(config.stats)
    .map(([k, v]) => `  ${k.padEnd(12)} ${'█'.repeat(Math.round(v / 10))}${'░'.repeat(10 - Math.round(v / 10))} ${v}`)
    .join('\n');

  return {
    output: [
      `${config.name} (${config.species}) | hat: ${config.hat}`,
      `🍖 ${Math.round(config.needs.hunger)}  ⚡ ${Math.round(config.needs.energy)}  💛 ${Math.round(config.needs.happiness)}  🔥 ${config.currentStreak}`,
      '',
      'Personality stats:',
      statLines,
      '',
      'Commands: feed · pet · rest · status · rename <name> · reset',
    ].join('\n'),
    handled: true,
  };
}

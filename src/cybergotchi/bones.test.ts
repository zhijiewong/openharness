import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { roll, getDefaultSeed } from './bones.js';
import { SPECIES } from './species.js';
import { RARITY_TIERS } from './types.js';
import type { Rarity, Stat } from './types.js';

const VALID_RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const STAT_KEYS: Stat[] = ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'];
const SPECIES_NAMES = SPECIES.map((s) => s.name);

describe('bones – roll()', () => {
  it('1. determinism: same seed produces identical bones', () => {
    const a = roll('test-seed-alpha');
    const b = roll('test-seed-alpha');
    assert.deepStrictEqual(a, b);
  });

  it('2. different seeds produce different species (10 seeds)', () => {
    const species = new Set<string>();
    for (let i = 0; i < 10; i++) {
      species.add(roll(`diff-seed-${i}`).species);
    }
    assert.ok(species.size > 1, `Expected more than 1 unique species from 10 seeds, got ${species.size}`);
  });

  it('3. species is a valid SPECIES name', () => {
    for (let i = 0; i < 50; i++) {
      const bones = roll(`species-check-${i}`);
      assert.ok(
        SPECIES_NAMES.includes(bones.species),
        `Unknown species: ${bones.species}`,
      );
    }
  });

  it('4. rarity is a valid enum value', () => {
    for (let i = 0; i < 100; i++) {
      const bones = roll(`rarity-check-${i}`);
      assert.ok(
        VALID_RARITIES.includes(bones.rarity),
        `Invalid rarity: ${bones.rarity}`,
      );
    }
  });

  it('5. all stats in 0-100 range', () => {
    for (let i = 0; i < 200; i++) {
      const bones = roll(`stat-range-${i}`);
      for (const key of STAT_KEYS) {
        const val = bones.baseStats[key];
        assert.ok(val >= 0 && val <= 100, `Stat ${key} = ${val} out of range for seed stat-range-${i}`);
      }
    }
  });

  it('6. stat floor matches rarity tier (legendary stats >= 50)', () => {
    // Brute-force find a legendary seed
    let legendarySeed: string | null = null;
    for (let i = 0; i < 100_000; i++) {
      const bones = roll(`legendary-hunt-${i}`);
      if (bones.rarity === 'legendary') {
        legendarySeed = `legendary-hunt-${i}`;
        break;
      }
    }
    assert.ok(legendarySeed !== null, 'Could not find a legendary seed in 100k attempts');

    const bones = roll(legendarySeed!);
    const legendaryFloor = RARITY_TIERS.find((t) => t.rarity === 'legendary')!.statFloor;
    for (const key of STAT_KEYS) {
      assert.ok(
        bones.baseStats[key] >= legendaryFloor,
        `Legendary stat ${key} = ${bones.baseStats[key]}, expected >= ${legendaryFloor}`,
      );
    }
  });

  it('7. peak stat > dump stat for a known seed', () => {
    const bones = roll('peak-dump-test');
    const values = STAT_KEYS.map((k) => bones.baseStats[k]);
    const max = Math.max(...values);
    const min = Math.min(...values);
    assert.ok(max > min, `Expected peak (${max}) > dump (${min})`);
  });

  it('8. rarity distribution: common > uncommon > rare > epic > legendary over 10000 seeds', () => {
    const counts: Record<Rarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };
    for (let i = 0; i < 10_000; i++) {
      counts[roll(`seed-${i}`).rarity]++;
    }
    assert.ok(
      counts.common > counts.uncommon,
      `common (${counts.common}) should exceed uncommon (${counts.uncommon})`,
    );
    assert.ok(
      counts.uncommon > counts.rare,
      `uncommon (${counts.uncommon}) should exceed rare (${counts.rare})`,
    );
    assert.ok(
      counts.rare > counts.epic,
      `rare (${counts.rare}) should exceed epic (${counts.epic})`,
    );
    assert.ok(
      counts.epic > counts.legendary,
      `epic (${counts.epic}) should exceed legendary (${counts.legendary})`,
    );
  });

  it('9. shiny rate approximately 1% (0.1%-5% tolerance) over 10000 seeds', () => {
    let shinyCount = 0;
    for (let i = 0; i < 10_000; i++) {
      if (roll(`seed-${i}`).isShiny) shinyCount++;
    }
    const rate = shinyCount / 10_000;
    assert.ok(
      rate >= 0.001 && rate <= 0.05,
      `Shiny rate ${(rate * 100).toFixed(2)}% outside 0.1%-5% tolerance`,
    );
  });
});

describe('bones – getDefaultSeed()', () => {
  it('10. returns a non-empty string', () => {
    const seed = getDefaultSeed();
    assert.ok(typeof seed === 'string', 'Expected string');
    assert.ok(seed.length > 0, 'Expected non-empty seed');
  });
});

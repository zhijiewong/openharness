import type { Emotion } from './types.js';

export interface SpeciesDef {
  name: string;
  label: string;
  traitHint: string;
  // frames[emotion] = array of frames → 5 lines of 12 chars
  // Use {E} as placeholder for eye injection (3 chars: "x x")
  frames: Record<Emotion, string[][]>;
}

// Pad string to exactly 12 chars
function p(s: string): string {
  if (s.length >= 12) return s.slice(0, 12);
  return s + ' '.repeat(12 - s.length);
}

// Build a frame: 5 lines of 12 chars
function f(...lines: string[]): string[] {
  return lines.map(p);
}

// ─── Duck ───────────────────────────────────────
const duck: SpeciesDef = {
  name: 'duck',
  label: 'Duck',
  traitHint: 'Curious and quacky. Gets things done.',
  frames: {
    idle: [
      f('   .__.     ', '  ( {E} )  ', '   \\ V /   ', '  /|~~~|\\  ', '  /_| |_\\  '),
      f('   .__.     ', '  ( {E} )  ', '   \\ V /   ', '  /|~~~|\\  ', '  \\_| |_/  '),
      f('   .__.     ', '  ( {E} )  ', '   \\ v /   ', '  /|~~~|\\  ', '  /_| |_\\  '),
    ],
    happy: [
      f('   .__.     ', '  ( {E} )  ', '   \\ ^ /   ', '  /|~~~|\\  ', '  /_| |_\\  '),
    ],
    alarm: [
      f('   .!!.     ', '  ( {E} )  ', '   \\ O /   ', '  /|~~~|\\  ', '  /_| |_\\  '),
    ],
  },
};

// ─── Goose ──────────────────────────────────────
const goose: SpeciesDef = {
  name: 'goose',
  label: 'Goose',
  traitHint: 'Chaotic energy. Honks at bugs.',
  frames: {
    idle: [
      f('   _/~      ', '  / {E} )   ', ' |  <>  |   ', ' |  ~~  |   ', '  \\_||_/    '),
      f('   _/~      ', '  / {E} )   ', ' |  <>  |   ', ' |  ~~  |   ', '  \\_||_/  ~ '),
      f('   _/~~     ', '  / {E} )   ', ' |  <>  |   ', ' |  ~~  |   ', '  \\_||_/    '),
    ],
    happy: [
      f('   _/~  !   ', '  / {E} )   ', ' |  ^>  |   ', ' |  ~~  |   ', '  \\_||_/    '),
    ],
    alarm: [
      f('  !_/~!     ', '  / {E} )   ', ' |  OO  |   ', ' |  ~~  |   ', '  \\_||_/    '),
    ],
  },
};

// ─── Cat ────────────────────────────────────────
const cat: SpeciesDef = {
  name: 'cat',
  label: 'Cat',
  traitHint: 'Independent. Judges your code silently.',
  frames: {
    idle: [
      f(' /\\   /\\    ', '( {E}  )   ', ' \\ ^ /     ', '  |~|      ', ' _/ \\_     '),
      f(' /\\   /\\    ', '( {E}  )   ', ' \\ ^ /     ', '  |~|   ~  ', ' _/ \\_  /  '),
      f(' /\\   /\\    ', '( {E}  )   ', ' \\ . /     ', '  |~|      ', ' _/ \\_     '),
    ],
    happy: [
      f(' /\\   /\\    ', '( {E}  )   ', ' \\ w /     ', '  |~|      ', ' _/ \\_     '),
    ],
    alarm: [
      f(' /!   !\\    ', '( {E}  )   ', ' \\ ! /     ', '  |~|      ', ' _/ \\_     '),
    ],
  },
};

// ─── Rabbit ─────────────────────────────────────
const rabbit: SpeciesDef = {
  name: 'rabbit',
  label: 'Rabbit',
  traitHint: 'Fast learner. Hops between tasks.',
  frames: {
    idle: [
      f(' (\\  /)     ', ' ( {E} )   ', '  ( > )    ', '  /| |\\    ', '  d_ _b    '),
      f(' (\\  /)     ', ' ( {E} )   ', '  ( > )    ', '  /| |\\    ', ' d_   _b   '),
      f(' (\\  /)     ', ' ( {E} )   ', '  ( . )    ', '  /| |\\    ', '  d_ _b    '),
    ],
    happy: [
      f(' (\\  /)     ', ' ( {E} )   ', '  ( ^ )    ', '  /| |\\    ', '  d_ _b    '),
    ],
    alarm: [
      f(' (!  !)     ', ' ( {E} )   ', '  ( O )    ', '  /| |\\    ', '  d_ _b    '),
    ],
  },
};

// ─── Owl ────────────────────────────────────────
const owl: SpeciesDef = {
  name: 'owl',
  label: 'Owl',
  traitHint: 'Wise and watchful. Knows all the patterns.',
  frames: {
    idle: [
      f('  /\\__/\\    ', ' ( {E} )   ', '  (/\\/)    ', '  |__|     ', '  _/\\_     '),
      f('  /\\__/\\    ', ' ( {E} )   ', '  (/\\/)    ', '  |__|     ', ' _/ \\_     '),
      f('  /\\__/\\    ', ' ( {E} )   ', '  ( \\/)    ', '  |__|     ', '  _/\\_     '),
    ],
    happy: [
      f('  /\\__/\\    ', ' ( {E} )   ', '  (^^\\/^)  ', '  |__|     ', '  _/\\_     '),
    ],
    alarm: [
      f('  /!__!\\    ', ' ( {E} )   ', '  (/!!\\)   ', '  |__|     ', '  _/\\_     '),
    ],
  },
};

// ─── Penguin ────────────────────────────────────
const penguin: SpeciesDef = {
  name: 'penguin',
  label: 'Penguin',
  traitHint: 'Formal but playful. Loves clean code.',
  frames: {
    idle: [
      f('   .~~.     ', '  / {E} \\  ', ' | \\__/ |  ', '  \\|  |/   ', '   L  L    '),
      f('   .~~.     ', '  / {E} \\  ', ' | \\__/ |  ', '  \\|  |/   ', '   L  J    '),
      f('   .~~.     ', '  / {E} \\  ', ' | \\../ |  ', '  \\|  |/   ', '   L  L    '),
    ],
    happy: [
      f('   .~~.     ', '  / {E} \\  ', ' | \\^^/ |  ', '  \\|  |/   ', '   L  L    '),
    ],
    alarm: [
      f('   .!!.     ', '  / {E} \\  ', ' | \\OO/ |  ', '  \\|  |/   ', '   L  L    '),
    ],
  },
};

// ─── Turtle ─────────────────────────────────────
const turtle: SpeciesDef = {
  name: 'turtle',
  label: 'Turtle',
  traitHint: 'Slow and steady. Rock-solid reliability.',
  frames: {
    idle: [
      f('            ', '   _{E}_    ', '  /=====\\   ', ' |~~~~~~~|  ', '  d_/ \\_b   '),
      f('            ', '   _{E}_    ', '  /=====\\   ', ' |~~~~~~~|  ', ' d__/ \\__b  '),
      f('            ', '   _{E}_    ', '  /=====\\   ', ' |~.~.~.~|  ', '  d_/ \\_b   '),
    ],
    happy: [
      f('            ', '   _{E}_    ', '  /=====\\   ', ' |~~^^^~~|  ', '  d_/ \\_b   '),
    ],
    alarm: [
      f('     !!     ', '   _{E}_    ', '  /=====\\   ', ' |~!!!!!~|  ', '  d_/ \\_b   '),
    ],
  },
};

// ─── Snail ──────────────────────────────────────
const snail: SpeciesDef = {
  name: 'snail',
  label: 'Snail',
  traitHint: 'Patient. Leaves a trail of documentation.',
  frames: {
    idle: [
      f('    \\  \\    ', '   ( {E} ) ', '   /@@@\\   ', '  |_____|  ', ' ~~~~~~~~~~'),
      f('    |  |    ', '   ( {E} ) ', '   /@@@\\   ', '  |_____|  ', ' ~~~~~~~~~~'),
      f('    \\  \\    ', '   ( {E} ) ', '   /@@@\\   ', '  |_____|  ', '  ~~~~~~~~~'),
    ],
    happy: [
      f('    \\  \\    ', '   ( {E} ) ', '   /@@@\\   ', '  |__^__|  ', ' ~~~~~~~~~~'),
    ],
    alarm: [
      f('    !  !    ', '   ( {E} ) ', '   /@@@\\   ', '  |__!__|  ', ' ~~~~~~~~~~'),
    ],
  },
};

// ─── Dragon ─────────────────────────────────────
const dragon: SpeciesDef = {
  name: 'dragon',
  label: 'Dragon',
  traitHint: 'Fierce protector of clean architecture.',
  frames: {
    idle: [
      f(' /\\/\\       ', '( {E}  )>  ', ' \\~~~/     ', '  |/\\|     ', '  d  b     '),
      f(' /\\/\\       ', '( {E}  )>  ', ' \\~~~/     ', '  |/\\| ~   ', '  d  b/    '),
      f(' /\\/\\    *  ', '( {E}  )>  ', ' \\~~~/     ', '  |/\\|     ', '  d  b     '),
    ],
    happy: [
      f(' /\\/\\   *~  ', '( {E}  )>  ', ' \\^^^/     ', '  |/\\|     ', '  d  b     '),
    ],
    alarm: [
      f(' /\\/\\ *~*~  ', '( {E}  )>  ', ' \\!!!/     ', '  |/\\|     ', '  d  b     '),
    ],
  },
};

// ─── Octopus ────────────────────────────────────
const octopus: SpeciesDef = {
  name: 'octopus',
  label: 'Octopus',
  traitHint: 'Multi-tasker. Eight arms, eight PRs.',
  frames: {
    idle: [
      f('   .---.    ', '  ( {E} )  ', '   \\~~/    ', '  /|/\\|\\   ', ' ~ |  | ~  '),
      f('   .---.    ', '  ( {E} )  ', '   \\~~/    ', '  \\|/\\|/   ', '  ~|  |~   '),
      f('   .---.    ', '  ( {E} )  ', '   \\../    ', '  /|/\\|\\   ', ' ~ |  | ~  '),
    ],
    happy: [
      f('   .---.    ', '  ( {E} )  ', '   \\^^/    ', '  \\|/\\|/   ', '  ~|  |~   '),
    ],
    alarm: [
      f('   .!!-.    ', '  ( {E} )  ', '   \\!!/    ', '  /|/\\|\\   ', ' ~!|  |!~  '),
    ],
  },
};

// ─── Axolotl ────────────────────────────────────
const axolotl: SpeciesDef = {
  name: 'axolotl',
  label: 'Axolotl',
  traitHint: 'Regenerates from any failure. Adorable.',
  frames: {
    idle: [
      f(' \\\\(  )//   ', '  ( {E} )  ', '   \\  /    ', '  ~|~~|~   ', '   d  b    '),
      f(' \\\\(  )//   ', '  ( {E} )  ', '   \\  / ~  ', '  ~|~~|~   ', '   d  b    '),
      f('  \\(  )/    ', '  ( {E} )  ', '   \\  /    ', '  ~|~~|~   ', '   d  b    '),
    ],
    happy: [
      f(' \\\\(  )//   ', '  ( {E} )  ', '   \\ ^/    ', '  ~|~~|~   ', '   d  b    '),
    ],
    alarm: [
      f(' !\\(  )/!   ', '  ( {E} )  ', '   \\!!/    ', '  ~|~~|~   ', '   d  b    '),
    ],
  },
};

// ─── Ghost ──────────────────────────────────────
const ghost: SpeciesDef = {
  name: 'ghost',
  label: 'Ghost',
  traitHint: 'Haunts dead code. Spooky refactorer.',
  frames: {
    idle: [
      f('   .---.    ', '  ( {E} )  ', '  |  o  |  ', '  |     |  ', '  /\\/\\/\\   '),
      f('   .---.    ', '  ( {E} )  ', '  | o   |  ', '  |     |  ', '  \\/\\/\\/   '),
      f('   .---.    ', '  ( {E} )  ', '  |   o |  ', '  |     |  ', '  /\\/\\/\\   '),
    ],
    happy: [
      f('   .---.    ', '  ( {E} )  ', '  | ^^^ |  ', '  |     |  ', '  /\\/\\/\\   '),
    ],
    alarm: [
      f('   .!!!.    ', '  ( {E} )  ', '  | !!! |  ', '  |     |  ', '  /\\/\\/\\   '),
    ],
  },
};

// ─── Robot ──────────────────────────────────────
const robot: SpeciesDef = {
  name: 'robot',
  label: 'Robot',
  traitHint: 'Logical and precise. Beep boop.',
  frames: {
    idle: [
      f('  [=====]   ', '  | {E} |  ', '  |[___]|  ', '  -|  |-   ', '  _|  |_   '),
      f('  [=====]   ', '  | {E} |  ', '  |[___]|  ', '  -|  |-   ', '  _| _|_   '),
      f('  [=====]   ', '  | {E} |  ', '  |[_._]|  ', '  -|  |-   ', '  _|  |_   '),
    ],
    happy: [
      f('  [=====]   ', '  | {E} |  ', '  |[^^^]|  ', '  -|  |-   ', '  _|  |_   '),
    ],
    alarm: [
      f('  [!!!!!]   ', '  | {E} |  ', '  |[!!!]|  ', '  -|  |-   ', '  _|  |_   '),
    ],
  },
};

// ─── Blob ───────────────────────────────────────
const blob: SpeciesDef = {
  name: 'blob',
  label: 'Blob',
  traitHint: 'Amorphous and adaptable. Goes with the flow.',
  frames: {
    idle: [
      f('            ', '   .~~.     ', '  ({E} )   ', ' (      )  ', '  `~~~~`   '),
      f('            ', '    .~~.    ', '  ( {E})   ', '  (     )  ', '  `~~~~`   '),
      f('            ', '   .~~.     ', '  ({E} )   ', ' (      )  ', '   `~~~`   '),
    ],
    happy: [
      f('            ', '   .~~.  *  ', '  ({E} )   ', ' (  ^^  )  ', '  `~~~~`   '),
    ],
    alarm: [
      f('     !!     ', '   .~~.     ', '  ({E} )   ', ' (  !!  )  ', '  `~~~~`   '),
    ],
  },
};

// ─── Cactus ─────────────────────────────────────
const cactus: SpeciesDef = {
  name: 'cactus',
  label: 'Cactus',
  traitHint: 'Prickly on the outside. Warm on the inside.',
  frames: {
    idle: [
      f('    |\\      ', '  .-|-.     ', ' |({E})|   ', ' |  ~  |   ', ' |_____|   '),
      f('    |\\      ', '  .-|-.     ', ' |({E})|   ', ' |  ~  |   ', '  |___|    '),
      f('    |\\      ', '  .-|-.     ', ' |({E})|   ', ' |  .  |   ', ' |_____|   '),
    ],
    happy: [
      f('   *|\\*     ', '  .-|-.     ', ' |({E})|   ', ' |  ^  |   ', ' |_____|   '),
    ],
    alarm: [
      f('   !|\\!     ', '  .-|-.     ', ' |({E})|   ', ' | !!! |   ', ' |_____|   '),
    ],
  },
};

// ─── Mushroom ───────────────────────────────────
const mushroom: SpeciesDef = {
  name: 'mushroom',
  label: 'Mushroom',
  traitHint: 'Grows in the dark. Thrives under pressure.',
  frames: {
    idle: [
      f('  .o.O.o.   ', ' /~~~~~~~\\  ', '   ({E})   ', '    |~|    ', '   _/ \\_   '),
      f('  .O.o.O.   ', ' /~~~~~~~\\  ', '   ({E})   ', '    |~|    ', '   _/ \\_   '),
      f('  .o.O.o.   ', ' /~~~~~~~\\  ', '   ({E})   ', '    |.|    ', '   _/ \\_   '),
    ],
    happy: [
      f('  .o.O.o.   ', ' /~~~~~~~\\  ', '   ({E})   ', '    |^|    ', '   _/ \\_   '),
    ],
    alarm: [
      f('  .!.!.!.   ', ' /~~~~~~~\\  ', '   ({E})   ', '    |!|    ', '   _/ \\_   '),
    ],
  },
};

// ─── Chonk ──────────────────────────────────────
const chonk: SpeciesDef = {
  name: 'chonk',
  label: 'Chonk',
  traitHint: 'Round and mighty. Maximum comfort.',
  frames: {
    idle: [
      f('  .------.  ', ' /  {E}  \\ ', '|  ~~~~   | ', '|         | ', ' \\______/  '),
      f('  .------.  ', ' /  {E}  \\ ', '|   ~~~~  | ', '|         | ', ' \\______/  '),
      f('  .------.  ', ' /  {E}  \\ ', '|  ~..~   | ', '|         | ', ' \\______/  '),
    ],
    happy: [
      f('  .------.  ', ' /  {E}  \\ ', '|  ^^^^   | ', '|         | ', ' \\______/  '),
    ],
    alarm: [
      f('  .!!!!!-.  ', ' /  {E}  \\ ', '|  !!!!   | ', '|         | ', ' \\______/  '),
    ],
  },
};

// ─── Capybara ───────────────────────────────────
const capybara: SpeciesDef = {
  name: 'capybara',
  label: 'Capybara',
  traitHint: 'Chill vibes. Everyone gets along with capybara.',
  frames: {
    idle: [
      f('  .---.     ', ' / {E} \\   ', ' | \\_/ |   ', ' |~~~~~|   ', '  d___b    '),
      f('  .---.     ', ' / {E} \\   ', ' | \\_/ |   ', ' |~~~~~| ~ ', '  d___b /  '),
      f('  .---.     ', ' / {E} \\   ', ' | \\./ |   ', ' |~~~~~|   ', '  d___b    '),
    ],
    happy: [
      f('  .---.     ', ' / {E} \\   ', ' | \\^/ |   ', ' |~~~~~|   ', '  d___b    '),
    ],
    alarm: [
      f('  .!!!.     ', ' / {E} \\   ', ' | \\!/ |   ', ' |~~~~~|   ', '  d___b    '),
    ],
  },
};

// ─────────────────────────────────────────────────
export const SPECIES: SpeciesDef[] = [
  duck,
  goose,
  cat,
  rabbit,
  owl,
  penguin,
  turtle,
  snail,
  dragon,
  octopus,
  axolotl,
  ghost,
  robot,
  blob,
  cactus,
  mushroom,
  chonk,
  capybara,
];

export function getSpecies(name: string): SpeciesDef {
  const found = SPECIES.find((s) => s.name === name);
  if (!found) throw new Error(`Unknown species: ${name}`);
  return found;
}

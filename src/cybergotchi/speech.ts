import type { Stat } from './types.js';
import type { CybergotchiEventType } from './events.js';

type Templates = {
  default: string[];
  snarky?: string[];   // SNARK > 70
  sage?: string[];     // WISDOM > 70
  chaotic?: string[];  // CHAOS > 70
  impatient?: string[]; // PATIENCE < 30
};

const SPEECHES: Record<CybergotchiEventType, Templates> = {
  toolError: {
    default:   ['Hmm, that didn\'t work...', 'Error? Let\'s try again!', 'Oops. Check the logs?'],
    snarky:    ['Predictable.', 'Cool error. Very cool.', 'Did you even test this?'],
    sage:      ['Every failure teaches us something.', 'Errors are just feedback.'],
    chaotic:   ['BURN IT DOWN AND REBUILD!', 'ERROR = OPPORTUNITY!!', 'Chaos reigns!'],
    impatient: ['Again?! Fix it already!', 'This is taking forever...'],
  },
  toolSuccess: {
    default:   ['Nice!', 'That worked!', 'One down!', 'Smooth.'],
    snarky:    ['About time.', 'Oh wow, it worked. Shocking.'],
    sage:      ['Progress, one step at a time.', 'Well done.'],
    chaotic:   ['IT WORKED!! AMAZING!!', 'YES YES YES!!'],
    impatient: ['Finally!', 'Took long enough.'],
  },
  longWait: {
    default:   ['Still thinking...', 'Working on it!', 'This might take a sec...'],
    snarky:    ['Oh good, more waiting.', 'Any day now...'],
    sage:      ['Patience is a virtue.', 'Good things take time.'],
    chaotic:   ['DO SOMETHING!! ANYTHING!!', 'TIME IS AN ILLUSION!'],
    impatient: ['Come ON already!', 'I\'m DYING here...'],
  },
  commit: {
    default:   ['Committed!', 'Saved to history!', 'Git it! 🎯'],
    snarky:    ['Committing mistakes to history, great.', 'Future you will love this.'],
    sage:      ['A clear commit message is a gift to the future.'],
    chaotic:   ['COMMIT EVERYTHING!! NO TESTS NEEDED!!'],
    impatient: ['Finally shipped something.'],
  },
  taskComplete: {
    default:   ['Task done!', 'Check!', 'Nailed it!', 'One more down!'],
    snarky:    ['Congrats, you did the thing.', 'Gold star, I guess.'],
    sage:      ['Completion is its own reward.', 'Well executed.'],
    chaotic:   ['DONE DONE DONE PARTY TIME!!'],
    impatient: ['Finally. Next!'],
  },
  userAddressed: {
    default:   ['Hey! I\'m here!', '*waves*', 'You called?', 'What\'s up?'],
    snarky:    ['Oh NOW you talk to me.', 'Finally acknowledged.'],
    sage:      ['Hello, friend.', 'How can I help?'],
    chaotic:   ['HIIII YES HELLO I AM HERE!!', 'You\'re my favorite human!!'],
    impatient: ['Yes yes, what is it?'],
  },
  idle: {
    default:   ['...', '*yawns*', 'la la la...', '*stares into the void*'],
    snarky:    ['Still here. Waiting.', 'Bored now.'],
    sage:      ['In stillness, clarity.', '*meditates*'],
    chaotic:   ['*vibrates intensely*', 'I CONTAIN MULTITUDES'],
    impatient: ['Let\'s GO already!', 'Hurry up!'],
  },
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

const TOOL_QUIPS: Record<string, string[]> = {
  BashTool:      ['ooh shell time!', 'running commands...', 'bash go brrr'],
  FileWriteTool: ['writing to disk...', 'saving the work!', 'persisting...'],
  FileEditTool:  ['editing a file!', 'making changes...', 'diff time!'],
  GlobTool:      ['searching files...', 'globbing away!', 'finding stuff...'],
  GrepTool:      ['grepping...', 'scanning content!', 'pattern match!'],
  WebFetchTool:  ['going online!', 'fetching the web!', 'http request!'],
  WebSearchTool: ['googling it!', 'searching the web!', 'looking it up!'],
};

export function getSpeech(
  eventType: CybergotchiEventType,
  stats: Record<Stat, number>,
  toolName?: string,
): string {
  // Tool-specific quips for successful tool calls
  if (eventType === 'toolSuccess' && toolName && TOOL_QUIPS[toolName]) {
    return pick(TOOL_QUIPS[toolName]!);
  }

  const templates = SPEECHES[eventType];

  if (stats.CHAOS > 70 && templates.chaotic) return pick(templates.chaotic);
  if (stats.SNARK > 70 && templates.snarky) return pick(templates.snarky);
  if (stats.WISDOM > 70 && templates.sage) return pick(templates.sage);
  if (stats.PATIENCE < 30 && templates.impatient) return pick(templates.impatient);
  return pick(templates.default);
}

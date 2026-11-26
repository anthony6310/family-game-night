import type { SoundFn } from './snowSounds';
import type { BedFn } from './spatialAudio';
import { clockTick, clockTock, drawChime, siren, victoryFanfare, whistle } from './gameSounds';
import { bagFull, iceCarve, icyWind, iglooFanfare } from './penguinSounds';
import { captureChime } from './iceSounds';
import { birdFlaps, birdHit, crevasseWind, goatFall, goatJump, goatLand, pointDing, sweepHum } from './goatSounds';
import { bigExplosion, bigSplash, fishPile, reelRatchet, reelZing, whipSwish } from './fishingSounds';
import { blizzardWind, paddedThump, powderSwish, risingZip } from './snowballSounds';
import { boingHop, leafDash, rubberStretch, rubberySlip, sproingDrop, triumphJingle } from './frogSounds';
import { crystalDing, descendingBlips, gloveSqueak } from './flakeSounds';
import { giftGrab, giftIn, giftMiss, giftToss } from './santaSounds';
import { bubblingPoison, crunchySquelch, glassCrash, heartbeat, kitchenHum, nibbleCrunch, sandalWhipSmack, sandalWhoosh, tinyTwitches } from './roachRumbleSounds';
import { cannonBoom, hitReceived, readyClang, reloadChain, seaAmbience, seaSplash, shipHit, whaleBlocked, whaleRumble, whaleSplash, whaleSpout, wickBurn, wickLight } from './pirateSounds';
import { comicSplat, heave, massiveHeave, ropeStretch } from './tugSounds';
import { labBuzz, relayClick } from './tapSounds';
import { adoptedArpeggio, deskBell, footstep, glowHum, joyWhoop, padChime, plop, scoopUp, scurry, uhOh } from './zooSounds';

/**
 * THE MIXER TABLE: how loud each sound is, as a multiplier of the volume the game code gives it (1 = as the game plays it, 0.5 = half, 2 = double).
 * The audio engine (`audio.play`, `audio.playFlat`, `audio.startBed` in spatialAudio.ts) looks every sound up here, so a game's code never
 * needs to know about it. The numbers were set by ear on the volume mixer page (one slider per sound, with a sample of each game at the pace
 * of its real sounds). To add a sound, list it in `ENTRIES` (its game, its name, the sound); a sound that is not listed plays at 1.
 * `theme` is the game's theme music (`useGameTheme`), `seaAmbience`-style names are the looping beds.
 */
export const MIX_LEVELS: Record<string, Record<string, number>> = {
  'pirate-broadside': { wickLight: 1, wickBurn: 1.55, cannonBoom: 2, reloadChain: 1.35, readyClang: 1.6, shipHit: 1.65, hitReceived: 2, seaSplash: 0.7, whaleBlocked: 2, whaleRumble: 2, whaleSpout: 0.65, whaleSplash: 2, seaAmbience: 0.5, theme: 0.55 },
  'mountain-goat': { goatJump: 1.75, sweepHum: 1, goatLand: 2, pointDing: 2, goatFall: 1.55, birdHit: 2, birdFlaps: 1.25, crevasseWind: 0.7, theme: 0.6 },
  'adoption-day': { footstep: 0.4, glowHum: 0.35, scoopUp: 1.3, plop: 1.3, padChime: 1, adoptedArpeggio: 1.6, joyWhoop: 1.8, uhOh: 1.95, scurry: 0.7, deskBell: 0.25, theme: 1 },
  'tap-race': { relayClick: 1.2, labBuzz: 0.4, theme: 0.8 },
  'tug-of-war': { heave: 0.55, ropeStretch: 1.2, massiveHeave: 2, comicSplat: 2, theme: 0.45 },
  snowball: { powderSwish: 1.45, paddedThump: 2, risingZip: 1.8, blizzardWind: 0.6, theme: 0.55 },
  'penguin-lasso': { iceCarve: 0.8, captureChime: 1.35, bagFull: 1.95, iglooFanfare: 1.55, icyWind: 0.6, theme: 0.65 },
  fishing: { whipSwish: 1.3, bigSplash: 1.2, reelZing: 1.15, bigExplosion: 1.8, reelRatchet: 1.55, fishPile: 1.55, theme: 1.1 },
  'santa-sack': { giftToss: 1.4, giftIn: 0.85, giftMiss: 0.75, giftGrab: 1.8, theme: 0.65 },
  'snowflake-match': { crystalDing: 1.25, descendingBlips: 1.65, gloveSqueak: 1.2, theme: 0.75 },
  'roach-hunt': { sandalWhoosh: 1.9, sandalWhipSmack: 2, crunchySquelch: 2, tinyTwitches: 1.35, glassCrash: 1.75, nibbleCrunch: 1.2, bubblingPoison: 1.45, heartbeat: 1.7, kitchenHum: 0.85, theme: 0.7 },
  'frog-climb': { boingHop: 0.9, leafDash: 1, rubberStretch: 2, sproingDrop: 1.45, rubberySlip: 1.85, triumphJingle: 1.5, theme: 0.55 },
  shared: { clockTick: 1.5, clockTock: 1, whistle: 0.05, victoryFanfare: 0.2, drawChime: 0.75, siren: 0.2 },
};

type Sound = SoundFn | BedFn;
/** Every sound the mixer knows: [game, name in MIX_LEVELS, the sound]. */
const ENTRIES: [string, string, Sound][] = [
  ['pirate-broadside', 'wickLight', wickLight], ['pirate-broadside', 'wickBurn', wickBurn], ['pirate-broadside', 'cannonBoom', cannonBoom], ['pirate-broadside', 'reloadChain', reloadChain],
  ['pirate-broadside', 'readyClang', readyClang], ['pirate-broadside', 'shipHit', shipHit], ['pirate-broadside', 'hitReceived', hitReceived], ['pirate-broadside', 'seaSplash', seaSplash],
  ['pirate-broadside', 'whaleBlocked', whaleBlocked], ['pirate-broadside', 'whaleRumble', whaleRumble], ['pirate-broadside', 'whaleSpout', whaleSpout], ['pirate-broadside', 'whaleSplash', whaleSplash],
  ['pirate-broadside', 'seaAmbience', seaAmbience],
  ['mountain-goat', 'goatJump', goatJump], ['mountain-goat', 'sweepHum', sweepHum], ['mountain-goat', 'goatLand', goatLand], ['mountain-goat', 'pointDing', pointDing],
  ['mountain-goat', 'goatFall', goatFall], ['mountain-goat', 'birdHit', birdHit], ['mountain-goat', 'birdFlaps', birdFlaps], ['mountain-goat', 'crevasseWind', crevasseWind],
  ['adoption-day', 'footstep', footstep], ['adoption-day', 'glowHum', glowHum], ['adoption-day', 'scoopUp', scoopUp], ['adoption-day', 'plop', plop], ['adoption-day', 'padChime', padChime],
  ['adoption-day', 'adoptedArpeggio', adoptedArpeggio], ['adoption-day', 'joyWhoop', joyWhoop], ['adoption-day', 'uhOh', uhOh], ['adoption-day', 'scurry', scurry], ['adoption-day', 'deskBell', deskBell],
  ['tap-race', 'relayClick', relayClick], ['tap-race', 'labBuzz', labBuzz],
  ['tug-of-war', 'heave', heave], ['tug-of-war', 'ropeStretch', ropeStretch], ['tug-of-war', 'massiveHeave', massiveHeave], ['tug-of-war', 'comicSplat', comicSplat],
  ['snowball', 'powderSwish', powderSwish], ['snowball', 'paddedThump', paddedThump], ['snowball', 'risingZip', risingZip], ['snowball', 'blizzardWind', blizzardWind],
  ['penguin-lasso', 'iceCarve', iceCarve], ['penguin-lasso', 'captureChime', captureChime], ['penguin-lasso', 'bagFull', bagFull], ['penguin-lasso', 'iglooFanfare', iglooFanfare], ['penguin-lasso', 'icyWind', icyWind],
  ['fishing', 'whipSwish', whipSwish], ['fishing', 'bigSplash', bigSplash], ['fishing', 'reelZing', reelZing], ['fishing', 'bigExplosion', bigExplosion], ['fishing', 'reelRatchet', reelRatchet], ['fishing', 'fishPile', fishPile],
  ['santa-sack', 'giftToss', giftToss], ['santa-sack', 'giftIn', giftIn], ['santa-sack', 'giftMiss', giftMiss], ['santa-sack', 'giftGrab', giftGrab],
  ['snowflake-match', 'crystalDing', crystalDing], ['snowflake-match', 'descendingBlips', descendingBlips], ['snowflake-match', 'gloveSqueak', gloveSqueak],
  ['roach-hunt', 'sandalWhoosh', sandalWhoosh], ['roach-hunt', 'sandalWhipSmack', sandalWhipSmack], ['roach-hunt', 'crunchySquelch', crunchySquelch], ['roach-hunt', 'tinyTwitches', tinyTwitches],
  ['roach-hunt', 'glassCrash', glassCrash], ['roach-hunt', 'nibbleCrunch', nibbleCrunch], ['roach-hunt', 'bubblingPoison', bubblingPoison], ['roach-hunt', 'heartbeat', heartbeat],
  ['roach-hunt', 'kitchenHum', kitchenHum],
  ['frog-climb', 'boingHop', boingHop], ['frog-climb', 'leafDash', leafDash], ['frog-climb', 'rubberStretch', rubberStretch], ['frog-climb', 'sproingDrop', sproingDrop],
  ['frog-climb', 'rubberySlip', rubberySlip], ['frog-climb', 'triumphJingle', triumphJingle],
  ['shared', 'clockTick', clockTick], ['shared', 'clockTock', clockTock], ['shared', 'whistle', whistle], ['shared', 'victoryFanfare', victoryFanfare], ['shared', 'drawChime', drawChime], ['shared', 'siren', siren],
];

const byFunction = new Map<Sound, [string, string]>(ENTRIES.map(([game, name, fn]) => [fn, [game, name]]));

/** The mixer multiplier for a sound (or loop): 1 for anything not listed. */
export function levelOf(sound: Sound): number {
  const found = byFunction.get(sound);
  return found ? MIX_LEVELS[found[0]]?.[found[1]] ?? 1 : 1;
}

/** The mixer multiplier for a game's theme music. */
export function themeLevel(gameId: string): number {
  return MIX_LEVELS[gameId]?.theme ?? 1;
}

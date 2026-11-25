// Manon — planches Gemini (novembre 2026), 4 colonnes x 3 rangées, bustes sur fond noir (liseré blanc).
// Ordre de lecture : joie colère pleurs boude / réflexion dodo bisou clin d'œil / surprise, amoureux, cool, champion (= gamer).
// Planche « racer » : fond blanc. grid : planches serrées (liserés soudés) -> un noyau par case ; cinema : noyaux plus grands (le liseré fuit dans un sticker).
// santa : stickers soudés en bas (renne/pompon), découpé une fois avec { tol: 8 } (grille) puis bouts voisins gommés à la main dans surprise et amoureux : hors de sheets pour ne pas être écrasé.
// cowboy : découpé par closed-sheet.mjs (sticker « joie » délavé par free-sheet), hors de sheets.
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
const S = (name, dir = name) => ({ name, file: `manon-${name}.png`, n: 12, dir, map: MAP, white: name === 'racer', split: name === 'racer' ? false : 'grid', pockets: name !== 'racer' });
const OVERRIDE = { cinema: { split: 0.36, pockets: false }, racer: { tol: 40, open: 2 }, elf: { tol: 8, split: false, pockets: false } };
export default {
  slug: 'manon',
  src: 'assets-source/costumes/manon-v3',
  sheets: 'tycoon admiral tictactoe strategist coach actor archer cinema philosopher bowler pirate pyro werewolf painter student teacher croupier spy star racer hacker chess golfer host elf'.split(' ').map((n) => ({ ...S(n), ...(OVERRIDE[n] ?? {}) })),
  portraits: 'tycoon admiral tictactoe strategist coach actor archer cinema philosopher bowler pirate pyro werewolf painter student teacher croupier spy star racer hacker chess golfer host cowboy elf santa'.split(' ').map((n) => ({ file: `manon-${n}-portrait.png`, dir: n, cutout: true })),
};

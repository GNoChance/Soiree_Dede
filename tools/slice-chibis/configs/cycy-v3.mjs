// Cycy — planches Gemini (novembre 2026), 4 colonnes x 3 rangées, bustes sur fond noir (liseré blanc).
// Ordre de lecture : joie colère pleurs boude / réflexion dodo bisou clin d'œil / surprise, amoureux, cool, champion (= gamer).
// Planche « racer » : fond blanc. grid : planches serrées (liserés soudés) -> un noyau par case.
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
const S = (name, dir = name) => ({ name, file: `cycy-${name}.png`, n: 12, dir, map: MAP, white: name === 'racer', split: name === 'racer' ? false : 'grid', pockets: name !== 'racer' });
// tycoon : noyaux plus grands (le liseré du sticker voisin le coupait)
const OV = { tycoon: { split: 0.32 } };
const NAMES = 'star spy croupier teacher pyro pirate bowler philosopher cinema archer actor coach strategist tycoon tictactoe admiral werewolf painter student racer'.split(' ');
export default {
  slug: 'cycy',
  src: 'assets-source/costumes/cycy-v3',
  sheets: NAMES.map((n) => ({ ...S(n), ...(OV[n] ?? {}) })),
  portraits: NAMES.map((n) => ({ file: `cycy-${n}-portrait.png`, dir: n, cutout: true })),
};

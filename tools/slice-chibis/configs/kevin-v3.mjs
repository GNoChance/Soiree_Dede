// Kevin (Keke) — planches V3 (novembre 2026), 4 colonnes x 3 rangées, bustes sur fond noir (liseré blanc).
// Ordre de lecture : joie colère pleurs boude / réflexion dodo bisou clin d'œil / surprise, amoureux, cool, champion (= gamer).
// Pas de planche V3 pour cinema, spy, croupier, strategist (restent en V2, cf. kevin-v2.mjs). racer : fond blanc.
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
// pyro, tictactoe : liserés soudés / décors détachés -> découpe en grille.
const GRID = ['pyro', 'tictactoe'];
const S = (name) => ({ name, file: `kevin-${name}.png`, n: 12, dir: name, map: MAP, white: name === 'racer', tol: 24, ...(GRID.includes(name) ? { split: 'grid', pockets: true } : {}) });
export default {
  slug: 'kevin',
  src: 'assets-source/costumes/kevin-v3',
  sheets: 'student star coach philosopher archer painter pyro tycoon actor bowler admiral werewolf pirate teacher tictactoe racer'.split(' ').map(S),
  portraits: 'admiral archer coach actor student croupier spy bowler werewolf tycoon tictactoe pyro painter philosopher pirate teacher cinema strategist star racer'.split(' ').map((n) => ({ file: `kevin-${n}-portrait.png`, dir: n, cutout: true })),
};

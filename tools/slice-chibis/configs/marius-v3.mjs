// Marius — planches V3 (novembre 2026), 4 colonnes x 3 rangées, bustes sur fond noir (liseré blanc).
// Ordre de lecture : joie colère pleurs boude / réflexion dodo bisou clin d'œil / surprise, amoureux, cool, champion (= gamer).
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
// Stickers serrés (liserés qui se touchent) -> découpe en grille.
const GRID = ['tictactoe', 'archer', 'werewolf', 'painter'];
// painter : sans « pockets » (sinon le contour noir du dessin est pris pour du fond).
// strategist : liserés soudés partout -> séparation par érosion (la grille mélange les cases).
const ERODE = ['strategist'];
const S = (name) => ({ name, file: `marius-${name}.png`, n: 12, dir: name, map: MAP, white: name === 'racer', tol: 24, ...(GRID.includes(name) ? { split: 'grid', pockets: name !== 'painter' } : {}), ...(ERODE.includes(name) ? { split: true } : {}) });
export default {
  slug: 'marius',
  src: 'assets-source/costumes/marius-v3',
  sheets: 'admiral tycoon tictactoe coach strategist actor archer cinema philosopher bowler pirate pyro werewolf painter student teacher croupier spy star racer'.split(' ').map(S),
  portraits: 'painter student teacher croupier spy star strategist racer'.split(' ').map((n) => ({ file: `marius-${n}-portrait.png`, dir: n, cutout: true })),
};

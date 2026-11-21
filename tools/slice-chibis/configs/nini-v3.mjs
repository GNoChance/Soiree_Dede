// Nini — planches V3 (novembre 2026), 4 colonnes x 3 rangées, bustes sur fond noir (liseré blanc).
// Ordre de lecture : joie colère pleurs boude / réflexion dodo bisou clin d'œil / surprise, amoureux, cool, champion (= gamer).
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
// Stickers serrés (liserés qui se touchent) -> découpe en grille.
const GRID = ['pirate', 'archer', 'cinema', 'golfer'];
const S = (name) => ({ name, file: `nini-${name}.png`, n: 12, dir: name, map: MAP, white: name === 'racer', tol: 24, ...(GRID.includes(name) ? { split: 'grid', pockets: true } : {}) });
export default {
  slug: 'nini',
  src: 'assets-source/costumes/nini-v3',
  sheets: 'star spy croupier teacher student painter werewolf pyro pirate philosopher tictactoe coach strategist actor archer cinema tycoon admiral bowler racer hacker chess golfer host cowboy elf'.split(' ').map(S),
  portraits: 'racer archer actor coach tictactoe admiral tycoon strategist cinema philosopher bowler pirate pyro werewolf painter student teacher croupier spy star hacker cowboy host chess golfer elf'.split(' ').map((n) => ({ file: `nini-${n}-portrait.png`, dir: n, cutout: true })),
};

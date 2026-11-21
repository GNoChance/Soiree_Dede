// Cécile — planches V3 (novembre 2026), 4 colonnes x 3 rangées, bustes sur fond noir (liseré blanc).
// Ordre de lecture : joie colère pleurs boude / réflexion dodo bisou clin d'œil / surprise, amoureux, cool, champion (= gamer).
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
// Stickers serrés (liserés qui se touchent) -> découpe en grille .
const GRID = ['strategist', 'actor', 'philosopher', 'bowler', 'pirate', 'painter', 'hacker', 'host'];
// admiral : même la grille mélange des cases -> découpe case par case (12 zones d'un seul sticker).
const CELLS = (name, W = 1448, H = 1086) => MAP.map((e, i) => {
  const c = i % 4, r = Math.floor(i / 4), cw = W / 4, ch = H / 3;
  return { name: `${name}${i}`, file: `cecile-${name}.png`, n: 1, dir: name, map: [e], white: false, tol: 24,
    region: [Math.round(c * cw), Math.round(r * ch), Math.round((c + 1) * cw), Math.round((r + 1) * ch)] };
});
const S = (name) => ({ name, file: `cecile-${name}.png`, n: 12, dir: name, map: MAP, white: name === 'racer', tol: name === 'elf' ? 8 : 24, ...(GRID.includes(name) ? { split: 'grid', pockets: true } : {}) });
export default {
  slug: 'cecile',
  src: 'assets-source/costumes/cecile-v3',
  sheets: 'tycoon admiral tictactoe coach strategist actor archer cinema philosopher bowler pirate pyro werewolf painter student teacher croupier spy star racer hacker chess golfer host cowboy elf'.split(' ').flatMap((n) => (n === 'admiral' ? CELLS(n) : [S(n)])),
  portraits: 'tycoon admiral tictactoe coach actor archer cinema philosopher bowler pirate pyro werewolf star spy croupier teacher student painter strategist racer hacker chess host cowboy golfer elf'.split(' ').map((n) => ({ file: `cecile-${n}-portrait.png`, dir: n, cutout: true })),
};

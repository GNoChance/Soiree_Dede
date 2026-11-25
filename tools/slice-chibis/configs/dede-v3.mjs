// Dédé — planches V3 (novembre 2026), 4 colonnes x 3 rangées, bustes sur fond noir (liseré blanc) ; racer : fond blanc.
// Ordre de lecture : joie colère pleurs boude / réflexion dodo bisou clin d'œil / surprise, amoureux, cool, champion (= gamer).
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
// cowboy : découpé avec closed-sheet.mjs (liseré ouvert sur « amoureux »), volontairement absent de sheets.
// Stickers serrés (liserés qui se touchent) -> découpe en grille.
const GRID = ['teacher', 'bowler', 'cinema', 'archer', 'actor', 'strategist', 'admiral'];
const S = (name) => ({ name, file: `dede-${name}.png`, n: 12, dir: name, map: MAP, white: name === 'racer', tol: name === 'elf' ? 8 : 24, ...(GRID.includes(name) ? { split: 'grid', pockets: true } : {}) });
export default {
  slug: 'dede',
  src: 'assets-source/costumes/dede-v3',
  sheets: 'star spy croupier teacher student painter werewolf pyro pirate bowler philosopher cinema archer actor coach strategist tictactoe admiral racer tycoon hacker chess golfer host elf santa'.split(' ').map(S),
  portraits: 'tycoon admiral tictactoe coach actor archer pyro pirate bowler painter cinema werewolf philosopher student spy teacher croupier star racer strategist hacker chess golfer host cowboy elf santa'.split(' ').map((n) => ({ file: `dede-${n}-portrait.png`, dir: n, cutout: true })),
};

// Cycy 2 (Cyrielle, copine de Nini) — planches V3 (novembre 2026), 4 colonnes x 3 rangées, bustes sur fond noir (liseré blanc).
// Ordre de lecture : joie colère pleurs boude / réflexion dodo bisou clin d'œil / surprise, amoureux, cool, champion (= gamer).
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
const OV = { werewolf: { split: 'grid', pockets: true } };
const S = (name) => ({ name, file: `cycy2-${name}.png`, n: 12, dir: name, map: MAP, white: false, tol: 24, ...(OV[name] ?? {}) });
const SHEETS = 'star spy croupier teacher student painter werewolf pyro pirate bowler philosopher cinema archer actor coach strategist tictactoe admiral tycoon hacker chess cowboy golfer host irma elf santa'.split(' ');
export default {
  slug: 'cycy2',
  src: 'assets-source/costumes/cycy2-v3',
  sheets: SHEETS.map(S),
  portraits: SHEETS.filter((n) => n !== 'irma').map((n) => ({ file: `cycy2-${n}-portrait.png`, dir: n, cutout: true })),
};

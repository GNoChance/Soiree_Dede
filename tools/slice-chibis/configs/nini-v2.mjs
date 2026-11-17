// Nini — planches ChatGPT (novembre 2026). Ordre standard (4x3) sauf mention ; '-' = absent (écarté), extraN = sticker bonus.
const E = (s) => s.split(' ').map((x) => (x === '-' ? null : x));
const STD = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces timide determine';
const OLD = 'joie timide colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces determine';
const NEW = 'tictactoe spy croupier teacher student painter werewolf pyro admiral archer actor coach'.split(' ');
const SPECIAL = {
  actor: STD.replace(/determine$/, 'extra1'),
  coach: STD.replace(/determine$/, 'extra1'),
};
const PH = { file: 'nini-philosopher-combo.png', n: 4, dir: 'philosopher', white: false, tol: 40 };
export default {
  slug: 'nini',
  src: 'assets-source/costumes/nini-v2',
  sheets: [
    { name: 'bowler', file: 'nini-bowler.png', n: 12, dir: 'bowler', map: E(OLD) },
    { name: 'strategist', file: 'nini-strategist-combo.png', region: [0, 0, 1254, 708], n: 12, dir: 'strategist', map: E('joie clin_oeil reflexion surprise colere pleurs dodo bisou determine pouces boude timide') },
    { name: 'tycoon', file: 'nini-tycoon.png', n: 12, dir: 'tycoon', map: E('joie clin_oeil reflexion surprise colere pouces dodo timide determine - boude -') },
    { name: 'star', file: 'nini-star.png', n: 12, dir: 'star', map: E('joie clin_oeil boude surprise timide bisou determine - pouces dodo pleurs -') },
    { name: 'pirate', file: 'nini-pirate.png', n: 12, dir: 'pirate', map: E(OLD) },
    { ...PH, name: 'philosopher1', region: [0, 0, 1254, 217], map: E('joie pouces clin_oeil colere') },
    { ...PH, name: 'philosopher2', region: [0, 221, 1254, 442], map: E('pleurs boude reflexion dodo') },
    { ...PH, name: 'philosopher3', region: [0, 446, 1254, 679], map: E('bisou surprise determine timide') },
    { name: 'cinema', file: 'nini-cinema.png', n: 12, dir: 'cinema', map: E('determine joie colere bisou pouces pleurs reflexion dodo surprise clin_oeil timide boude') },
    ...NEW.map((dir) => ({ name: dir, file: `nini-${dir}.png`, n: 12, dir, map: E(SPECIAL[dir] ?? STD) })),
  ],
  portraits: [
    { file: 'nini-bowler-portrait.png', dir: 'bowler' },
    { file: 'nini-strategist-combo.png', crop: [150, 714, 870, 1254], dir: 'strategist' },
    { file: 'nini-tycoon-portrait.png', dir: 'tycoon' },
    { file: 'nini-star-portrait.png', dir: 'star' },
    { file: 'nini-pirate-portrait.png', dir: 'pirate' },
    { file: 'nini-philosopher-combo.png', crop: [240, 684, 960, 1254], dir: 'philosopher' },
    { file: 'nini-cinema-portrait.png', dir: 'cinema' },
    { file: 'nini-admiral-portrait.png', dir: 'admiral' },
    { file: 'nini-tictactoe-portrait.png', dir: 'tictactoe', cutout: true },
    { file: 'nini-spy-portrait.png', dir: 'spy' },
    { file: 'nini-croupier-portrait.png', dir: 'croupier' },
  ],
};

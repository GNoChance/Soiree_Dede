// Nini — planches ChatGPT (novembre 2026). map[i] = expression du i-ème sticker (ordre de lecture, voir out-check/<nom>-idx.png).
// Les expressions absentes d'une planche sont écartées automatiquement (gen-art -> TENUE_ART_BAD, repli sur une voisine).
const E = (s) => s.split(' ').map((x) => (x === '-' ? null : x));
const COLS = [[5, 290], [298, 560], [570, 814], [820, 1066], [1072, 1312], [1317, 1530]];
const col = (k) => [COLS[k][0] + 2, 326, COLS[k][1] - 2, 758];
const PH = { file: 'nini-philosopher-combo.png', n: 4, dir: 'philosopher', white: false, tol: 40 };
export default {
  slug: 'nini',
  src: 'assets-source/costumes/nini-v2',
  sheets: [
    { name: 'bowler', file: 'nini-bowler.png', n: 12, dir: 'bowler', map: E('joie timide colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces determine') },
    { name: 'strategist', file: 'nini-strategist-combo.png', region: [0, 0, 1254, 708], n: 12, dir: 'strategist', map: E('joie clin_oeil reflexion surprise colere pleurs dodo bisou determine pouces boude timide') },
    { name: 'tictactoe', file: 'nini-tictactoe.png', n: 12, dir: 'tictactoe', map: E('joie clin_oeil reflexion surprise colere pleurs dodo bisou timide pouces boude determine') },
    { name: 'admiral', file: 'nini-admiral.png', n: 12, dir: 'admiral', map: E('joie clin_oeil reflexion surprise colere pouces boude bisou determine - timide -') },
    { name: 'tycoon', file: 'nini-tycoon.png', n: 12, dir: 'tycoon', map: E('joie clin_oeil reflexion surprise colere pouces dodo timide determine - boude -') },
    { name: 'star', file: 'nini-star.png', n: 12, dir: 'star', map: E('joie clin_oeil boude surprise timide bisou determine - pouces dodo pleurs -') },
    { name: 'pirate', file: 'nini-pirate.png', n: 12, dir: 'pirate', map: E('joie timide colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces determine') },
    { ...PH, name: 'philosopher1', region: [0, 0, 1254, 217], map: E('joie pouces clin_oeil colere') },
    { ...PH, name: 'philosopher2', region: [0, 221, 1254, 442], map: E('pleurs boude reflexion dodo') },
    { ...PH, name: 'philosopher3', region: [0, 446, 1254, 679], map: E('bisou surprise determine timide') },
    { name: 'cinema', file: 'nini-cinema.png', n: 12, dir: 'cinema', map: E('determine joie colere bisou pouces pleurs reflexion dodo surprise clin_oeil timide boude') },
    { name: 'spy', file: 'nini-collage.png', region: col(0), n: 12, dir: 'spy', map: E('determine timide surprise - joie pouces boude clin_oeil colere reflexion pleurs dodo') },
    { name: 'croupier', file: 'nini-collage.png', region: col(1), n: 12, dir: 'croupier', map: E('determine joie bisou clin_oeil timide reflexion - pouces colere pleurs boude dodo') },
    { name: 'teacher', file: 'nini-collage.png', region: col(2), n: 12, dir: 'teacher', map: E('pouces reflexion determine joie clin_oeil surprise - timide - dodo colere boude') },
    { name: 'student', file: 'nini-collage.png', region: col(3), n: 12, dir: 'student', map: E('- joie pleurs - surprise reflexion boude determine timide dodo - pouces') },
    { name: 'painter', file: 'nini-collage.png', region: col(4), n: 12, dir: 'painter', map: E('joie bisou - - - - surprise - pleurs pouces dodo determine') },
    { name: 'werewolf', file: 'nini-collage.png', region: col(5), n: 12, dir: 'werewolf', map: E('bisou timide joie - surprise pleurs pouces clin_oeil - colere determine -') },
  ],
  portraits: [
    { file: 'nini-bowler-portrait.png', dir: 'bowler' },
    { file: 'nini-strategist-combo.png', crop: [150, 714, 870, 1254], dir: 'strategist' },
    { file: 'nini-tictactoe-portrait.png', dir: 'tictactoe' },
    { file: 'nini-admiral-portrait.png', dir: 'admiral' },
    { file: 'nini-tycoon-portrait.png', dir: 'tycoon' },
    { file: 'nini-star-portrait.png', dir: 'star' },
    { file: 'nini-pirate-portrait.png', dir: 'pirate' },
    { file: 'nini-philosopher-combo.png', crop: [240, 684, 960, 1254], dir: 'philosopher' },
    { file: 'nini-cinema-portrait.png', dir: 'cinema' },
    ...['spy', 'croupier', 'teacher', 'student', 'painter', 'werewolf'].map((dir, k) => ({ file: 'nini-collage.png', crop: [COLS[k][0], 0, COLS[k][1], 320], dir })),
  ],
};

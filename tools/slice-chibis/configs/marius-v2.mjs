// Marius — planches ChatGPT (novembre 2026), 3 colonnes x 4 rangées.
// Ordre type : shaka, joie, colère, pleurs, réflexion, dodo, bisou, surprise, pouces, victoire, thème, thème.
const E = (s) => s.split(' ').map((x) => (x === '-' ? null : x.includes('+') ? x.split('+') : x));
// Les 2 stickers « thème » hors liste deviennent extra1 / extra2 (stickers bonus de la tenue, cf. src/data/tenue-extras.ts).
const bonus = (m) => { let k = 0; return m.split(' ').map((x) => (x === '-' ? `extra${++k}` : x)).join(' '); };
const std = (det) => E(`clin_oeil joie colere+boude pleurs reflexion dodo bisou surprise pouces ${bonus(det)}`);
// Planches « complètes » (2e lot) : joie colère pleurs / boude réflexion dodo / bisou clin d'œil surprise / pouces timide déterminé.
const FULL = E('joie colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces timide determine');
const F = (name) => ({ name, file: `marius-${name}.png`, n: 12, dir: name, map: FULL });
const S = (name, det) => ({ name, file: `marius-${name}.png`, n: 12, dir: name, map: std(det) });
export default {
  slug: 'marius',
  src: 'assets-source/costumes/marius-v2',
  sheets: [
    S('admiral', '- - determine'),
    S('tycoon', '- determine -'),
    { name: 'star', file: 'marius-star.png', n: 12, dir: 'star', map: E('joie timide extra1 colere+boude pleurs reflexion dodo bisou surprise clin_oeil+pouces extra2 determine') },
    S('spy', '- determine -'),
    S('croupier', '- - determine'),
    S('teacher', 'determine - -'),
    S('student', '- determine -'),
    S('painter', '- determine -'),
    S('werewolf', 'determine - -'),
    S('pyro', '- - determine'),
    F('tictactoe'),
    F('pirate'),
    F('philosopher'),
    F('archer'),
    F('actor'),
    F('coach'),
    F('bowler'),
    F('strategist'),
    F('cinema'),
    // Pilote (nouveau style, fond blanc) : ordre standard avec amoureux / cool / champion (= gamer)
    { name: 'racer', file: 'marius-racer.png', n: 12, dir: 'racer', white: true, map: E('joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer') },
  ],
  // Portraits : scènes carrées avec décor (pas de détourage) ou stickers sur fond noir (cutout)
  portraits: [
    { file: 'marius-bowler-portrait.png', dir: 'bowler' },
    { file: 'marius-strategist-portrait.png', dir: 'strategist' },
    { file: 'marius-tictactoe-portrait.png', dir: 'tictactoe' },
    ...'admiral tycoon star cinema spy croupier teacher student painter'.split(' ').map((n) => ({ file: `marius-${n}-portrait.png`, dir: n })),
    ...'werewolf pyro pirate philosopher archer actor coach racer'.split(' ').map((n) => ({ file: `marius-${n}-portrait.png`, dir: n, cutout: true })),
  ],
};

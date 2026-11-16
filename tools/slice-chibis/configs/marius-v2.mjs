// Marius — planches ChatGPT (novembre 2026), 3 colonnes x 4 rangées.
// Ordre type : shaka, joie, colère, pleurs, réflexion, dodo, bisou, surprise, pouces, victoire, thème, thème.
const E = (s) => s.split(' ').map((x) => (x === '-' ? null : x.includes('+') ? x.split('+') : x));
const std = (det) => E(`clin_oeil joie colere+boude pleurs reflexion dodo bisou surprise pouces ${det}`);
const S = (name, det) => ({ name, file: `marius-${name}.png`, n: 12, dir: name, map: std(det) });
export default {
  slug: 'marius',
  src: 'assets-source/costumes/marius-v2',
  sheets: [
    S('admiral', '- - determine'),
    S('tycoon', '- determine -'),
    { name: 'star', file: 'marius-star.png', n: 12, dir: 'star', map: E('joie timide - colere+boude pleurs reflexion dodo bisou surprise clin_oeil+pouces - determine') },
    S('spy', '- determine -'),
    S('croupier', '- - determine'),
    S('teacher', 'determine - -'),
    S('student', '- determine -'),
    S('painter', '- determine -'),
    S('werewolf', 'determine - -'),
    S('pyro', '- - determine'),
  ],
  portraits: [],
};

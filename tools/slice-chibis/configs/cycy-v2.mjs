// Cycy — planches ChatGPT (novembre 2026), 3 colonnes x 4 rangées, ordre complet :
// joie colère pleurs / boude réflexion dodo / bisou clin d'œil surprise / pouces timide déterminé.
const FULL = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces timide determine'.split(' ');
const F = (name, dir = name) => ({ name, file: `cycy-${name}.png`, n: 12, dir, map: FULL });
export default {
  slug: 'cycy',
  src: 'assets-source/costumes/cycy-v2',
  sheets: ['bowler', 'strategist', 'tictactoe', 'admiral', 'tycoon', 'star', 'cinema', 'spy', 'croupier', 'painter', 'werewolf', 'pyro'].map((n) => F(n)).concat([F('gown', 'actor'), F('sweater', 'teacher'), F('beanie', 'student')]),
  portraits: [],
};

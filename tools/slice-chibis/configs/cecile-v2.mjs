// Cécile — planches ChatGPT (novembre 2026), 3 colonnes x 4 rangées, ordre complet.
const FULL = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces timide determine'.split(' ');
const F = (name, dir = name) => ({ name, file: `cecile-${name}.png`, n: 12, dir, map: FULL });
export default {
  slug: 'cecile',
  src: 'assets-source/costumes/cecile-v2',
  sheets: ['bowler', 'strategist', 'tictactoe', 'tycoon', 'star', 'cinema', 'croupier', 'spy', 'teacher', 'painter', 'werewolf', 'pyro', 'philosopher'].map((n) => (n === 'admiral' ? { ...F(n), white: false, tol: 3, open: 2 } : F(n))),
  // admiral : haut de casquette sans contour, fusionne avec le liseré blanc -> à régénérer.
  portraits: [],
};

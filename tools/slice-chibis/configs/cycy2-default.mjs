// Cycy 2 (Cyrielle, la copine de Nini) — tenue de base, planche V3 (novembre 2026) : 4 colonnes x 3 rangées,
// bustes sur fond noir (liseré blanc), ordre standard. Sortie 512 / 160 px comme les autres tenues de base.
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
export default {
  slug: 'cycy2',
  src: 'assets-source/planches',
  size: 512,
  thumb: 160,
  sheets: [{ name: 'cycy2-default', file: 'cycy2.png', n: 12, dir: 'default', map: MAP, white: false, tol: 24 }],
  portraits: [],
};

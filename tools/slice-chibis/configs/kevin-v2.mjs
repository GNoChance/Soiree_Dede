// Kevin (Keke) — planches V2 (ChatGPT, novembre 2026) encore utilisées : seulement les tenues sans planche V3
// (cinema, spy, croupier, strategist). Tout le reste (planches + portraits) : kevin-v3.mjs.
// 3 colonnes x 4 rangées, ordre complet : joie colère pleurs / boude réflexion dodo / bisou clin d'œil surprise / pouces timide déterminé.
const FULL = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces timide determine'.split(' ');
const F = (name, dir = name) => ({ name, file: `kevin-${name}.png`, n: 12, dir, map: FULL });
export default {
  slug: 'kevin',
  src: 'assets-source/costumes/kevin-v2',
  // croupier : planche aux émotions différentes (ordre de lecture) : clin d'œil, jongle (extra1), réflexion, joie, sérieux, nerveux,
  // lunettes noires, bras ouverts (extra2), colère, dodo, yeux en cœur, trophée. Pas de pleurs ni de surprise.
  sheets: 'strategist cinema spy'.split(' ').map((n) => F(n)).concat([{ name: 'croupier', file: 'kevin-croupier.png', n: 12, dir: 'croupier', map: ['clin_oeil', 'extra1', 'reflexion', 'joie', 'boude', 'timide', 'determine', 'extra2', 'colere', 'dodo', 'bisou', 'pouces'] }]),
  portraits: [],
};

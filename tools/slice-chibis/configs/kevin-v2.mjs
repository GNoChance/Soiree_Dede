// Kevin (Keke) — planches ChatGPT (novembre 2026), 3 colonnes x 4 rangées, ordre complet :
// joie colère pleurs / boude réflexion dodo / bisou clin d'œil surprise / pouces timide déterminé.
const FULL = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces timide determine'.split(' ');
const F = (name, dir = name) => ({ name, file: `kevin-${name}.png`, n: 12, dir, map: FULL });
// Portraits « sticker » sur fond noir : le noir hors du liseré blanc est rendu transparent (cutout).
const SQUARE = ['bowler', 'admiral', 'painter'];
export default {
  slug: 'kevin',
  src: 'assets-source/costumes/kevin-v2',
  // croupier : planche aux émotions différentes (ordre de lecture) : clin d'œil, jongle (écarté), réflexion, joie, sérieux, nerveux,
  // lunettes noires, bras ouverts (écarté), colère, dodo, yeux en cœur, trophée. Pas de pleurs ni de surprise.
  sheets: 'bowler strategist tictactoe admiral tycoon star cinema spy teacher student painter werewolf pyro pirate philosopher archer actor coach'.split(' ').map((n) => F(n)).concat([{ name: 'croupier', file: 'kevin-croupier.png', n: 12, dir: 'croupier', map: ['clin_oeil', null, 'reflexion', 'joie', 'boude', 'timide', 'determine', null, 'colere', 'dodo', 'bisou', 'pouces'] }]),
  portraits: 'bowler strategist tictactoe admiral tycoon star cinema spy croupier teacher student painter werewolf pyro pirate philosopher archer actor coach'.split(' ').map((n) => ({ file: `kevin-${n}-portrait.png`, dir: n, cutout: !SQUARE.includes(n) })),
};

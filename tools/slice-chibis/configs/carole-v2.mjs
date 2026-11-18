// Carole (Karo) — planches Gemini (novembre 2026), 4 colonnes x 3 rangées, bustes sur fond noir.
// Ordre de lecture : joie colère pleurs boude / réflexion dodo bisou clin d'œil / surprise, yeux en cœur, cool, champion.
// Carole n'a ni amoureux ni cool ni gamer : yeux en cœur = charmée ; cool et champion = stickers bonus (extra1, extra2).
// Il manque donc « pouces » et « timide » sur ces planches.
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise charmee extra1 extra2'.split(' ');
// Fond noir : white:false (le liseré blanc des stickers ne doit pas être pris pour du fond) ; racer est sur fond blanc.
const S = (name, dir = name) => ({ name, file: `carole-${name}.png`, n: 12, dir, map: MAP, white: name === 'racer', split: ['tycoon', 'admiral'].includes(name) });
export default {
  slug: 'carole',
  src: 'assets-source/costumes/carole-v2',
  sheets: 'tycoon admiral tictactoe strategist coach actor cinema bowler philosopher archer pyro painter student werewolf teacher croupier star spy racer'.split(' ').map((n) => S(n)),
  portraits: 'tycoon admiral tictactoe strategist actor cinema archer philosopher coach bowler pirate pyro werewolf painter student teacher croupier star spy racer'.split(' ').map((n) => ({ file: `carole-${n}-portrait.png`, dir: n, cutout: true })),
};

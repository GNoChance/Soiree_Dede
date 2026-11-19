// Mika — planches Gemini (novembre 2026), 4 colonnes x 3 rangées, bustes sur fond noir (liseré blanc).
// Ordre de lecture : joie colère pleurs boude / réflexion dodo bisou clin d'œil / surprise, amoureux, cool, champion (= gamer).
const MAP = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise amoureux cool gamer'.split(' ');
const FUSED = ['painter', 'bowler', 'cinema', 'philosopher', 'strategist', 'admiral', 'tycoon'];
// racer : fond blanc (les autres : fond noir + liseré blanc)
const S = (name, dir = name) => ({ name, file: `mika-${name}.png`, n: 12, dir, map: MAP, white: name === 'racer', tol: 24, split: FUSED.includes(name) });
export default {
  slug: 'mika',
  src: 'assets-source/costumes/mika-v2',
  sheets: 'spy star teacher croupier student painter werewolf pirate bowler pyro cinema philosopher actor strategist tictactoe coach admiral tycoon archer racer'.split(' ').map((n) => S(n)),
  portraits: 'star spy croupier teacher student painter werewolf pyro pirate cinema coach actor archer philosopher racer strategist tictactoe admiral tycoon bowler'.split(' ').map((n) => ({ file: `mika-${n}-portrait.png`, dir: n, cutout: true })),
};

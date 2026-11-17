// Dédé — planches ChatGPT (novembre 2026). '-' = absent (écarté), extraN = sticker bonus.
const E = (s) => s.split(' ').map((x) => (x === '-' ? null : x));
const STD = 'joie colere pleurs boude reflexion dodo bisou clin_oeil surprise pouces timide determine';
const S = (dir, map = STD) => ({ name: dir, file: `dede-${dir}.png`, n: 12, dir, map: E(map) });
export default {
  slug: 'dede',
  src: 'assets-source/costumes/dede-v2',
  sheets: [
    ...'bowler strategist tictactoe tycoon star cinema admiral croupier teacher student'.split(' ').map((d) => S(d)),
    S('painter', 'joie colere extra1 reflexion extra2 dodo bisou clin_oeil surprise pouces extra3 determine'),
    S('werewolf', 'joie colere pleurs reflexion extra1 dodo bisou clin_oeil surprise extra2 determine extra3'),
    S('pyro', 'joie colere extra1 reflexion pouces dodo bisou surprise extra2 determine boude extra3'),
    S('philosopher', 'joie reflexion extra1 extra2 extra3 determine extra4 extra5 surprise bisou boude extra6'),
    S('pirate', 'joie colere extra1 reflexion clin_oeil dodo bisou surprise extra2 determine extra3 extra4'),
  ],
  portraits: [],
};

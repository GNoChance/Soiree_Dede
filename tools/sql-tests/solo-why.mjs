// Tests des explications de fin de partie du mode solo (étape 2a, sans base) : node solo-why.mjs [jeu]
// Une partie écrite à la main par type de moment -> bon type, bonne case ; parties bot contre hasard ->
// findMoments ne plante jamais, renvoie toujours un moment, « le bon coup » est légal ; temps sous les plafonds.
import { loadSolo } from './solo-bundle.mjs'
import { mkTest } from './solo-tests/util.mjs'

const S = await loadSolo()
const t = mkTest()
const only = process.argv[2]
for (const g of ['common', 'morpion', 'q4', 'bn', 'echecs']) {
  if (only && only !== g) continue
  t.section(g)
  const mod = await import(`./solo-tests/${g}.why.mjs`)
  await mod.default(S, t)
}
t.done('des explications')

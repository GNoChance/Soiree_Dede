// Tests de l’apprentissage du bot en mode solo (étape 2b, sans base) : node solo-learn.mjs [jeu]
// Mémoire (oubli × 0,9, plafonds, purge 90 j, « Oublier », profils), habitudes détectées puis oubliées,
// bots qui exploitent une habitude, learnRate, sans hints = étape 1, tailles mesurées.
import { loadSolo } from './solo-bundle.mjs'
import { mkTest } from './solo-tests/util.mjs'

const S = await loadSolo()
const t = mkTest()
const only = process.argv[2]
for (const g of ['common', 'morpion', 'q4', 'bn', 'echecs']) {
  if (only && only !== g) continue
  t.section(g)
  const mod = await import(`./solo-tests/${g}.learn.mjs`)
  await mod.default(S, t)
}
t.done('de l’apprentissage')

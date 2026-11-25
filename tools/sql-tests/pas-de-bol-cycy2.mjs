// Pas de bol : carte perso de Cycy 2 « Va chercher ! » (reprendre une carte de la défausse).
// Usage : node pas-de-bol-cycy2.mjs ../../supabase/install.sql
import { bootDb } from './boot.mjs'
const db = await bootDb(process.argv[2])
const ids = (await db.query(`select id from public.profiles where not is_guest order by sort_order limit 3`)).rows.map((p) => p.id)
let fails = 0
const ok = (c, m, x = '') => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (c ? '' : ' ' + x)); if (!c) fails++ }
async function act(st, sv, actor, action) {
  try {
    const r = (await db.query(`select public.game_pas_de_bol_action($1::jsonb,$2::jsonb,$3::uuid,false,$4::jsonb) r`,
      [JSON.stringify(st), JSON.stringify(sv), actor, JSON.stringify(action)])).rows[0].r
    return r
  } catch (e) {
    return { err: e.message }
  }
}

// Paquet « persos » : 10 cartes perso dont celle de Cycy 2
const deck = (await db.query(`select public._pdb_deck(true) r`)).rows[0].r
const persos = deck.filter((c) => c.kind === 'perso').map((c) => c.perso)
ok(persos.length === 10 && persos.includes('cycy2'), 'paquet persos : 10 cartes dont cycy2', persos.join(','))
ok(!(await db.query(`select public._pdb_deck(false) r`)).rows[0].r.some((c) => c.kind === 'perso'), 'paquet classique : aucune carte perso')

// Partie réelle, puis main et défausse imposées au joueur dont c'est le tour.
const r0 = (await db.query(`select public.game_pas_de_bol_start($1::uuid[], '{"mode":"persos"}'::jsonb) r`, [ids])).rows[0].r
const P = r0.state.turn
const card = (id, color, value) => ({ id, color, kind: 'num', value })
const CY = { id: 'perso-cycy2', kind: 'perso', perso: 'cycy2' }
const A = card('tomate-3-9', 'tomate', 3), B = card('ciel-7-9', 'ciel', 7), TOP = card('soleil-2-9', 'soleil', 2), OLD = card('menthe-1-9', 'menthe', 1)
const H1 = card('menthe-5-9', 'menthe', 5), H2 = card('tomate-8-9', 'tomate', 8)
const setup = (hand, discard = [OLD, A, B]) => {
  const st = { ...r0.state, top: TOP, color: 'soleil', pile: [A, B, TOP], pending_draw: 0, pending_kind: null, turn_phase: 'play',
    counts: { ...r0.state.counts, [P]: hand.length }, last_card: {} }
  const sv = { ...r0.server, hands: { ...r0.server.hands, [P]: hand }, discard, drawn: null }
  return { st, sv }
}
const handIds = (r) => (r.server.hands[P] ?? []).map((c) => c.id).sort().join(',')

// 1. Reprendre une carte de la défausse visible
{
  const { st, sv } = setup([CY, H1, H2])
  const r = await act(st, sv, P, { type: 'play', card: CY.id, pick: B.id })
  ok(!r.err, 'Va chercher ! : carte reprise sans erreur', r.err)
  ok(handIds(r) === [B.id, H1.id, H2.id].sort().join(','), 'la carte choisie arrive dans la main', handIds(r))
  ok(r.state.counts[P] === 3, 'compteur de cartes à jour (3)', String(r.state?.counts?.[P]))
  ok(!r.server.discard.some((c) => c.id === B.id) && r.server.discard.some((c) => c.id === TOP.id), 'retirée de la défausse, l\'ancienne carte du dessus y est', JSON.stringify(r.server.discard.map((c) => c.id)))
  ok(r.state.top.id === CY.id && r.state.color === 'soleil', 'la carte de Cycy 2 est sur le dessus, couleur inchangée')
  ok(!r.state.pile.some((c) => c.id === B.id) && r.state.pile.at(-1).id === CY.id, 'la carte reprise disparaît de la défausse visible', JSON.stringify(r.state.pile.map((c) => c.id)))
  const e = r.state.log.find((x) => x.t === 'play' && x.card.id === CY.id)
  ok(e?.fetched?.id === B.id, 'journal : carte rapportée', JSON.stringify(e))
}
// 2. Reprendre l'ancienne carte du dessus
{
  const { st, sv } = setup([CY, H1])
  const r = await act(st, sv, P, { type: 'play', card: CY.id, pick: TOP.id })
  ok(!r.err && handIds(r) === [H1.id, TOP.id].sort().join(','), 'reprendre l\'ancienne carte du dessus', r.err ?? handIds(r))
}
// 3. Choix obligatoire et limité aux cartes visibles
{
  const { st, sv } = setup([CY, H1])
  ok((await act(st, sv, P, { type: 'play', card: CY.id })).err?.includes('invalid_fetch'), 'sans choix : refusé (invalid_fetch)')
  ok((await act(st, sv, P, { type: 'play', card: CY.id, pick: OLD.id })).err?.includes('invalid_fetch'), 'carte de la défausse non visible : refusée')
  ok((await act(st, sv, P, { type: 'play', card: CY.id, pick: H1.id })).err?.includes('invalid_fetch'), 'carte de sa propre main : refusée')
}
// 4. Dernière carte : le joueur sort, rien n'est rapporté
{
  const { st, sv } = setup([CY])
  const r = await act(st, sv, P, { type: 'play', card: CY.id })
  ok(!r.err && r.state.out.includes(P) && (r.server.hands[P] ?? []).length === 0, 'dernière carte : le joueur sort sans rien reprendre', r.err ?? JSON.stringify(r.state.out))
}
// 5. Carte visible mais déjà remélangée dans la pioche : posée, sans effet
{
  const { st, sv } = setup([CY, H1], [])
  const r = await act(st, sv, P, { type: 'play', card: CY.id, pick: A.id })
  ok(!r.err && handIds(r) === H1.id && !r.state.log.find((x) => x.card?.id === CY.id)?.fetched, 'carte déjà remélangée : posée sans effet', r.err ?? handIds(r))
}

if (fails) { console.log(fails + ' échec(s)'); process.exit(1) }
console.log('tout est vert')

// Dédé Party — écrit les tracés des grandes tailles (M, L) là où le jeu les lit, depuis le générateur du designer :
//   node tools/dede-party/write-sizes.mjs
// - src/games/dede-party/boards/<id>.ts : bloc « grandes tailles » (CELLS_M … EXTRA_L), entre les marqueurs >>> / <<< ;
// - supabase/games/dede-party.sql : _dp_board / _dp_next / _dp_prev / _dp_map (toutes les tailles), entre les marqueurs.
// Les tailles S restent les constantes de tête de boards/<id>.ts (relues ici, jamais modifiées).
// Source unique des tracés M / L : tools/dede-party/grands-plateaux-sim.mjs --dump (annexe A de la spec).
// Après : npm run sql, puis les tests (tools/sql-tests/dede-party.mjs vérifie la synchro TS ↔ SQL).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const ROOT = new URL('../../', import.meta.url)
const SIM = new URL('./grands-plateaux-sim.mjs', import.meta.url)
const SIZES = { grand: ['s', 'm'], mer: ['s', 'm', 'l'], kermesse: ['s', 'm'], camping: ['s', 'm'], ski: ['s', 'm', 'l'] }
const MAPS = Object.keys(SIZES)

const tsConst = (src, name) => JSON.parse(src.match(new RegExp(`export const ${name}[^=]*= (.+)\\n`))[1].replace(/'/g, '"'))

/** Tracés d'un plateau, taille par taille : {s: {cells, next, prev, extra}, m: {…, xy, jumps}, …}. */
function load(id) {
  const file = new URL(`src/games/dede-party/boards/${id}.ts`, ROOT)
  const src = fs.readFileSync(file, 'utf8')
  const out = { s: { cells: tsConst(src, 'CELLS'), next: tsConst(src, 'NEXT'), prev: tsConst(src, 'PREV'), extra: tsConst(src, 'EXTRA') } }
  for (const size of SIZES[id].slice(1)) {
    const S = size.toUpperCase()
    const dump = execFileSync(process.execPath, [SIM.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--dump', id, size], { encoding: 'utf8' })
    const line = (name) => {
      const m = dump.match(new RegExp(`^${name}_${S} = (.+)$`, 'm'))
      if (!m) throw new Error(`${id}:${size} : ${name}_${S} absent de la sortie du générateur`)
      return JSON.parse(m[1].replace(/'/g, '"'))
    }
    out[size] = { cells: line('CELLS'), next: line('NEXT'), prev: line('PREV'), xy: line('XY'), jumps: line('JUMPS'), extra: line('EXTRA') }
  }
  return { file, src, sizes: out }
}

const spaced = (x) => JSON.stringify(x).replace(/'/g, '’').replace(/"/g, "'").replace(/,/g, ', ')
const BEGIN_TS = '// >>> grandes tailles'
const END_TS = '// <<< grandes tailles'

function writeTs(id, { file, src, sizes }) {
  const lines = [`${BEGIN_TS} : généré par tools/dede-party/write-sizes.mjs depuis grands-plateaux-sim.mjs (annexe A de la spec), ne pas éditer à la main.`]
  for (const size of SIZES[id].slice(1)) {
    const S = size.toUpperCase()
    const d = sizes[size]
    lines.push(
      `export const CELLS_${S}: CellType[] = ${spaced(d.cells)}`,
      `export const NEXT_${S}: Array<number | [number, number]> = ${spaced(d.next)}`,
      `export const PREV_${S}: number[] = ${spaced(d.prev)}`,
      `export const XY_${S}: Array<[number, number]> = ${spaced(d.xy)}`,
      `export const JUMPS_${S}: Array<[number, number]> = ${spaced(d.jumps)}`,
      `export const EXTRA_${S}: Record<string, unknown> = ${JSON.stringify(d.extra)}`,
    )
  }
  lines.push(END_TS)
  const block = lines.join('\n')
  let out
  if (src.includes(BEGIN_TS)) out = src.replace(new RegExp(`${BEGIN_TS}[\\s\\S]*?${END_TS}`), () => block)
  else {
    // Première écriture : juste après la ligne EXTRA de la taille S.
    const m = src.match(/export const EXTRA[^=]*= .+\n/)
    out = src.slice(0, m.index + m[0].length) + '\n' + block + '\n' + src.slice(m.index + m[0].length)
  }
  fs.writeFileSync(file, out)
}

// ---------------------------------------------------------------------------- SQL
const BEGIN_SQL = '-- >>> tracés des plateaux'
const END_SQL = '-- <<< tracés des plateaux'
const q = (x) => `'${JSON.stringify(x).replace(/'/g, "''")}'`

function sqlFn(name, comment, key, all) {
  const cases = []
  for (const id of MAPS) for (const size of SIZES[id]) if (!(id === 'grand' && size === 's')) cases.push(`  when '${id}:${size}' then ${q(all[id].sizes[size][key])}`)
  return `${comment}
create or replace function public.${name}(p_map text, p_size text default 's')
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select case public._dp_key(p_map, p_size)
${cases.join('\n')}
  else ${q(all.grand.sizes.s[key])}
  end::jsonb $$;`
}

function writeSql(all) {
  const file = new URL('supabase/games/dede-party.sql', ROOT)
  const src = fs.readFileSync(file, 'utf8')
  const block = `${BEGIN_SQL} : généré par tools/dede-party/write-sizes.mjs (S : boards/<id>.ts ; M / L : grands-plateaux-sim.mjs), ne pas éditer à la main.
-- Tailles servies par plateau (spec grands plateaux §1.1 et §8).
create or replace function public._dp_sizes()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select ${q(SIZES)}::jsonb $$;

-- Clé « plateau:taille » d'un tracé : plateau absent ou inconnu → grand (parties lancées avant les 5 plateaux) ;
-- taille absente, inconnue ou que le plateau n'a pas → s (parties lancées avant les grandes tailles).
create or replace function public._dp_key(p_map text, p_size text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select m || ':' || case when coalesce(public._dp_sizes()->m, '[]'::jsonb) ? coalesce(p_size, '') then p_size else 's' end
    from (select case when public._dp_maps() ? coalesce(p_map, '') then p_map else 'grand' end m) x
$$;

${sqlFn('_dp_board', `-- Type de chaque case (index 0 = Départ) du plateau p_map à la taille p_size. Dupliqué avec CELLS / CELLS_M / CELLS_L
-- de src/games/dede-party/boards/<id>.ts : synchro vérifiée par tools/sql-tests/dede-party.mjs.`, 'cells', all)}

${sqlFn('_dp_next', `-- Case suivante de chaque case. Un tableau [tout droit, détour] = embranchement : l'aiguillage (state.sw, dans
-- l'ordre des embranchements) choisit (et bascule, ou suit la marée). Dupliqué avec NEXT / NEXT_M / NEXT_L.`, 'next', all)}

${sqlFn('_dp_prev', `-- Case précédente (carte « recule », ronde de Riton) : à un retour d'embranchement, par la grande boucle ;
-- au ski, 0 → 48 (la Grande Luge à l'envers). Dupliqué avec PREV / PREV_M / PREV_L.`, 'prev', all)}

${sqlFn('_dp_map', `-- Fiche de la mécanique (miroir de EXTRA / EXTRA_M / EXTRA_L) : numéro, mécanique, mode de chaque embranchement
-- (toggle : bascule à chaque pion ; tide : suit la marée), données propres ; grandes tailles : size, stars (zones
-- d'étoiles), starts (haltes de départ), banks (bancs de marée), pack (ratons), tp (téléporteurs).`, 'extra', all)}
${END_SQL}`
  if (!src.includes(BEGIN_SQL)) throw new Error(`marqueur « ${BEGIN_SQL} » absent de dede-party.sql`)
  // Fonction de remplacement : le bloc contient des « $$ » (corps des fonctions SQL).
  fs.writeFileSync(file, src.replace(new RegExp(`${BEGIN_SQL}[\\s\\S]*?${END_SQL}`), () => block))
}

const all = {}
for (const id of MAPS) all[id] = load(id)
for (const id of MAPS) writeTs(id, all[id])
writeSql(all)
console.log(`Tracés écrits : ${MAPS.map((id) => `${id} ${SIZES[id].join('/')}`).join(' · ')}`)

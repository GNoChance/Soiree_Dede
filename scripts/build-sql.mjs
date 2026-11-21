// Concatène tout le SQL en un seul fichier : schema.sql -> features/*.sql -> games/*.sql -> seed.sql
//   => supabase/install.sql (tests PGlite, connexion directe à la base)
// Le SQL Editor de Supabase refuse les requêtes trop grosses (~1 Mo) : on écrit aussi le même contenu
// découpé en morceaux (aux frontières de fichiers, dans le même ordre) dans supabase/install-parts/N.sql,
// à coller et exécuter l'un après l'autre (1, 2, 3…). Chaque fichier est idempotent.
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
const dir = 'supabase'
const MAX_PART = 250_000 // octets par morceau
const list = (d) => (existsSync(join(dir, d)) ? readdirSync(join(dir, d)).filter((f) => f.endsWith('.sql')).sort().map((f) => join(d, f)) : [])
const parts = ['schema.sql', ...list('features'), ...list('games'), 'seed.sql']
const sections = parts.map((p) => `\n-- ===== ${p} =====\n` + readFileSync(join(dir, p), 'utf8'))

const head = `-- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent.`
writeFileSync(join(dir, 'install.sql'), [`${head} Trop gros pour le SQL Editor : coller plutôt supabase/install-parts/*.sql dans l'ordre.`, ...sections].join('\n'))

const chunks = []
let cur = []
let size = 0
for (const s of sections) {
  const n = Buffer.byteLength(s)
  if (cur.length && size + n > MAX_PART) {
    chunks.push(cur)
    cur = []
    size = 0
  }
  cur.push(s)
  size += n
}
if (cur.length) chunks.push(cur)

const outDir = join(dir, 'install-parts')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir)
chunks.forEach((c, i) => {
  const label = `-- MORCEAU ${i + 1} / ${chunks.length} — ${head} À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.`
  writeFileSync(join(outDir, `${i + 1}.sql`), [label, ...c].join('\n'))
})
console.log('supabase/install.sql <-', parts.join(', '))
console.log(`supabase/install-parts : ${chunks.length} morceaux (${chunks.map((c) => Math.round(Buffer.byteLength(c.join('\n')) / 1000) + ' Ko').join(', ')})`)

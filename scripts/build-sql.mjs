// Concatène tout le SQL en un seul fichier à coller dans Supabase :
// schema.sql -> features/*.sql -> games/*.sql -> seed.sql  =>  supabase/install.sql
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const dir = 'supabase'
const list = (d) => (existsSync(join(dir, d)) ? readdirSync(join(dir, d)).filter((f) => f.endsWith('.sql')).sort().map((f) => join(d, f)) : [])
const parts = ['schema.sql', ...list('features'), ...list('games'), 'seed.sql']
const out = [`-- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent : à coller en entier dans Supabase > SQL Editor > Run.`]
for (const p of parts) out.push(`\n-- ===== ${p} =====\n` + readFileSync(join(dir, p), 'utf8'))
writeFileSync(join(dir, 'install.sql'), out.join('\n'))
console.log('supabase/install.sql <-', parts.join(', '))

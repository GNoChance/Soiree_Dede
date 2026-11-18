// Démarrage commun des tests SQL (PGlite) : charge install.sql fichier par fichier (2 passes) puis rejoue pour vérifier l'idempotence.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'node:fs'

export async function bootDb(file) {
  const sql = fs.readFileSync(file, 'utf8')
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create schema net;
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ select 1::bigint $$;`)
  // install.sql est découpé par fichier source ; un fichier qui dépend d'une colonne ajoutée plus loin
  // (cas d'une base neuve : daily.sql lit profiles.equipped_tenue, créée par tenues.sql) est rejoué à la 2e passe.
  const parts = sql
    .split('\n-- ===== ')
    .slice(1)
    .map((p) => ({ name: p.slice(0, p.indexOf(' =====')), body: p.slice(p.indexOf('\n') + 1) }))
  let pending = parts
  for (let pass = 1; pass <= 3 && pending.length; pass++) {
    const next = []
    for (const part of pending) {
      try {
        await db.exec(part.body)
      } catch (e) {
        if (pass === 3) {
          console.log('ÉCHEC install.sql (' + part.name + ') :', e.message)
          process.exit(1)
        }
        next.push(part)
      }
    }
    pending = next
  }
  for (const part of parts) {
    try {
      await db.exec(part.body)
    } catch (e) {
      console.log('ÉCHEC idempotence (' + part.name + ') :', e.message)
      process.exit(1)
    }
  }

  return db
}

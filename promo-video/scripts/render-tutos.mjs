// Rend toutes les compositions `Tuto-*` en mp4 légers pour mobile (720×1280, h264, CRF 30, préréglage veryslow)
// puis les copie dans ../public/tutos/<id>.mp4 (servis par l'appli).
// Usage : npm run render:tutos            → toutes
//         npm run render:tutos -- morpion → seulement celles citées
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'out', 'tutos')
const appDir = join(root, '..', 'public', 'tutos')
mkdirSync(outDir, { recursive: true })
mkdirSync(appDir, { recursive: true })

const listed = execSync('npx remotion compositions src/index.ts --quiet', { cwd: root, encoding: 'utf8' })
const all = [...new Set(listed.match(/Tuto-[a-z0-9-]+/g) ?? [])]
const wanted = process.argv.slice(2)
const ids = all.filter((c) => !wanted.length || wanted.includes(c.slice(5)))
if (!ids.length) {
  console.error(`Aucune composition Tuto-* trouvée${wanted.length ? ` pour : ${wanted.join(', ')}` : ''}.`)
  process.exit(1)
}

for (const comp of ids) {
  const id = comp.slice(5)
  const out = join(outDir, `${id}.mp4`)
  console.log(`\n▶ ${comp}`)
  execSync(
    `npx remotion render src/index.ts ${comp} "${out}" --codec=h264 --crf=${process.env.CRF ?? 30} --x264-preset=veryslow --pixel-format=yuv420p --audio-bitrate=48k`,
    { cwd: root, stdio: 'inherit' },
  )
  copyFileSync(out, join(appDir, `${id}.mp4`))
  const mo = statSync(out).size / 1024 / 1024
  console.log(`✔ public/tutos/${id}.mp4 — ${mo.toFixed(2)} Mo${mo > 3 ? '  ⚠ dépasse 3 Mo' : ''}`)
}

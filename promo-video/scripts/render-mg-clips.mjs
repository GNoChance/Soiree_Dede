// Rend les clips « échauffement » des mini-jeux de Dédé Party (compositions `Mg-<id>` : 632×422 rendues ×2 = 1264×844, 6 s, sans piste son,
// en boucle) puis les copie dans ../public/tutos/dede-party/mg-<id>.mp4 (joués pendant l'annonce du mini-jeu).
// Usage : npm run render:mg            → les 6
//         npm run render:mg -- buzzer  → seulement ceux cités
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'out', 'mg')
const appDir = join(root, '..', 'public', 'tutos', 'dede-party')
mkdirSync(outDir, { recursive: true })
mkdirSync(appDir, { recursive: true })

const listed = execSync('npx remotion compositions src/index.ts --quiet', { cwd: root, encoding: 'utf8' })
const all = [...new Set(listed.match(/Mg-[a-z0-9-]+/g) ?? [])]
const wanted = process.argv.slice(2)
const ids = all.filter((c) => !wanted.length || wanted.includes(c.slice(3)))
if (!ids.length) {
  console.error(`Aucune composition Mg-* trouvée${wanted.length ? ` pour : ${wanted.join(', ')}` : ''}.`)
  process.exit(1)
}

for (const comp of ids) {
  const id = comp.slice(3)
  const out = join(outDir, `mg-${id}.mp4`)
  console.log(`\n▶ ${comp}`)
  execSync(
    `npx remotion render src/index.ts ${comp} "${out}" --codec=h264 --crf=${process.env.CRF ?? 30} --x264-preset=veryslow --pixel-format=yuv420p --muted --scale=${process.env.SCALE ?? 2}`,
    { cwd: root, stdio: 'inherit' },
  )
  copyFileSync(out, join(appDir, `mg-${id}.mp4`))
  const ko = statSync(out).size / 1024
  console.log(`✔ public/tutos/dede-party/mg-${id}.mp4 — ${ko.toFixed(0)} Ko${ko > 400 ? '  ⚠ dépasse 400 Ko' : ''}`)
}

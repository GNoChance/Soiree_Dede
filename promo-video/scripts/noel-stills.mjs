// Contrôle visuel de la vidéo de Noël : rend plusieurs images de la composition NoelIntro en un seul bundle.
// Usage : node scripts/noel-stills.mjs 7.8 9.0 11.6 …   (secondes ; suffixe « f » pour une image : 372f)
// Sortie : out/check-<secondes>.png
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (!args.length) throw new Error('donne des secondes (ex. 7.8 9.0) ou des images (ex. 372f)')
mkdirSync(join(ROOT, 'out'), { recursive: true })
const serveUrl = await bundle({ entryPoint: join(ROOT, 'src', 'index.ts'), publicDir: join(ROOT, 'public') })
const composition = await selectComposition({ serveUrl, id: 'NoelIntro' })
for (const a of args) {
  const frame = a.endsWith('f') ? Number(a.slice(0, -1)) : Math.round(Number(a) * 30)
  const output = join(ROOT, 'out', `check-${a.replace(/f$/, 'f')}.png`)
  await renderStill({ composition, serveUrl, frame, output, imageFormat: 'png' })
  console.log(`${a} → frame ${frame} → ${output}`)
}

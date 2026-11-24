// Portrait de Kéké en Père Noël en haute définition (720×960) pour la vidéo d'annonce de Noël (NoelIntro) :
// le portrait de l'appli (384×512) serait flou en plein cadre. Même détourage que tools/slice-chibis/free-sheet.mjs
// (le noir relié au bord devient transparent), à partir de la planche source.
// Sortie : public/chibis/kevin/portraits/santa-hd.webp. Usage : node scripts/make-noel-portrait.mjs
// (utilise sharp de tools/slice-chibis : `npm ci` dans ce dossier s'il manque).
import { createRequire } from 'node:module'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TOOLS = join(ROOT, 'tools', 'slice-chibis')
const sharp = createRequire(join(TOOLS, 'package.json'))('sharp')
const { dilate } = await import(pathToFileURL(join(TOOLS, 'costumes-lib.mjs')).href)
const SRC = join(ROOT, 'assets-source', 'costumes', 'kevin-v3', 'kevin-santa-portrait.png')
const OUT = join(ROOT, 'promo-video', 'public', 'chibis', 'kevin', 'portraits', 'santa-hd.webp')

const { data, info } = await sharp(readFileSync(SRC)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: w, height: h } = info
const dark = (i) => Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 48
// Anti-fuite : on ne passe pas à moins de 10 px d'un pixel non noir, puis on regagne la frange (11 px de noir).
const lit = new Uint8Array(w * h)
for (let i = 0; i < w * h; i++) lit[i] = dark(i) ? 0 : 1
const barrier = dilate(lit, w, h, 10)
const out = new Uint8Array(w * h)
const stack = []
const push = (i) => {
  if (!out[i] && dark(i) && !barrier[i]) {
    out[i] = 1
    stack.push(i)
  }
}
for (let x = 0; x < w; x++) {
  push(x)
  push((h - 1) * w + x)
}
for (let y = 0; y < h; y++) {
  push(y * w)
  push(y * w + w - 1)
}
while (stack.length) {
  const i = stack.pop()
  const x = i % w
  const y = (i - x) / w
  if (x > 0) push(i - 1)
  if (x < w - 1) push(i + 1)
  if (y > 0) push(i - w)
  if (y < h - 1) push(i + w)
}
let cur = out
for (let k = 0; k < 11; k++) {
  const next = cur.slice()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!cur[i] && dark(i) && ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w]))) next[i] = 1
    }
  }
  cur = next
}
for (let i = 0; i < w * h; i++) if (cur[i]) data[i * 4 + 3] = 0

await sharp(data, { raw: { width: w, height: h, channels: 4 } }).resize(720, 960, { fit: 'inside', kernel: 'lanczos3' }).webp({ quality: 90 }).toFile(OUT)
console.log(`santa-hd.webp  ${statSync(OUT).size} octets`)

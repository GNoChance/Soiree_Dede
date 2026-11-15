// Genere les icones PNG a partir de public/icons/favicon.svg  (npm run icons)
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/icons')
const svg = await readFile(path.join(dir, 'favicon.svg'))

const out = async (name, size, inner = 1) => {
  const content = Math.round(size * inner)
  const pad = Math.round((size - content) / 2)
  const art = await sharp(svg, { density: 300 }).resize(content, content).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: '#FFB703' } })
    .composite([{ input: art, left: pad, top: pad }])
    .png()
    .toFile(path.join(dir, name))
  console.log('ok', name)
}

await out('icon-192.png', 192)
await out('icon-512.png', 512)
await out('icon-maskable-512.png', 512, 0.78) // zone de securite maskable
await out('apple-touch-icon.png', 180)

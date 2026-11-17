// Dev : ajoute un tuto au registre. node scripts/add-tuto.mjs <id> <exportName>
import fs from 'node:fs'
const [id, name] = process.argv.slice(2)
const p = new URL('../src/tuto/registry.ts', import.meta.url)
let s = fs.readFileSync(p, 'utf8')
if (!s.includes(`'./games/${id}'`)) {
  s = s.replace("import type { TutoSpec }", `import { ${name} } from './games/${id}'\nimport type { TutoSpec }`).replace(/\]\s*$/, `, ${name}]\n`)
  fs.writeFileSync(p, s)
}

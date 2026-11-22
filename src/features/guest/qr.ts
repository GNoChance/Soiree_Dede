/**
 * Encodeur QR code minimal (sans dépendance) : mode octet (UTF-8), correction M, versions 1 à 10
 * (jusqu'à ~210 octets : largement assez pour une URL d'invitation). Algorithme standard ISO 18004
 * (même structure que le générateur de référence de Nayuki) : codewords + Reed-Solomon, entrelacement,
 * motifs fixes, choix du masque par pénalités. Vérifié par décodage (jsQR) lors du développement.
 */

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const FORMAT_ECL_M = 0 // bits de format du niveau M

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2
    r -= (25 * n - 10) * n - 55
    if (ver >= 7) r -= 36
  }
  return r
}

const dataCodewords = (ver: number) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver]

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number): number[] {
  const res = new Array<number>(degree).fill(0)
  res[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < res.length; j++) {
      res[j] = gfMul(res[j], root)
      if (j + 1 < res.length) res[j] ^= res[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return res
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const res = new Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ (res.shift() as number)
    res.push(0)
    divisor.forEach((coef, i) => (res[i] ^= gfMul(coef, factor)))
  }
  return res
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2
  const res = [6]
  for (let pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos)
  return res
}

/** Matrice du QR code (true = module foncé), sans marge. Lève une erreur si le texte est trop long. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text))
  let ver = 1
  for (; ver <= 10; ver++) {
    const ccBits = ver <= 9 ? 8 : 16
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break
  }
  if (ver > 10) throw new Error('qr_too_long')
  const size = ver * 4 + 17
  const capacity = dataCodewords(ver)

  // --- Flux de bits : mode octet, longueur, données, terminateur, bourrage.
  const bits: number[] = []
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  push(0x4, 4)
  push(bytes.length, ver <= 9 ? 8 : 16)
  for (const b of bytes) push(b, 8)
  push(0, Math.min(4, capacity * 8 - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity * 8; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // --- Blocs + Reed-Solomon + entrelacement.
  const numBlocks = BLOCKS_M[ver]
  const eccLen = ECC_PER_BLOCK_M[ver]
  const rawCodewords = Math.floor(rawDataModules(ver) / 8)
  const numShort = numBlocks - (rawCodewords % numBlocks)
  const shortLen = Math.floor(rawCodewords / numBlocks)
  const div = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, div)
    if (i < numShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const codewords: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i])
    })
  }

  // --- Motifs fixes.
  const mods: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    mods[y][x] = dark
    fn[y][x] = true
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
      }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  const al = alignmentPositions(ver, size)
  const last = al.length - 1
  al.forEach((ax, i) =>
    al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }),
  )
  const drawFormat = (mask: number) => {
    const d = (FORMAT_ECL_M << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((d << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i))
    set(8, 7, bit(b, 6))
    set(8, 8, bit(b, 7))
    set(7, 8, bit(b, 8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i))
    set(8, size - 8, true)
  }
  drawFormat(0) // réserve les cases (valeurs réécrites après le choix du masque)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      set(a, c, bit(b, i))
      set(c, a, bit(b, i))
    }
  }

  // --- Placement en zigzag.
  let n = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let v = 0; v < size; v++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - v : v
        if (!fn[y][x] && n < codewords.length * 8) {
          mods[y][x] = bit(codewords[n >>> 3], 7 - (n & 7))
          n++
        }
      }
  }

  // --- Masque : celui de plus faible pénalité.
  const masked = (mask: number): boolean[][] =>
    mods.map((row, y) =>
      row.map((m, x) => {
        if (fn[y][x]) return m
        let inv: boolean
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break
          case 1: inv = y % 2 === 0; break
          case 2: inv = x % 3 === 0; break
          case 3: inv = (x + y) % 3 === 0; break
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
          case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break
          default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
        }
        return m !== inv
      }),
    )
  let best: boolean[][] = mods
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    drawFormat(mask)
    const m = masked(mask)
    const s = penalty(m)
    if (s < bestScore) {
      bestScore = s
      best = m
    }
  }
  return best
}

function penalty(m: boolean[][]): number {
  const size = m.length
  let score = 0
  const finderLike = [true, false, true, true, true, false, true]
  const lines: boolean[][] = []
  for (let i = 0; i < size; i++) {
    lines.push(m[i])
    lines.push(m.map((row) => row[i]))
  }
  for (const line of lines) {
    let run = 1
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    for (let i = 0; i + 7 <= size; i++) {
      if (!finderLike.every((v, k) => line[i + k] === v)) continue
      const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || !line[i - k])
      const lightAfter = [0, 1, 2, 3].every((k) => i + 7 + k >= size || !line[i + 7 + k])
      if (lightBefore || lightAfter) score += 40
    }
  }
  let dark = 0
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++
      if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3
    }
  const total = size * size
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

/** Chemin SVG (un `M x y h1 v1 h-1 z` par module foncé), avec une marge de `margin` modules. */
export function qrSvgPath(matrix: boolean[][], margin = 4): { path: string; size: number } {
  let path = ''
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + margin} ${y + margin}h1v1h-1z`
    }),
  )
  return { path, size: matrix.length + margin * 2 }
}

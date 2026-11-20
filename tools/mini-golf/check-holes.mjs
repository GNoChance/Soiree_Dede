// Vérification headless des trous du Mini-golf, avec la VRAIE physique (src/games/mini-golf/scene/physics.ts, cannon-es).
//   node --import ./tools/mini-golf/ts-hooks.mjs tools/mini-golf/check-holes.mjs [ids…] [--quick] [--human N]
// (depuis la racine du projet ; Node ≥ 23.6 pour lire le TypeScript directement).
//
// Pour chaque trou :
//  1. Structure : route du départ au trou, départ et trou posés sur une dalle, ids 1..n consécutifs, par 2 à 4.
//  2. Solveur « joueur simple » : recherche en faisceau (quelques meilleures positions gardées à chaque coup) parmi
//     des tirs en éventail (directions vers les points de la route et vers le trou, puissances étagées) ;
//     une position vaut la distance qui reste le long de la route. Le trou doit être rentré en ≤ par coups.
//     Moulin / barrière mobile : on essaie plusieurs instants de frappe (on peut attendre le bon moment).
//  3. Robustesse : tirs au hasard (départ + positions atteintes par le solveur) : aucune balle hors piste,
//     aucune balle bloquée (coup > 25 s), aucune balle arrêtée ailleurs que posée sur une dalle.
//     Trous « void » : la chute compte comme l'eau (plouf / chute dans le résumé).
import { GolfPhysics, BALL_R, STEP, shotSpeed } from '../../src/games/mini-golf/scene/physics.ts'
import { HOLES, floorHeight, maxStrokes, pickedUp } from '../../src/games/mini-golf/holes.ts'

const args = process.argv.slice(2)
const quick = args.includes('--quick')
const only = args.filter((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--human').map(Number)
const holes = only.length ? HOLES.filter((h) => only.includes(h.id)) : HOLES

// Graine fixe : résultats reproductibles.
let seed = 12345
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

const deg = Math.PI / 180
const timed = (h) => h.pieces.some((p) => p.kind === 'mill' || p.kind === 'slider')

/** Vrai si le segment (x1,z1)-(x2,z2) coupe une bordure du trou (hors extrémités). */
function blocked(h, x1, z1, x2, z2) {
  const cross = (ax, az, bx, bz, cx, cz) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
  for (const p of h.pieces) {
    if (p.kind !== 'wall') continue
    const [ax, az] = p.a
    const [bx, bz] = p.b
    const d1 = cross(x1, z1, x2, z2, ax, az), d2 = cross(x1, z1, x2, z2, bx, bz)
    const d3 = cross(ax, az, bx, bz, x1, z1), d4 = cross(ax, az, bx, bz, x2, z2)
    if (d1 * d2 < 0 && d3 * d4 < 0) return true
  }
  return false
}

/**
 * Distance restant à parcourir le long de la route depuis (x, z) (+ écart latéral).
 * Trous suspendus (`void`) : la route revient parfois près d'elle-même (balcons, étages) ; un point de la route
 * séparé de la balle par une bordure ne compte pas comme un raccourci (+ BLOCKED).
 */
const BLOCKED = 8
function remaining(h, x, z) {
  const r = h.route
  let best = Infinity
  for (let i = 0; i < r.length - 1; i++) {
    const [ax, az] = r[i]
    const [bx, bz] = r[i + 1]
    const dx = bx - ax, dz = bz - az
    const L = Math.hypot(dx, dz) || 1e-9
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (L * L)))
    const px = ax + dx * t, pz = az + dz * t
    let rest = L * (1 - t)
    for (let j = i + 1; j < r.length - 1; j++) rest += Math.hypot(r[j + 1][0] - r[j][0], r[j + 1][1] - r[j][1])
    let v = rest + 1.5 * Math.hypot(x - px, z - pz)
    if (h.void && blocked(h, x, z, px, pz)) v += BLOCKED
    if (v < best) best = v
  }
  return best
}

function onFloor(h, x, z) {
  return h.pieces.some((p) => (p.kind === 'floor' || p.kind === 'ramp') && x >= p.x0 - 1e-6 && x <= p.x1 + 1e-6 && z >= p.z0 - 1e-6 && z <= p.z1 + 1e-6)
}

/** Un tir depuis pos à l'instant t0 ; renvoie le résultat + problèmes éventuels. */
function shot(ph, pos, a, power, t0) {
  ph.place(pos[0], pos[1], pos[2])
  const r = ph.simulate(Math.sin(a), -Math.cos(a), power, t0, 120 * 30)
  const stuck = ph.status !== 'rest' && ph.status !== 'holed'
  // chute dans le vide = même pénalité que l'eau
  return { ...r, water: r.water || r.fall, stuck, slow: r.time > 25 - STEP * 2 }
}

function restProblem(h, r) {
  if (r.holed || r.water || r.out) return null
  if (r.stuck || r.slow) return `bloquée (${r.time.toFixed(1)} s) en (${r.x.toFixed(2)}, ${r.z.toFixed(2)})`
  // sol sous l'empreinte de la balle (elle peut reposer sur le bord d'une dalle)
  const k = BALL_R * 0.95
  const ys = [[0, 0], [k, 0], [-k, 0], [0, k], [0, -k]].filter(([dx, dz]) => onFloor(h, r.x + dx, r.z + dz)).map(([dx, dz]) => floorHeight(h, r.x + dx, r.z + dz) + BALL_R)
  if (!ys.length) return `arrêtée hors dalle en (${r.x.toFixed(2)}, ${r.z.toFixed(2)})`
  if (!ys.some((fy) => Math.abs(r.y - fy) < 0.06)) return `arrêtée à y=${r.y.toFixed(2)} (sol ${ys.map((y) => y.toFixed(2)).join('/')}) en (${r.x.toFixed(2)}, ${r.z.toFixed(2)}) : sur un mur ?`
  return null
}

function candidates(h, pos, light = quick) {
  const out = []
  const targets = [...h.route.slice(1), h.cup]
  const dirs = new Set()
  const n = light ? 60 : 90
  for (let i = 0; i < n; i++) dirs.add(+((i * 360) / n).toFixed(2))
  for (const [tx, tz] of targets) {
    const a = Math.atan2(tx - pos[0], -(tz - pos[2])) / deg
    for (let d = -24; d <= 24; d += 3) dirs.add(+(a + d).toFixed(2))
  }
  const powers = light ? [0.12, 0.2, 0.3, 0.4, 0.5, 0.62, 0.75, 0.9] : [0.08, 0.13, 0.18, 0.24, 0.3, 0.36, 0.43, 0.5, 0.58, 0.67, 0.77, 0.88, 1]
  for (const a of dirs) for (const p of powers) out.push([a * deg, p])
  // Visée fine vers le trou (putt).
  const ac = Math.atan2(h.cup[0] - pos[0], -(h.cup[1] - pos[2])) / deg
  const dist = Math.hypot(h.cup[0] - pos[0], h.cup[1] - pos[2])
  if (dist < 6) {
    const da = light ? 1.5 : 0.75
    const dp = light ? 0.04 : 0.03
    for (let d = -9; d <= 9; d += da) for (let p = 0.04; p <= 0.7; p += dp) out.push([(ac + d) * deg, p])
  }
  return out
}

function solve(h) {
  const ph = new GolfPhysics(h, 0)
  const tee = [h.tee[0], floorHeight(h, h.tee[0], h.tee[1]) + BALL_R, h.tee[1]]
  const phases = timed(h) ? (quick ? [0, 0.55, 1.1] : [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.9, 2.4]) : [0]
  const beamW = quick ? 3 : 5
  let beam = [{ pos: tee, strokes: 0, path: [] }]
  const seen = [tee]
  const problems = []
  for (let depth = 0; depth < h.par && beam.length; depth++) {
    const next = []
    let holed = null
    for (const st of beam) {
      for (const [a, p] of candidates(h, st.pos)) {
        for (const t0 of phases) {
          const r = shot(ph, st.pos, a, p, 10 + t0)
          const pb = restProblem(h, r)
          if (pb && problems.length < 5) problems.push(pb)
          if (r.out) continue
          const strokes = st.strokes + 1 + (r.water ? 1 : 0)
          const path = [...st.path, { a: +(a / deg).toFixed(1), p: +p.toFixed(2), t0, water: r.water }]
          if (r.holed) {
            if (!holed || strokes < holed.strokes) holed = { strokes, path }
            continue
          }
          if (r.water) continue
          next.push({ pos: [r.x, r.y, r.z], strokes, path, score: remaining(h, r.x, r.z) + strokes * 0.6 })
        }
        if (holed && holed.strokes === st.strokes + 1) break
      }
    }
    if (holed) return { holed, problems, seen }
    // garde les meilleures positions, assez éloignées les unes des autres (diversité)
    next.sort((u, v) => u.score - v.score)
    const kept = []
    for (const c of next) {
      if (kept.length >= beamW) break
      if (kept.every((k) => Math.hypot(k.pos[0] - c.pos[0], k.pos[2] - c.pos[2]) > 0.35)) kept.push(c)
    }
    seen.push(...kept.map((k) => k.pos))
    beam = kept
  }
  return { holed: null, problems, seen }
}

function robustness(h, seen) {
  const ph = new GolfPhysics(h, 0)
  const n = quick ? 150 : 400
  const issues = []
  let water = 0, out = 0, holed = 0, falls = 0
  for (let i = 0; i < n; i++) {
    const pos = seen[Math.floor(rnd() * seen.length)]
    const a = rnd() * Math.PI * 2
    const p = rnd() < 0.3 ? 0.85 + rnd() * 0.15 : rnd()
    const r = shot(ph, pos, a, p, 10 + rnd() * 7)
    if (r.fall) falls++
    else if (r.water) water++
    if (r.holed) holed++
    if (r.out) {
      out++
      if (issues.length < 4) issues.push(`hors piste : tir ${(a / deg).toFixed(0)}° à ${p.toFixed(2)} depuis (${pos[0].toFixed(2)}, ${pos[2].toFixed(2)})`)
    }
    const pb = restProblem(h, r)
    if (pb && issues.length < 4) issues.push(pb)
  }
  return { n, water, out, holed, falls, issues }
}

function structure(h, i) {
  const errs = []
  if (h.id !== i + 1) errs.push(`id ${h.id} ≠ ${i + 1}`)
  if (h.id <= 20 ? h.par < 2 || h.par > 4 : h.par < 4 || h.par > 6) errs.push(`par ${h.par} hors ${h.id <= 20 ? '2..4' : '4..6 (Défi)'}`)
  const r = h.route
  if (r[0][0] !== h.tee[0] || r[0][1] !== h.tee[1]) errs.push('la route ne part pas du départ')
  const e = r[r.length - 1]
  if (e[0] !== h.cup[0] || e[1] !== h.cup[1]) errs.push('la route ne finit pas au trou')
  if (!onFloor(h, h.tee[0], h.tee[1])) errs.push('départ hors dalle')
  if (!onFloor(h, h.cup[0], h.cup[1])) errs.push('trou hors dalle')
  if (Math.abs(floorHeight(h, h.cup[0], h.cup[1]) - (h.cupY ?? 0)) > 1e-6) errs.push(`cupY ${h.cupY ?? 0} ≠ sol ${floorHeight(h, h.cup[0], h.cup[1])}`)
  for (const w of h.water ?? []) if (w.x0 >= w.x1 || w.z0 >= w.z1) errs.push('zone d’eau vide')
  return errs
}

/**
 * « Joueur moyen » (indicatif, pour régler les pars) : à chaque coup il repère les meilleurs tirs immédiats
 * (rentrer, sinon avancer le plus le long de la route), garde le plus sûr une fois rejoué avec son erreur
 * de visée / puissance / timing, puis le joue (avec cette erreur).
 */
const NOISE_A = 2.5
const NOISE_P = 0.08
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())
function human(h, runs) {
  const ph = new GolfPhysics(h, 0)
  const tee = [h.tee[0], floorHeight(h, h.tee[0], h.tee[1]) + BALL_R, h.tee[1]]
  const phases = timed(h) ? [0, 0.55, 1.1] : [0]
  const scores = []
  for (let k = 0; k < runs; k++) {
    let pos = tee
    let strokes = 0
    let holed = false
    while (strokes < maxStrokes(h.par) && !holed) {
      const here = remaining(h, pos[0], pos[2])
      const value = (r) => (r.holed ? -6 : r.out ? here + 1 : r.water ? here + 3 : remaining(h, r.x, r.z))
      const noisy = (c) => shot(ph, pos, c.a + gauss() * NOISE_A * deg, Math.min(1, Math.max(0.02, c.p * (1 + gauss() * NOISE_P))), 10 + c.t0 + gauss() * 0.12)
      // 1) les meilleurs tirs « parfaits »…
      const cands = []
      for (const [a, p] of candidates(h, pos, true)) {
        for (const t0 of phases) cands.push({ a, p, t0, sc: value(shot(ph, pos, a, p, 10 + t0)) })
      }
      cands.sort((u, v) => u.sc - v.sc)
      // 2) … puis le plus sûr d'entre eux, rejoué avec l'erreur du joueur (un humain prudent ne tente pas l'impossible)
      let best = null
      for (const c of cands.slice(0, 8)) {
        let m = 0
        for (let j = 0; j < 4; j++) m += value(noisy(c)) / 4
        if (!best || m < best.m) best = { ...c, m }
      }
      const r = noisy(best)
      strokes += r.water ? 2 : 1
      if (r.holed) holed = true
      else if (!r.water && !r.out) pos = [r.x, r.y, r.z]
    }
    scores.push(holed ? Math.min(strokes, maxStrokes(h.par)) : pickedUp(h.par))
  }
  const count = {}
  for (const s of scores) count[s] = (count[s] ?? 0) + 1
  return {
    avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    dist: Object.entries(count).map(([s, n]) => `${n}×${s}`).join(' '),
  }
}

const hi = args.indexOf('--human')
const humanRuns = hi >= 0 ? Number(args[hi + 1]) || 10 : 0

let failed = false
const t0 = performance.now()
for (const h of holes) {
  const i = HOLES.indexOf(h)
  const errs = structure(h, i)
  const t = performance.now()
  const s = solve(h)
  const rb = robustness(h, s.seen)
  const ok = !errs.length && s.holed && s.holed.strokes <= h.par && rb.out === 0 && !rb.issues.length && !s.problems.length
  if (!ok) failed = true
  const res = s.holed ? `rentrée en ${s.holed.strokes} (par ${h.par})` : `PAS rentrée en ${h.par} coups (par ${h.par})`
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} trou ${String(h.id).padStart(2)} ${h.name.padEnd(30)} ${res} · hasard ${rb.n} tirs : ${rb.holed} rentrés, ${rb.water} plouf, ${rb.falls} chutes, ${rb.out} hors piste · ${((performance.now() - t) / 1000).toFixed(1)} s`)
  if (s.holed) console.log(`      coups : ${s.holed.path.map((c) => `${c.a}°/${c.p}${c.t0 ? ` @${c.t0}s` : ''}${c.water ? ' (plouf)' : ''}`).join(' → ')}`)
  for (const e of [...errs, ...s.problems, ...rb.issues]) console.log('      ! ' + e)
  if (humanRuns) {
    const hp = human(h, humanRuns)
    console.log(`      joueur moyen (${humanRuns} parties, visée ±${NOISE_A}°, puissance ±${NOISE_P * 100} %) : ${hp.avg.toFixed(2)} coups en moyenne (par ${h.par}), ${hp.dist}`)
  }
}
console.log(`\n${failed ? 'ÉCHEC' : 'Tout est OK'} (${((performance.now() - t0) / 1000).toFixed(0)} s, ${holes.length} trous, vitesse max ${shotSpeed(1)} u/s)`)
process.exit(failed ? 1 : 0)

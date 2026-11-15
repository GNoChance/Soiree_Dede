/**
 * Geste de lancer (pointer events) :
 * - glisser horizontalement EN PARTANT DE LA BOULE = placer la boule (avant le lancer) ;
 * - glisser vers le haut dans la zone basse = lancer. Vitesse du geste -> vitesse
 *   de la boule, direction (1re moitié du geste) -> angle, courbure (virage entre
 *   la 1re et la 2e moitié) -> effet.
 * `analyzeSwipe` est pure (testable sous Node).
 */
import { MAX_ANGLE, SPEED_MAX, SPEED_MIN, clamp } from './physics.ts'

export interface SwipePoint {
  x: number
  y: number
  t: number
}

export interface SwipeResult {
  speed: number
  angle: number
  spin: number
  /** 0..1 (pour l'affichage) */
  power: number
}

/** Vitesse du geste (hauteurs d'écran / s) donnant SPEED_MIN et SPEED_MAX. */
const V_SLOW = 0.8
const V_FAST = 4.5
/** Facteur écran -> piste pour l'angle (un geste à 20° vise ~3,6°). */
const ANGLE_FACTOR = 0.18
/** Virage du geste (rad) donnant l'effet maximal. */
const TURN_FULL = 0.55
const TURN_DEADZONE = 0.08

const dirOf = (a: SwipePoint, b: SwipePoint) => Math.atan2(b.x - a.x, a.y - b.y) // 0 = vers le haut, + = vers la droite

/** Analyse d'un geste (coordonnées écran, y vers le bas). null si ce n'est pas un lancer. */
export function analyzeSwipe(points: SwipePoint[], height: number): SwipeResult | null {
  if (points.length < 3 || height <= 0) return null
  const first = points[0]
  const last = points[points.length - 1]
  const up = first.y - last.y
  if (up < height * 0.08) return null

  // Vitesse : sur les ~120 dernières ms du geste.
  let k = points.length - 1
  while (k > 0 && last.t - points[k - 1].t < 120) k--
  k = Math.max(0, k - 1)
  const seg = points[k]
  const dt = Math.max(16, last.t - seg.t)
  const dist = Math.hypot(last.x - seg.x, last.y - seg.y)
  const vn = (dist / dt) * 1000 / height
  const power = clamp((vn - V_SLOW) / (V_FAST - V_SLOW), 0, 1)
  const speed = SPEED_MIN + power * (SPEED_MAX - SPEED_MIN)

  // Point milieu (en distance parcourue)
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  let acc = 0
  let mid = points[Math.floor(points.length / 2)]
  for (let i = 1; i < points.length; i++) {
    acc += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (acc >= total / 2) {
      mid = points[i]
      break
    }
  }
  const a1 = dirOf(first, mid)
  const a2 = dirOf(mid, last)
  const angle = clamp(a1 * ANGLE_FACTOR, -MAX_ANGLE, MAX_ANGLE)
  let turn = a2 - a1
  turn = Math.abs(turn) < TURN_DEADZONE ? 0 : turn - Math.sign(turn) * TURN_DEADZONE
  const spin = clamp(turn / TURN_FULL, -1, 1)
  return { speed, angle, spin, power }
}

export interface InputHandlers {
  /** Le doigt est-il posé sur la boule ? (coordonnées relatives à l'élément) */
  hitBall: (x: number, y: number) => boolean
  /** Glissé horizontal sur la boule : déplacement en px depuis le début. */
  onPlace: (dxPx: number, phase: 'start' | 'move' | 'end') => void
  /** Geste de lancer en cours (pour l'aperçu de visée). */
  onSwipe: (points: SwipePoint[], phase: 'move' | 'cancel') => void
  onThrow: (r: SwipeResult) => void
  /** Geste trop court / vers le bas. */
  onInvalid: () => void
  enabled: () => boolean
}

/** Branche les pointer events sur `el`. Renvoie la fonction de nettoyage. */
export function attachInput(el: HTMLElement, h: InputHandlers): () => void {
  let mode: 'none' | 'place' | 'swipe' = 'none'
  let id = -1
  let x0 = 0
  let pts: SwipePoint[] = []

  const rel = (e: PointerEvent): SwipePoint => {
    const r = el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp || performance.now() }
  }

  const down = (e: PointerEvent) => {
    if (mode !== 'none' || !h.enabled()) return
    const p = rel(e)
    const H = el.clientHeight
    if (h.hitBall(p.x, p.y)) {
      mode = 'place'
      x0 = p.x
      h.onPlace(0, 'start')
    } else if (p.y > H * 0.4) {
      mode = 'swipe'
      pts = [p]
    } else return
    id = e.pointerId
    try {
      el.setPointerCapture(id)
    } catch {
      /* ignore */
    }
    e.preventDefault()
  }
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    const p = rel(e)
    if (mode === 'place') h.onPlace(p.x - x0, 'move')
    else if (mode === 'swipe') {
      pts.push(p)
      if (pts.length > 240) pts.splice(1, pts.length - 240)
      h.onSwipe(pts, 'move')
    }
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    const p = rel(e)
    if (mode === 'place') h.onPlace(p.x - x0, 'end')
    else if (mode === 'swipe') {
      pts.push(p)
      const r = e.type === 'pointerup' ? analyzeSwipe(pts, el.clientHeight) : null
      h.onSwipe(pts, 'cancel')
      if (r && h.enabled()) h.onThrow(r)
      else if (e.type === 'pointerup') h.onInvalid()
    }
    mode = 'none'
    id = -1
    pts = []
  }

  el.addEventListener('pointerdown', down)
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
  return () => {
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
  }
}

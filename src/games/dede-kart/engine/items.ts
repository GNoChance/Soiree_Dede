import * as THREE from 'three'
import { WALL_MARGIN, type Track } from './track'

/** Objets de Dédé Kart (noms et effets originaux). */
export type ItemId = 'turbo' | 'ball' | 'glue' | 'star' | 'bubble' | 'cloud' | 'confetti' | 'reverse'

export const ITEMS: Record<ItemId, { emoji: string; label: string }> = {
  turbo: { emoji: '🚀', label: 'Pétard turbo' },
  ball: { emoji: '🎳', label: 'Boule rebondissante' },
  glue: { emoji: '🍯', label: 'Flaque de glue' },
  star: { emoji: '🌈', label: 'Bouclier arc-en-ciel' },
  bubble: { emoji: '🛡️', label: 'Bulle' },
  cloud: { emoji: '☁️', label: 'Gros nuage' },
  confetti: { emoji: '🎊', label: 'Confettis' },
  reverse: { emoji: '🔄', label: 'Demi-tour' },
}
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[]

/** Objets qui passent par le serveur (ils touchent les autres). */
export type NetItem = 'ball' | 'glue' | 'cloud' | 'confetti' | 'reverse'

/** Piège ou projectile posé sur la piste (state.hazards, contrat SQL). */
export interface Hazard {
  id: number
  type: 'ball' | 'glue'
  owner: string
  x: number
  z: number
  h: number
  /** ISO, heure serveur du lancer */
  at: string
}

/** Effet subi par un kart (state.fx). */
export interface Fx {
  id: number
  type: 'cloud' | 'confetti' | 'reverse'
  target: string
  by: string
  /** ISO */
  until: string
}

/** Envoi au serveur d'un objet qui touche les autres. */
export interface UsePayload {
  item: NetItem
  x?: number
  z?: number
  h?: number
  targets?: string[]
}

/**
 * Tirage selon la place (rattrapage) : les premiers ont des objets de défense,
 * les derniers les gros bonus. Le Gros nuage est réservé à la 2ᵉ moitié, le Demi-tour aux places > 3.
 */
export function rollItem(place: number, total: number, rnd = Math.random): ItemId {
  const q = total > 1 ? (place - 1) / (total - 1) : 0.5
  const w: Partial<Record<ItemId, number>> =
    q < 0.25
      ? { bubble: 3, ball: 3, glue: 4, turbo: 1, confetti: 1 }
      : q <= 0.65
        ? { turbo: 3, ball: 3, glue: 2, bubble: 2, confetti: 2, reverse: 1, cloud: 0.5 }
        : { turbo: 4, star: 3, cloud: 2, reverse: 2, ball: 1, confetti: 1 }
  if (place <= 3) delete w.reverse
  if (q < 0.5) delete w.cloud
  const entries = Object.entries(w) as [ItemId, number][]
  let r = rnd() * entries.reduce((s, [, v]) => s + v, 0)
  for (const [id, v] of entries) {
    if ((r -= v) <= 0) return id
  }
  return 'turbo'
}

export const BALL_SPEED = 52
const BALL_LIFE = 6
const BALL_BOUNCES = 3
const STEP = 1 / 60

/**
 * Boule rebondissante : trajectoire déterministe (pas fixe 1/60 s) depuis le lancer,
 * identique sur tous les téléphones. Rebondit 3 fois sur les murs puis disparaît.
 */
export class BallSim {
  x: number
  z: number
  vx: number
  vz: number
  t = 0
  bounces = 0
  dead = false
  private idx = -1

  constructor(hz: Hazard) {
    this.x = hz.x
    this.z = hz.z
    this.vx = Math.cos(hz.h) * BALL_SPEED
    this.vz = Math.sin(hz.h) * BALL_SPEED
  }

  /** Avance jusqu'à l'âge `age` (s). */
  advance(track: Track, age: number) {
    const wall = track.half + WALL_MARGIN - 1
    while (!this.dead && this.t + STEP <= age) {
      this.t += STEP
      this.x += this.vx * STEP
      this.z += this.vz * STEP
      const loc = track.locate(this.x, this.z, this.idx)
      this.idx = loc.i
      if (Math.abs(loc.lat) > wall) {
        // rebond : on renvoie la composante latérale
        const nx = -track.tz[loc.i]
        const nz = track.tx[loc.i]
        const dot = this.vx * nx + this.vz * nz
        if (dot * loc.lat > 0) {
          this.vx -= 2 * dot * nx
          this.vz -= 2 * dot * nz
          this.bounces++
        }
        if (this.bounces > BALL_BOUNCES) this.dead = true
      }
      if (this.t > BALL_LIFE) this.dead = true
    }
  }
}

/** Boîte « ? » (texture dessinée une fois). */
let boxTex: THREE.CanvasTexture | null = null
export function boxMaterial() {
  if (!boxTex) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 64, 64)
    grad.addColorStop(0, '#FFD23F')
    grad.addColorStop(1, '#FF5A5F')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    g.strokeStyle = '#1B1B2F'
    g.lineWidth = 6
    g.strokeRect(3, 3, 58, 58)
    g.fillStyle = '#FFFFFF'
    g.font = 'bold 44px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('?', 32, 35)
    boxTex = new THREE.CanvasTexture(c)
    boxTex.colorSpace = THREE.SRGBColorSpace
  }
  return new THREE.MeshBasicMaterial({ map: boxTex, transparent: true, opacity: 0.92 })
}

/** Rangées de boîtes : fraction du tour où elles sont posées (4 boîtes de front). */
export const BOX_ROWS = [0.2, 0.47, 0.8]

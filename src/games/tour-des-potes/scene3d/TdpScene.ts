/**
 * Plateau 3D du Tour des Potes (three « brut », chargé en différé).
 *
 * - Plateau : atlas canvas unique (cases + centre), 40 cases en relief, maisons /
 *   hôtels en petits volumes, marque du propriétaire, pions = sprites chibi.
 * - Centre : deux tas de cartes (Hasard / Entre potes) + deux dés + la cagnotte des
 *   taxes (tas de billets qui grossit ; billets en vol pion → tas, ou tas → pion).
 * - Caméra : vue d'ensemble, suivi du pion, gros plan sur le tas ; pincer / glisser
 *   (limités), double-tap = recentrer.
 * - Rendu À LA DEMANDE : la boucle rAF s'arrête dès que plus rien ne bouge
 *   (caméra posée, pions arrêtés, pas d'animation) ; pause onglet caché ; dispose()
 *   libère géométries, matériaux, textures, contexte WebGL et écouteurs.
 */
import * as THREE from 'three'
import { BOARD } from '../board'
import { chibiUrl } from '@/data/characters'
import { billsFor, potBills, type Denom } from '../money'
import {
  BILL_D, BILL_H, BILL_W, BOARD_SIZE, CARD_D, CARD_W, CELL_H, CENTER_H, DECK_H, DECK_POS, DICE_REST, POT_LABEL_Z, POT_POS, SLAB_H,
  cellBox, pawnSlots, sideOf,
} from './layout'
import {
  DECK_COLOR, makeBillTex, makeBoardAtlas, makeCardBack, makeCardFace, makeDieFaces, makeEmojiTex, makeGlow, makePotLabel, makeStackSide,
  type CardFaceInfo,
} from './textures'

export type DeckId = 'hasard' | 'potes'

export interface ScenePlayer {
  id: string
  color: string
  slug: string
  expression: string
  tenue: string
}

export interface SceneReveal extends CardFaceInfo {
  key: string
}

/** Billets en vol : taxe (pion → cagnotte) ou cagnotte ramassée (cagnotte → pion). */
export interface SceneMoneyFx {
  key: number
  player: string
  amount: number
}

export interface SceneView {
  players: ScenePlayer[]
  /** Case affichée de chaque joueur (animation pas à pas de usePlayback). */
  pos: Record<string, number>
  turn: string | null
  jail: string[]
  bankrupt: string[]
  /** Couleur du propriétaire par case. */
  ownerColor: Record<number, string>
  levels: Record<number, number>
  selected: number | null
  dice: [number, number] | null
  /** Numéro du lancer : change à chaque lancer → animation des dés. */
  rollNo: number
  /** Joueur en train de marcher (la caméra le suit). */
  moving: string | null
  /** Phase « carte » : tas à piocher (null sinon). */
  deckFocus: DeckId | null
  /** Le joueur local peut piocher (toucher le tas). */
  canDraw: boolean
  reveal: SceneReveal | null
  /** L'overlay de lecture de la carte est affiché. */
  cardShowing: boolean
  /** Cagnotte des taxes affichée au centre. */
  taxPot: number
  taxFx: SceneMoneyFx | null
  potFx: SceneMoneyFx | null
}

export interface SceneOptions {
  /** Durée du lancer de dés (ms), = DICE_MS de usePlayback. */
  rollMs: number
  /** Durée de l'animation de pioche avant l'overlay (ms). */
  drawMs: number
  /** Durée du vol des billets d'une taxe (ms), = TAX_FLY_MS de usePlayback. */
  taxMs: number
  onCell: (i: number) => void
  onDeck: (deck: DeckId) => void
  onLost: () => void
}

const FOV = 38
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)
const easeInOut = (t: number) => {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

interface Pawn {
  id: string
  group: THREE.Group
  sprite: THREE.Sprite
  base: THREE.Mesh
  ring: THREE.Mesh
  jail: THREE.Sprite
  tx: number
  tz: number
  scale: number
  curScale: number
  color: string
}

interface DieAnim {
  t0: number
  from: THREE.Vector3
  axis: THREE.Vector3
  turns: number
}

interface Deck {
  id: DeckId
  group: THREE.Group
  stack: THREE.Mesh
  glow: THREE.Mesh
  glowMat: THREE.MeshBasicMaterial
  hit: THREE.Mesh
  cardRest: THREE.Vector3
}

interface BillFlight {
  mesh: THREE.Mesh
  t0: number
  dur: number
  from: THREE.Vector3
  to: THREE.Vector3
  spin: number
  /** Billet d'une taxe : une fois posé, il reste jusqu'à ce que le tas soit mis à jour. */
  keep: boolean
  landed: boolean
}

const POT_MAX = 18
/** Dispersion déterministe du billet k dans le tas. */
const potSlot = (k: number) => ({
  x: POT_POS.x + Math.sin(k * 2.4) * 0.16,
  y: CENTER_H + BILL_H / 2 + 0.004 + k * (BILL_H + 0.004),
  z: POT_POS.z + Math.cos(k * 1.7) * 0.12,
  yaw: Math.sin(k * 12.9898) * 0.75,
})

type CamMode = 'overview' | 'follow' | 'deck'

export class TdpScene {
  private host: HTMLElement
  private opts: SceneOptions
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 1, 90)
  private root = new THREE.Group()
  private disposables: Array<{ dispose: () => void }> = []
  private cleanups: Array<() => void> = []
  private disposed = false
  private raf = 0
  private hidden = false
  private lastT = 0
  private width = 1
  private height = 1

  // plateau
  private cellGroups: THREE.Group[] = []
  private cellRaise: number[] = new Array(40).fill(0)
  private bldGroups: THREE.Group[] = []
  private bldLevel: number[] = new Array(40).fill(-1)
  private strips: THREE.Mesh[] = []
  private stripMats = new Map<string, THREE.MeshLambertMaterial>()
  private cellTops: THREE.Mesh[] = []
  private selFrame!: THREE.Mesh
  private houseGeo!: THREE.BoxGeometry
  private roofGeo!: THREE.ConeGeometry
  private hotelGeo!: THREE.BoxGeometry
  private houseMat!: THREE.MeshLambertMaterial
  private roofMat!: THREE.MeshLambertMaterial
  private hotelMat!: THREE.MeshLambertMaterial
  private maxAniso = 1

  // pions
  private pawns = new Map<string, Pawn>()
  private baseGeo!: THREE.CylinderGeometry
  private ringGeo!: THREE.RingGeometry
  private ringMat!: THREE.MeshBasicMaterial
  private jailTex!: THREE.CanvasTexture
  private pawnTex = new Map<string, THREE.Texture>()

  // dés
  private dice: THREE.Mesh[] = []
  private dieAnim: (DieAnim | null)[] = [null, null]
  private dieRest: THREE.Quaternion[] = [new THREE.Quaternion(), new THREE.Quaternion()]
  private rollUntil = 0
  private lastRollNo: number | null = null

  // cartes
  private decks: Record<DeckId, Deck> = {} as Record<DeckId, Deck>
  private card!: THREE.Group
  private cardFace = makeCardFace()
  private revealKey: string | null = null
  private revealT0 = 0
  private revealDeck: DeckId = 'hasard'
  private revealState: 'idle' | 'anim' | 'hold' | 'show' = 'idle'
  private showSince = 0

  // cagnotte des taxes
  private potGroup = new THREE.Group()
  private potLabel = makePotLabel()
  private potShown = -1
  private billGeo!: THREE.BoxGeometry
  private billEdge!: THREE.MeshLambertMaterial
  private billMats = new Map<Denom, THREE.Material[]>()
  private flights: BillFlight[] = []
  private lastTaxKey: number | null = null
  private lastPotKey: number | null = null
  private fxInit = false

  // caméra
  private cam = { tx: 0, ty: 0, tz: 0.5, yaw: 0, pitch: 1.0, dist: 22 }
  private camGoal = { tx: 0, ty: 0, tz: 0.5, yaw: 0, pitch: 1.0, dist: 22 }
  private user = { yaw: 0, pitch: 0, zoom: 1 }
  private userGoal = { yaw: 0, pitch: 0, zoom: 1 }
  private mode: CamMode = 'overview'

  private view: SceneView | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private gesture = { moved: 0, t0: 0, pinch: 0, lastTap: 0, lastTapX: 0, lastTapY: 0 }
  private tapTimer = 0
  private raycaster = new THREE.Raycaster()

  constructor(host: HTMLElement, opts: SceneOptions) {
    this.host = host
    this.opts = opts
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer = new THREE.WebGLRenderer({ antialias: dpr < 2, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(dpr)
    this.renderer.setClearColor(0x000000, 0)
    this.maxAniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy())
    const el = this.renderer.domElement
    el.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;outline:none'
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', 'Plateau 3D du Tour des Potes')
    host.appendChild(el)

    this.scene.add(this.root)
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(-6, 12, 8)
    this.scene.add(sun)

    this.buildBoard()
    this.buildDecks()
    this.buildDice()
    this.buildCard()
    this.buildPot()

    this.resize()
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(host)
    this.cleanups.push(() => ro.disconnect())
    const vis = () => {
      this.hidden = document.hidden
      if (!this.hidden) this.invalidate()
    }
    document.addEventListener('visibilitychange', vis)
    this.cleanups.push(() => document.removeEventListener('visibilitychange', vis))
    const lost = (e: Event) => {
      e.preventDefault()
      this.opts.onLost()
    }
    el.addEventListener('webglcontextlost', lost)
    this.cleanups.push(() => el.removeEventListener('webglcontextlost', lost))
    this.attachInput(el)
    this.snapCamera()
    this.invalidate()
  }

  /* ------------------------------ construction ------------------------------ */

  private track<T extends { dispose: () => void }>(x: T): T {
    this.disposables.push(x)
    return x
  }

  private buildBoard() {
    const atlas = this.track(makeBoardAtlas(this.maxAniso))
    const topMat = this.track(new THREE.MeshBasicMaterial({ map: atlas }))
    const sideMat = this.track(new THREE.MeshLambertMaterial({ color: 0xcdbf9c }))
    // socle
    const slabGeo = this.track(new THREE.BoxGeometry(BOARD_SIZE + 0.9, SLAB_H, BOARD_SIZE + 0.9))
    const slab = new THREE.Mesh(slabGeo, this.track(new THREE.MeshLambertMaterial({ color: 0x3a2f5c })))
    slab.position.y = -SLAB_H / 2
    this.root.add(slab)
    // centre (région de l'atlas)
    const cGeo = this.track(new THREE.PlaneGeometry(9, 9))
    cGeo.rotateX(-Math.PI / 2)
    setAtlasUV(cGeo, 1.5, 1.5, 9, 9)
    const centre = new THREE.Mesh(cGeo, topMat)
    centre.position.set(0, CENTER_H, 0)
    this.root.add(centre)
    // cases
    for (let i = 0; i < 40; i++) {
      const b = cellBox(i)
      const g = new THREE.Group()
      g.position.set(b.cx, 0, b.cz)
      const sGeo = this.track(new THREE.BoxGeometry(b.w - 0.004, CELL_H, b.d - 0.004))
      const side = new THREE.Mesh(sGeo, sideMat)
      side.position.y = CELL_H / 2
      g.add(side)
      const tGeo = this.track(new THREE.PlaneGeometry(b.w - 0.004, b.d - 0.004))
      tGeo.rotateX(-Math.PI / 2)
      setAtlasUV(tGeo, b.u, b.v, b.w, b.d)
      const top = new THREE.Mesh(tGeo, topMat)
      top.position.y = CELL_H + 0.002
      top.userData.cell = i
      g.add(top)
      this.cellTops.push(top)
      const bld = new THREE.Group()
      bld.position.y = CELL_H
      g.add(bld)
      this.bldGroups.push(bld)
      this.root.add(g)
      this.cellGroups.push(g)
    }
    // cadre de sélection
    const fGeo = this.track(new THREE.PlaneGeometry(1, 1))
    fGeo.rotateX(-Math.PI / 2)
    this.selFrame = new THREE.Mesh(fGeo, this.track(new THREE.MeshBasicMaterial({ color: 0xffd166 })))
    this.selFrame.visible = false
    this.root.add(this.selFrame)
    // bâtiments (géométries / matériaux partagés)
    this.houseGeo = this.track(new THREE.BoxGeometry(0.26, 0.22, 0.26))
    this.roofGeo = this.track(new THREE.ConeGeometry(0.22, 0.16, 4))
    this.hotelGeo = this.track(new THREE.BoxGeometry(0.7, 0.4, 0.3))
    this.houseMat = this.track(new THREE.MeshLambertMaterial({ color: 0x22c55e }))
    this.roofMat = this.track(new THREE.MeshLambertMaterial({ color: 0xef476f }))
    this.hotelMat = this.track(new THREE.MeshLambertMaterial({ color: 0xef476f }))
    // marques de propriétaire
    const stripGeo = this.track(new THREE.BoxGeometry(1, 0.07, 0.16))
    for (let i = 0; i < 40; i++) {
      const b = cellBox(i)
      const s = sideOf(i)
      if (s === 'corner') {
        this.strips.push(new THREE.Mesh())
        continue
      }
      const m = new THREE.Mesh(stripGeo, sideMat)
      const alongX = s === 'bottom' || s === 'top'
      const len = (alongX ? b.w : b.d) * 0.78
      m.scale.set(len, 1, 1)
      if (alongX) m.position.set(0, CELL_H + 0.025, (s === 'bottom' ? 1 : -1) * (b.d / 2 - 0.09))
      else {
        m.rotation.y = Math.PI / 2
        m.position.set((s === 'left' ? -1 : 1) * (b.w / 2 - 0.09), CELL_H + 0.025, 0)
      }
      m.visible = false
      this.cellGroups[i].add(m)
      this.strips.push(m)
    }
    // pions
    this.baseGeo = this.track(new THREE.CylinderGeometry(0.3, 0.34, 0.1, 20))
    this.ringGeo = this.track(new THREE.RingGeometry(0.36, 0.5, 28))
    this.ringGeo.rotateX(-Math.PI / 2)
    this.ringMat = this.track(new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.95, depthWrite: false }))
    this.jailTex = this.track(makeEmojiTex('🚔'))
  }

  private buildDecks() {
    const side = this.track(new THREE.MeshLambertMaterial({ map: this.track(makeStackSide()) }))
    const glowTex = this.track(makeGlow())
    const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    this.track(hitMat)
    for (const id of ['hasard', 'potes'] as DeckId[]) {
      const p = DECK_POS[id]
      const g = new THREE.Group()
      g.position.set(p.x, CENTER_H, p.z)
      g.rotation.y = p.yaw
      const back = this.track(new THREE.MeshBasicMaterial({ map: this.track(makeCardBack(id)) }))
      const stack = new THREE.Mesh(this.track(new THREE.BoxGeometry(CARD_W, DECK_H, CARD_D)), [side, side, back, side, side, side])
      stack.position.y = DECK_H / 2
      g.add(stack)
      const glowMat = this.track(new THREE.MeshBasicMaterial({ map: glowTex, color: DECK_COLOR[id], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
      const glowGeo = this.track(new THREE.PlaneGeometry(5.6, 6.4))
      glowGeo.rotateX(-Math.PI / 2)
      const glow = new THREE.Mesh(glowGeo, glowMat)
      glow.position.y = 0.03
      glow.visible = false
      g.add(glow)
      const hit = new THREE.Mesh(this.track(new THREE.BoxGeometry(CARD_W + 0.8, 1.2, CARD_D + 0.8)), hitMat)
      hit.position.y = 0.5
      hit.userData.deck = id
      g.add(hit)
      this.root.add(g)
      this.decks[id] = { id, group: g, stack, glow, glowMat, hit, cardRest: new THREE.Vector3(p.x, CENTER_H + DECK_H + 0.02, p.z) }
    }
  }

  private buildDice() {
    const faces = makeDieFaces().map((t) => this.track(t))
    const mats = faces.map((t) => this.track(new THREE.MeshLambertMaterial({ map: t })))
    const geo = this.track(new THREE.BoxGeometry(0.92, 0.92, 0.92))
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(geo, mats)
      m.visible = false
      this.root.add(m)
      this.dice.push(m)
    }
  }

  private buildCard() {
    const g = new THREE.Group()
    const geo = this.track(new THREE.PlaneGeometry(CARD_W, CARD_D))
    const frontMat = this.track(new THREE.MeshBasicMaterial({ map: this.track(this.cardFace.texture), transparent: true, alphaTest: 0.05 }))
    const front = new THREE.Mesh(geo, frontMat)
    const backTex = this.track(makeCardBack('hasard'))
    const backTex2 = this.track(makeCardBack('potes'))
    const backMat = this.track(new THREE.MeshBasicMaterial({ map: backTex, transparent: true, alphaTest: 0.05 }))
    const back = new THREE.Mesh(geo, backMat)
    back.rotation.y = Math.PI
    back.userData.tex = { hasard: backTex, potes: backTex2 }
    back.userData.mat = backMat
    g.add(front, back)
    g.visible = false
    this.scene.add(g)
    this.card = g
  }

  private buildPot() {
    this.billGeo = this.track(new THREE.BoxGeometry(BILL_W, BILL_H, BILL_D))
    this.billEdge = this.track(new THREE.MeshLambertMaterial({ color: 0x1f1b2e }))
    this.root.add(this.potGroup)
    const geo = this.track(new THREE.PlaneGeometry(2.7, 2.7 * (112 / 512)))
    geo.rotateX(-Math.PI / 2)
    const mat = this.track(new THREE.MeshBasicMaterial({ map: this.track(this.potLabel.texture), transparent: true, alphaTest: 0.05 }))
    const label = new THREE.Mesh(geo, mat)
    label.position.set(POT_POS.x, CENTER_H + 0.012, POT_LABEL_Z)
    this.root.add(label)
  }

  /** Matériaux d'un billet (face imprimée dessus / dessous, tranche sombre), créés à la demande. */
  private billMat(d: Denom): THREE.Material[] {
    let m = this.billMats.get(d)
    if (!m) {
      const face = this.track(new THREE.MeshBasicMaterial({ map: this.track(makeBillTex(d)) }))
      m = [this.billEdge, this.billEdge, face, face, this.billEdge, this.billEdge]
      this.billMats.set(d, m)
    }
    return m
  }

  /* ------------------------------ état externe ------------------------------ */

  update(v: SceneView) {
    if (this.disposed) return
    const prev = this.view
    this.view = v
    this.syncPawns(v)
    if (!prev || prev.ownerColor !== v.ownerColor) this.syncOwners(v)
    if (!prev || prev.levels !== v.levels) this.syncBuildings(v)
    // sélection
    if (!prev || prev.selected !== v.selected) {
      if (v.selected === null) this.selFrame.visible = false
      else {
        const b = cellBox(v.selected)
        this.selFrame.visible = true
        this.selFrame.scale.set(b.w + 0.16, 1, b.d + 0.16)
        this.selFrame.position.set(b.cx, CELL_H + 0.012, b.cz)
      }
    }
    // dés
    if (this.lastRollNo === null) {
      this.lastRollNo = v.rollNo
      this.placeDiceAtRest(v.dice)
    } else if (v.rollNo !== this.lastRollNo) {
      this.lastRollNo = v.rollNo
      if (v.dice) this.throwDice(v.dice)
    } else if (!this.dieAnim[0] && prev?.dice?.[0] !== v.dice?.[0]) {
      this.placeDiceAtRest(v.dice)
    }
    // carte piochée
    if (v.reveal && v.reveal.key !== this.revealKey) this.startReveal(v.reveal)
    // cagnotte des taxes (au montage : rien n'est rejoué)
    if (v.taxPot !== this.potShown) this.syncPot(v.taxPot)
    const taxKey = v.taxFx?.key ?? null
    const potKey = v.potFx?.key ?? null
    if (this.fxInit) {
      if (v.taxFx && taxKey !== this.lastTaxKey) this.startTax(v.taxFx)
      if (v.potFx && potKey !== this.lastPotKey) this.startPot(v.potFx, prev?.taxPot ?? 0)
    }
    this.fxInit = true
    this.lastTaxKey = taxKey ?? this.lastTaxKey
    this.lastPotKey = potKey ?? this.lastPotKey
    this.invalidate()
  }

  resetCamera() {
    this.userGoal = { yaw: 0, pitch: 0, zoom: 1 }
    this.invalidate()
  }

  private syncPawns(v: SceneView) {
    const alive = new Set(v.players.map((p) => p.id))
    for (const [id, pw] of this.pawns) {
      if (!alive.has(id)) {
        this.root.remove(pw.group)
        pw.sprite.material.dispose()
        ;(pw.base.material as THREE.Material).dispose()
        pw.jail.material.dispose()
        this.pawns.delete(id)
      }
    }
    const byCell = new Map<number, string[]>()
    for (const p of v.players) {
      if (v.bankrupt.includes(p.id)) continue
      const c = v.pos[p.id] ?? 0
      byCell.set(c, [...(byCell.get(c) ?? []), p.id])
    }
    for (const p of v.players) {
      let pw = this.pawns.get(p.id)
      if (!pw) {
        pw = this.makePawn(p)
        this.pawns.set(p.id, pw)
        this.root.add(pw.group)
        const c = v.pos[p.id] ?? 0
        const b = cellBox(c)
        pw.group.position.set(b.cx, CELL_H, b.cz)
      }
      const out = v.bankrupt.includes(p.id)
      pw.group.visible = !out
      pw.jail.visible = v.jail.includes(p.id)
      pw.ring.visible = v.turn === p.id
    }
    for (const [c, ids] of byCell) {
      const b = cellBox(c)
      const slots = pawnSlots(ids.length, b.w, b.d)
      ids.forEach((id, j) => {
        const pw = this.pawns.get(id)
        if (!pw) return
        pw.tx = b.cx + slots[j].dx
        pw.tz = b.cz + slots[j].dz
        pw.scale = slots[j].scale
      })
    }
  }

  private makePawn(p: ScenePlayer): Pawn {
    const group = new THREE.Group()
    const baseMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(p.color) })
    const base = new THREE.Mesh(this.baseGeo, baseMat)
    base.position.y = 0.05
    group.add(base)
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat)
    ring.position.y = 0.012
    ring.visible = false
    group.add(ring)
    const mat = new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.05, depthWrite: true })
    const sprite = new THREE.Sprite(mat)
    sprite.center.set(0.5, 0)
    sprite.scale.set(1.15, 1.15, 1)
    sprite.position.y = 0.1
    group.add(sprite)
    const jail = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.jailTex, transparent: true, depthTest: false }))
    jail.scale.set(0.45, 0.45, 1)
    jail.position.set(0.32, 0.45, 0)
    jail.visible = false
    jail.renderOrder = 5
    group.add(jail)
    this.loadPawnTexture(p, mat)
    return { id: p.id, group, sprite, base, ring, jail, tx: 0, tz: 0, scale: 1, curScale: 1, color: p.color }
  }

  private loadPawnTexture(p: ScenePlayer, mat: THREE.SpriteMaterial) {
    const urls = [chibiUrl(p.slug, p.expression, p.tenue, true), chibiUrl(p.slug, 'joie', 'default', true)]
    const apply = (t: THREE.Texture) => {
      if (this.disposed) return
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 1
      mat.map = t
      mat.needsUpdate = true
      this.invalidate()
    }
    const cached = this.pawnTex.get(urls[0])
    if (cached) return apply(cached)
    const loader = new THREE.TextureLoader()
    const tryLoad = (k: number) => {
      loader.load(
        urls[k],
        (t) => {
          if (this.disposed) {
            t.dispose()
            return
          }
          this.pawnTex.set(urls[0], t)
          this.disposables.push(t)
          apply(t)
        },
        undefined,
        () => {
          if (k + 1 < urls.length) tryLoad(k + 1)
        },
      )
    }
    tryLoad(0)
  }

  private syncOwners(v: SceneView) {
    for (let i = 0; i < 40; i++) {
      const m = this.strips[i]
      const col = v.ownerColor[i]
      if (!col || !m.geometry.type) {
        m.visible = false
        continue
      }
      let mat = this.stripMats.get(col)
      if (!mat) {
        mat = this.track(new THREE.MeshLambertMaterial({ color: new THREE.Color(col) }))
        this.stripMats.set(col, mat)
      }
      m.material = mat
      m.visible = true
    }
  }

  private syncBuildings(v: SceneView) {
    for (let i = 0; i < 40; i++) {
      const lvl = v.levels[i] ?? 0
      if (this.bldLevel[i] === lvl) continue
      this.bldLevel[i] = lvl
      const g = this.bldGroups[i]
      g.clear()
      if (lvl <= 0 || BOARD[i].type !== 'quartier') continue
      const b = cellBox(i)
      const s = sideOf(i)
      const alongX = s === 'bottom' || s === 'top'
      const off = (alongX ? b.d : b.w) * 0.16
      const bandPos = s === 'bottom' ? -b.d / 2 + off : s === 'top' ? b.d / 2 - off : s === 'left' ? b.w / 2 - off : -b.w / 2 + off
      const place = (m: THREE.Object3D, along: number, y: number) => {
        if (alongX) m.position.set(along, y, bandPos)
        else m.position.set(bandPos, y, along)
        g.add(m)
      }
      if (lvl >= 5) {
        const h = new THREE.Mesh(this.hotelGeo, this.hotelMat)
        if (!alongX) h.rotation.y = Math.PI / 2
        place(h, 0, 0.2)
      } else {
        const step = 0.3
        for (let k = 0; k < lvl; k++) {
          const along = (k - (lvl - 1) / 2) * step
          const body = new THREE.Mesh(this.houseGeo, this.houseMat)
          place(body, along, 0.11)
          const roof = new THREE.Mesh(this.roofGeo, this.roofMat)
          roof.rotation.y = Math.PI / 4
          place(roof, along, 0.3)
        }
      }
    }
  }

  /* ------------------------------ cagnotte des taxes ------------------------------ */

  private syncPot(pot: number) {
    this.potShown = pot
    this.potLabel.draw(`Cagnotte : ${pot.toLocaleString('fr-FR')} €`)
    this.potGroup.clear()
    potBills(pot, POT_MAX).forEach((d, k) => {
      const s = potSlot(k)
      const m = new THREE.Mesh(this.billGeo, this.billMat(d))
      m.position.set(s.x, s.y, s.z)
      m.rotation.y = s.yaw
      this.potGroup.add(m)
    })
    // les billets d'une taxe déjà posés font maintenant partie du tas
    this.flights = this.flights.filter((f) => {
      if (f.keep && f.landed) this.root.remove(f.mesh)
      return !(f.keep && f.landed)
    })
  }

  private pawnTop(id: string): THREE.Vector3 | null {
    const pw = this.pawns.get(id)
    return pw ? new THREE.Vector3(pw.group.position.x, CELL_H + 0.7, pw.group.position.z) : null
  }

  private addFlight(d: Denom, from: THREE.Vector3, to: THREE.Vector3, t0: number, dur: number, keep: boolean, k: number) {
    const mesh = new THREE.Mesh(this.billGeo, this.billMat(d))
    mesh.visible = false
    mesh.userData.yaw = potSlot(k).yaw
    this.root.add(mesh)
    this.flights.push({ mesh, t0, dur, from, to, spin: (k % 2 ? -1 : 1) * (Math.PI * 2 + k * 0.4), keep, landed: false })
  }

  /** Taxe : les billets partent du pion et se posent sur le tas. */
  private startTax(fx: SceneMoneyFx) {
    const from = this.pawnTop(fx.player)
    if (!from) return
    const bills = billsFor(fx.amount, 4, 6)
    const now = performance.now()
    const gap = 90
    const dur = Math.max(400, this.opts.taxMs - 100 - (bills.length - 1) * gap)
    const base = Math.min(POT_MAX, this.potGroup.children.length)
    bills.forEach((d, i) => {
      const s = potSlot(Math.min(POT_MAX, base + i))
      this.addFlight(d, from.clone(), new THREE.Vector3(s.x, s.y, s.z), now + i * gap, dur, true, base + i)
    })
  }

  /** Cagnotte ramassée : les billets du tas s'envolent vers le pion. */
  private startPot(fx: SceneMoneyFx, potBefore: number) {
    const to = this.pawnTop(fx.player)
    if (!to) return
    const bills = billsFor(Math.max(fx.amount, potBefore), 5, 10)
    const now = performance.now()
    bills.forEach((d, i) => {
      const s = potSlot(bills.length - 1 - i)
      this.addFlight(d, new THREE.Vector3(s.x, s.y, s.z), to.clone(), now + i * 80, 750, false, i)
    })
  }

  private tickFlights(now: number): boolean {
    if (!this.flights.length) return false
    this.flights = this.flights.filter((f) => {
      const t = (now - f.t0) / f.dur
      if (t < 0) return true
      if (t >= 1) {
        // filet : un billet posé ne reste pas si le tas n'est jamais mis à jour
        if (f.keep && now - f.t0 - f.dur < 1500) {
          f.landed = true
          f.mesh.visible = true
          f.mesh.position.copy(f.to)
          f.mesh.rotation.set(0, f.mesh.userData.yaw as number, 0)
          f.mesh.scale.setScalar(1)
          return true
        }
        this.root.remove(f.mesh)
        return false
      }
      const k = easeInOut(t)
      f.mesh.visible = true
      f.mesh.position.lerpVectors(f.from, f.to, k)
      f.mesh.position.y += Math.sin(Math.PI * k) * 2.1
      f.mesh.rotation.set(Math.sin(Math.PI * k) * 0.9, (f.mesh.userData.yaw as number) + f.spin * (1 - k), Math.sin(Math.PI * k) * 0.5 * Math.sign(f.spin))
      f.mesh.scale.setScalar(f.keep ? 0.55 + 0.45 * k + 0.25 * Math.sin(Math.PI * k) : 1 - 0.45 * k + 0.25 * Math.sin(Math.PI * k))
      return true
    })
    return this.flights.length > 0
  }

  /* ------------------------------ dés ------------------------------ */

  private faceQ(v: number): THREE.Quaternion {
    const e = new THREE.Euler()
    if (v === 6) e.set(Math.PI, 0, 0)
    else if (v === 3) e.set(0, 0, Math.PI / 2)
    else if (v === 4) e.set(0, 0, -Math.PI / 2)
    else if (v === 2) e.set(-Math.PI / 2, 0, 0)
    else if (v === 5) e.set(Math.PI / 2, 0, 0)
    return new THREE.Quaternion().setFromEuler(e)
  }

  private restQuat(v: number, k: number, seed: number): THREE.Quaternion {
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(seed * 12.9898 + k * 78.233) * 0.5)
    return yaw.multiply(this.faceQ(v))
  }

  private placeDiceAtRest(d: [number, number] | null) {
    this.dice.forEach((m, k) => {
      m.visible = !!d
      if (!d) return
      this.dieAnim[k] = null
      this.dieRest[k] = this.restQuat(d[k], k, d[0] * 7 + d[1])
      m.quaternion.copy(this.dieRest[k])
      m.position.set(DICE_REST[k][0], CENTER_H + 0.46, DICE_REST[k][1])
    })
  }

  private throwDice(d: [number, number]) {
    const now = performance.now()
    this.rollUntil = now + this.opts.rollMs
    this.dice.forEach((m, k) => {
      m.visible = true
      this.dieRest[k] = this.restQuat(d[k], k, now * 0.001 + k)
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      this.dieAnim[k] = {
        t0: now + k * 70,
        from: new THREE.Vector3(DICE_REST[k][0] + (k ? 2.2 : -2.2), 3.4 + k * 0.5, 4.6),
        axis,
        turns: (3 + k) * Math.PI * 2 + Math.random() * 2,
      }
    })
  }

  private tickDice(now: number): boolean {
    let busy = false
    this.dice.forEach((m, k) => {
      const a = this.dieAnim[k]
      if (!a) return
      const t = (now - a.t0) / (this.opts.rollMs - k * 70)
      if (t >= 1) {
        this.dieAnim[k] = null
        m.position.set(DICE_REST[k][0], CENTER_H + 0.46, DICE_REST[k][1])
        m.quaternion.copy(this.dieRest[k])
        return
      }
      busy = true
      const tt = Math.max(0, t)
      const rest = new THREE.Vector3(DICE_REST[k][0], CENTER_H + 0.46, DICE_REST[k][1])
      const pp = easeOut(tt / 0.72)
      const x = a.from.x + (rest.x - a.from.x) * pp
      const z = a.from.z + (rest.z - a.from.z) * pp
      // chute puis deux rebonds
      let y: number
      if (tt < 0.46) y = rest.y + (a.from.y - rest.y) * (1 - Math.pow(tt / 0.46, 2))
      else if (tt < 0.76) y = rest.y + 0.9 * (1 - Math.pow(((tt - 0.46) / 0.3) * 2 - 1, 2))
      else if (tt < 0.92) y = rest.y + 0.28 * (1 - Math.pow(((tt - 0.76) / 0.16) * 2 - 1, 2))
      else y = rest.y
      m.position.set(x, y, z)
      const spin = new THREE.Quaternion().setFromAxisAngle(a.axis, a.turns * Math.pow(1 - easeOut(tt / 0.9), 1.2))
      m.quaternion.copy(spin).multiply(this.dieRest[k])
    })
    return busy
  }

  /* ------------------------------ pioche ------------------------------ */

  private startReveal(r: SceneReveal) {
    this.revealKey = r.key
    this.revealDeck = r.deck
    this.cardFace.draw(r)
    const back = this.card.children[1] as THREE.Mesh
    const mat = back.userData.mat as THREE.MeshBasicMaterial
    mat.map = (back.userData.tex as Record<DeckId, THREE.Texture>)[r.deck]
    mat.needsUpdate = true
    this.revealT0 = performance.now()
    this.revealState = 'anim'
    this.card.visible = true
    this.card.position.copy(this.decks[r.deck].cardRest)
  }

  private tickCard(now: number): boolean {
    if (this.revealState === 'idle') return false
    const v = this.view
    const elapsed = now - this.revealT0
    const D = this.opts.drawMs
    const deck = this.decks[this.revealDeck]
    const yaw = DECK_POS[this.revealDeck].yaw
    const qRest = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ'))
    // ordre YXZ : yaw puis rotation autour de X → face vers le bas, dos visible
    const p0 = deck.cardRest
    const p1 = new THREE.Vector3(p0.x, p0.y + 1.5, p0.z + 0.3)
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
    const p2 = this.camera.position.clone().addScaledVector(camFwd, 4.5).addScaledVector(camUp, -0.1)
    const lift = 0.22
    const fly = Math.min(1, D / 1000)
    if (elapsed < D * lift) {
      const k = easeOut(elapsed / (D * lift))
      this.card.position.lerpVectors(p0, p1, k)
      this.card.quaternion.copy(qRest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(k * Math.PI) * 0.12))
    } else {
      const k = easeInOut((elapsed - D * lift) / (D * (0.8 - lift) * fly))
      this.card.position.lerpVectors(p1, p2, k)
      // le tas pivote jusqu'à la caméra ; arc latéral pour un retournement lisible
      this.card.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), Math.sin(k * Math.PI) * 0.5)
      this.card.quaternion.copy(qRest).slerp(this.camera.quaternion, k)
      const s = 1 - 0.12 * k
      this.card.scale.setScalar(s)
    }
    if (elapsed >= D && this.revealState === 'anim') this.revealState = 'hold'
    if (this.revealState === 'hold') {
      if (v?.cardShowing) {
        this.revealState = 'show'
        this.showSince = now
        this.card.visible = false
      } else if (elapsed > D + 3000) {
        // l'overlay n'est jamais venu : on rend la main
        this.card.visible = false
        this.revealState = 'idle'
      } else {
        // flottement léger face caméra
        this.card.position.y += Math.sin(now * 0.004) * 0.04
      }
    } else if (this.revealState === 'show') {
      if (!v?.cardShowing && now - this.showSince > 250) this.revealState = 'idle'
      else if (now - this.showSince > 12000) this.revealState = 'idle'
    }
    return this.revealState !== 'idle'
  }

  /* ------------------------------ caméra ------------------------------ */

  private get aspect() {
    return this.width / Math.max(1, this.height)
  }

  private fitDist() {
    const t = Math.tan((FOV * Math.PI) / 360)
    return Math.max(6.6 / t, 8.0 / (t * this.aspect))
  }

  private computeMode(now: number): CamMode {
    const v = this.view
    if (!v) return 'overview'
    if (this.revealState !== 'idle') return 'deck'
    if (now < this.rollUntil) return 'overview'
    if (v.moving && this.pawns.get(v.moving)) return 'follow'
    if (v.deckFocus) return 'deck'
    return 'overview'
  }

  private updateGoal(now: number) {
    const m = this.computeMode(now)
    if (m !== this.mode) {
      this.mode = m
      this.userGoal = { yaw: 0, pitch: 0, zoom: 1 }
    }
    const g = this.camGoal
    const fit = this.fitDist()
    if (m === 'overview') {
      Object.assign(g, { tx: 0, ty: 0, tz: 0.6, pitch: 1.02, dist: fit })
    } else if (m === 'follow' && this.view?.moving) {
      const pw = this.pawns.get(this.view.moving)
      if (pw) Object.assign(g, { tx: pw.group.position.x * 0.9, ty: 0.3, tz: pw.group.position.z * 0.9 + 0.4, pitch: 0.92, dist: fit * 0.52 })
    } else {
      const id = this.revealState !== 'idle' ? this.revealDeck : (this.view?.deckFocus ?? 'hasard')
      const p = DECK_POS[id]
      const t = Math.tan((FOV * Math.PI) / 360)
      Object.assign(g, { tx: p.x, ty: 0.5, tz: p.z + 1.5, pitch: 0.98, dist: Math.max(6.5 / t / 1.9, 3.9 / (t * this.aspect)) })
    }
  }

  private stepCamera(dt: number): boolean {
    const rate = this.mode === 'follow' ? 2.6 : 3.6
    const a = 1 - Math.exp(-dt * rate)
    const u = 1 - Math.exp(-dt * 7)
    let moving = false
    const c = this.cam
    const g = this.camGoal
    for (const k of ['tx', 'ty', 'tz', 'pitch', 'dist'] as const) {
      const d = g[k] - c[k]
      if (Math.abs(d) > 0.002) moving = true
      c[k] += d * a
    }
    for (const k of ['yaw', 'pitch', 'zoom'] as const) {
      const d = this.userGoal[k] - this.user[k]
      if (Math.abs(d) > 0.0005) moving = true
      this.user[k] += d * u
    }
    this.applyCamera()
    return moving
  }

  private applyCamera() {
    const c = this.cam
    const yaw = c.yaw + this.user.yaw
    const pitch = clamp(c.pitch + this.user.pitch, 0.35, 1.35)
    const dist = c.dist * this.user.zoom
    const cp = Math.cos(pitch)
    this.camera.position.set(c.tx + dist * Math.sin(yaw) * cp, c.ty + dist * Math.sin(pitch), c.tz + dist * Math.cos(yaw) * cp)
    this.camera.lookAt(c.tx, c.ty, c.tz)
  }

  private snapCamera() {
    this.updateGoal(performance.now())
    Object.assign(this.cam, this.camGoal)
    this.applyCamera()
    this.camera.updateMatrixWorld()
  }

  /* ------------------------------ entrées ------------------------------ */

  private attachInput(el: HTMLCanvasElement) {
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId)
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.pointers.size === 1) {
        this.gesture.moved = 0
        this.gesture.t0 = performance.now()
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()]
        this.gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y)
        this.gesture.moved = 99
      }
    }
    const move = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      if (this.pointers.size === 1) {
        this.gesture.moved += Math.abs(dx) + Math.abs(dy)
        if (this.gesture.moved > 8) {
          this.userGoal.yaw = clamp(this.userGoal.yaw - dx * 0.006, -0.7, 0.7)
          this.userGoal.pitch = clamp(this.userGoal.pitch + dy * 0.004, -0.25, 0.3)
          this.user.yaw = this.userGoal.yaw
          this.user.pitch = this.userGoal.pitch
          this.invalidate()
        }
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (this.gesture.pinch > 0 && d > 0) {
          this.userGoal.zoom = clamp(this.userGoal.zoom * (this.gesture.pinch / d), 0.5, 1.3)
          this.user.zoom = this.userGoal.zoom
          this.invalidate()
        }
        this.gesture.pinch = d
      }
    }
    const up = (e: PointerEvent) => {
      const had = this.pointers.has(e.pointerId)
      this.pointers.delete(e.pointerId)
      if (!had || this.pointers.size > 0) return
      const now = performance.now()
      if (this.gesture.moved < 8 && now - this.gesture.t0 < 600) this.onTap(e.clientX, e.clientY, now)
    }
    const cancel = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId)
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      this.userGoal.zoom = clamp(this.userGoal.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.5, 1.3)
      this.invalidate()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    el.addEventListener('wheel', wheel, { passive: false })
    this.cleanups.push(() => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      el.removeEventListener('wheel', wheel)
      window.clearTimeout(this.tapTimer)
    })
  }

  private pick(cx: number, cy: number): { cell?: number; deck?: DeckId } | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -(((cy - r.top) / r.height) * 2 - 1))
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(ndc, this.camera)
    const targets: THREE.Object3D[] = [this.decks.hasard.hit, this.decks.potes.hit, ...this.cellTops]
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit) return null
    if (hit.object.userData.deck) return { deck: hit.object.userData.deck as DeckId }
    return { cell: hit.object.userData.cell as number }
  }

  private onTap(x: number, y: number, now: number) {
    const g = this.gesture
    // double-tap : recentrer la caméra
    if (now - g.lastTap < 320 && Math.hypot(x - g.lastTapX, y - g.lastTapY) < 36) {
      window.clearTimeout(this.tapTimer)
      g.lastTap = 0
      this.resetCamera()
      return
    }
    g.lastTap = now
    g.lastTapX = x
    g.lastTapY = y
    const hit = this.pick(x, y)
    if (hit?.deck) {
      // piocher : réaction immédiate
      if (this.view?.canDraw && this.view.deckFocus === hit.deck) {
        g.lastTap = 0
        this.opts.onDeck(hit.deck)
      }
      return
    }
    if (hit?.cell === undefined) return
    const cell = hit.cell
    window.clearTimeout(this.tapTimer)
    this.tapTimer = window.setTimeout(() => this.opts.onCell(cell), 270)
  }

  /* ------------------------------ boucle ------------------------------ */

  private resize() {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.width = w
    this.height = h
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.invalidate()
  }

  invalidate() {
    if (this.disposed || this.raf || this.hidden) return
    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (t: number) => {
    this.raf = 0
    if (this.disposed || this.hidden) return
    const dt = clamp((t - this.lastT) / 1000, 0.001, 0.05)
    this.lastT = t
    const now = performance.now()
    let busy = false

    this.updateGoal(now)
    busy = this.stepCamera(dt) || busy
    busy = this.tickDice(now) || busy
    const wasReveal = this.revealState !== 'idle'
    busy = this.tickCard(now) || busy
    if (wasReveal && this.revealState === 'idle') busy = true // la caméra doit repartir
    busy = this.tickPawns(dt) || busy
    busy = this.tickFlights(now) || busy
    busy = this.tickDecks(now) || busy
    busy = this.tickCells(dt) || busy
    if (now < this.rollUntil) busy = true

    this.renderer.render(this.scene, this.camera)
    if (busy) this.raf = requestAnimationFrame(this.frame)
  }

  private tickPawns(dt: number): boolean {
    let busy = false
    const a = 1 - Math.exp(-dt * 16)
    for (const pw of this.pawns.values()) {
      const p = pw.group.position
      const dx = pw.tx - p.x
      const dz = pw.tz - p.z
      const dist = Math.hypot(dx, dz)
      if (dist > 0.004) {
        busy = true
        p.x += dx * a
        p.z += dz * a
        p.y = CELL_H + Math.min(0.42, dist * 0.55)
      } else {
        p.x = pw.tx
        p.z = pw.tz
        p.y = CELL_H
      }
      const ds = pw.scale - pw.curScale
      if (Math.abs(ds) > 0.002) {
        busy = true
        pw.curScale += ds * a
        pw.group.scale.setScalar(pw.curScale)
      } else if (pw.curScale !== pw.scale) {
        pw.curScale = pw.scale
        pw.group.scale.setScalar(pw.scale)
      }
    }
    return busy
  }

  private tickDecks(now: number): boolean {
    const v = this.view
    let busy = false
    for (const id of ['hasard', 'potes'] as DeckId[]) {
      const d = this.decks[id]
      const on = !!v?.deckFocus && v.deckFocus === id && this.revealState === 'idle'
      if (on) {
        busy = true
        const s = 0.5 + 0.5 * Math.sin(now * 0.006)
        d.glow.visible = true
        d.glowMat.opacity = 0.35 + 0.5 * s
        d.group.scale.setScalar(1 + 0.035 * s)
        d.group.position.y = CENTER_H + 0.08 * s
      } else if (d.glow.visible || d.group.scale.x !== 1) {
        d.glow.visible = false
        d.group.scale.setScalar(1)
        d.group.position.y = CENTER_H
      }
    }
    return busy
  }

  private tickCells(dt: number): boolean {
    let busy = false
    const a = 1 - Math.exp(-dt * 14)
    for (let i = 0; i < 40; i++) {
      const want = this.view?.selected === i ? 0.12 : 0
      const d = want - this.cellRaise[i]
      if (Math.abs(d) > 0.001) {
        busy = true
        this.cellRaise[i] += d * a
        this.cellGroups[i].position.y = this.cellRaise[i]
      } else if (this.cellRaise[i] !== want) {
        this.cellRaise[i] = want
        this.cellGroups[i].position.y = want
      }
    }
    return busy
  }

  /* ------------------------------ fin ------------------------------ */

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    for (const c of this.cleanups) c()
    for (const pw of this.pawns.values()) {
      pw.sprite.material.dispose()
      ;(pw.base.material as THREE.Material).dispose()
      pw.jail.material.dispose()
    }
    for (const d of this.disposables) d.dispose()
    this.cardFace.texture.dispose()
    this.flights = []
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}

/** Remappe les UV d'un plan sur une région (en unités plateau) de l'atlas. */
function setAtlasUV(geo: THREE.BufferGeometry, u: number, v: number, w: number, d: number) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    const px = uv.getX(i)
    const py = uv.getY(i)
    uv.setXY(i, (u + px * w) / BOARD_SIZE, 1 - (v + (1 - py) * d) / BOARD_SIZE)
  }
  uv.needsUpdate = true
}

/** Attend la police d'affichage (texte des textures canvas) puis crée la scène. */
export async function createScene(host: HTMLElement, opts: SceneOptions): Promise<TdpScene> {
  try {
    await Promise.race([document.fonts.load('800 32px "Baloo 2"'), new Promise((r) => setTimeout(r, 1500))])
  } catch {
    /* police absente : repli système */
  }
  return new TdpScene(host, opts)
}

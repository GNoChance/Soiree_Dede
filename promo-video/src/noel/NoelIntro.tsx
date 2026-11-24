// Vidéo d'annonce « Noël chez Dédé » (composition `NoelIntro`) : Kéké en Père Noël présente l'événement en 6 temps.
// Textes et durées : script.ts. Même cadre que les tutos (720×1280, 30 FPS), même boîte à outils (tuto/kit).
// Zones à ne pas charger : coin haut-droit (bouton « Passer » de l'appli) et bas-centre sous y ≈ 1150 (bouton 🔊).
import React from 'react'
import { AbsoluteFill, Img, Sequence, random, staticFile, useCurrentFrame } from 'remotion'
import { Audio } from '@remotion/media'
import { C, DISPLAY, sticker, type Slug } from '../theme'
import { Avatar, Bubble, Chibi, ConfettiBurst, Outlined, Panel, Pill, Pop, SPRING, Sfx, TH, TW, bob, clamp01, easeIn, easeInOut, lerp, nb, ramp, sec, sp, wiggle } from '../tuto/kit'
import { MUSIC_VOLUME, NOEL, NOEL_ORDER, type NoelPartId } from './script'

type Scene = React.FC<{ f: number; dur: number }>

const DUR = Object.fromEntries(NOEL_ORDER.map((id) => [id, sec(NOEL[id].seconds)])) as Record<NoelPartId, number>
const STARTS = NOEL_ORDER.map((_, k) => NOEL_ORDER.slice(0, k).reduce((n, id) => n + DUR[id], 0))
export const NOEL_INTRO_FRAMES = NOEL_ORDER.reduce((n, id) => n + DUR[id], 0)

/** Rouge / vert / or de Noël. */
const N = { red: '#d62839', green: '#1b8a5a', gold: '#ffc93c', cream: '#fff6e5' }
const BG: Record<NoelPartId, string> = { accroche: N.green, missions: N.red, hotte: N.green, pass: N.red, grandeHotte: N.green, fin: N.red }

// ---------------------------------------------------------------------------
// Décor permanent : fond qui change de couleur à chaque temps, neige, guirlande, sol enneigé.
// ---------------------------------------------------------------------------
const Backdrop: React.FC<{ f: number }> = ({ f }) => {
  const k = STARTS.reduce((cur, s, i) => (f >= s ? i : cur), 0)
  // Rideau rond : la couleur du temps qui commence s'ouvre depuis le centre.
  const open = easeInOut(ramp(f - STARTS[k], 0, 14))
  return (
    <AbsoluteFill style={{ background: BG[NOEL_ORDER[Math.max(0, k - 1)]], overflow: 'hidden' }}>
      {k > 0 && <AbsoluteFill style={{ background: BG[NOEL_ORDER[k]], clipPath: `circle(${open * 830}px at 50% 55%)` }} />}
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 40%, rgba(255,255,255,0.24), rgba(255,255,255,0) 64%)' }} />
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.1) 3px, transparent 3.6px)', backgroundSize: '40px 40px' }} />
    </AbsoluteFill>
  )
}

/** Flocon à 6 branches (avec contour d'encre façon sticker si `outline`). */
const Flake: React.FC<{ size: number; outline?: boolean; style?: React.CSSProperties }> = ({ size, outline, style }) => (
  <svg width={size} height={size} viewBox="-50 -50 100 100" style={{ display: 'block', ...style }}>
    {(outline ? [C.ink, '#ffffff'] : ['#ffffff']).map((stroke) => (
      <g key={stroke} stroke={stroke} strokeWidth={stroke === C.ink ? 22 : 10} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {[0, 60, 120].map((a) => (
          <g key={a} transform={`rotate(${a})`}>
            <line x1={0} y1={-36} x2={0} y2={36} />
            <path d="M-11,-32 L0,-21 L11,-32 M-11,32 L0,21 L11,32" />
          </g>
        ))}
      </g>
    ))}
  </svg>
)

const SNOW = Array.from({ length: 20 }, (_, k) => ({
  x: random(`nx${k}`) * TW,
  y: random(`ny${k}`) * TH,
  s: 9 + random(`ns${k}`) * 13,
  v: 1.3 + random(`nv${k}`) * 1.7,
  big: k % 4 === 0,
}))
/** Neige lente (peu de flocons : un fond calme se compresse bien). */
const Snow: React.FC<{ f: number }> = ({ f }) => (
  <AbsoluteFill style={{ overflow: 'hidden' }}>
    {SNOW.map((c, k) => {
      const y = ((c.y + f * c.v) % (TH + 80)) - 40
      const x = c.x + Math.sin((f + k * 37) / 34) * 18
      return c.big ? (
        <Flake key={k} size={c.s * 2.4} style={{ position: 'absolute', left: x, top: y, opacity: 0.85, transform: `rotate(${f * 0.7 + k * 40}deg)` }} />
      ) : (
        <div key={k} style={{ position: 'absolute', left: x, top: y, width: c.s, height: c.s, borderRadius: '50%', background: '#ffffff', opacity: 0.8 }} />
      )
    })}
  </AbsoluteFill>
)

const BULBS = [N.gold, '#ffffff', C.sky, C.bubblegum]
const GARLAND = (() => {
  const xs = [-10, 175, 360, 545, 730]
  const bulbs: { x: number; y: number }[] = []
  let d = `M${xs[0]},8`
  for (let i = 0; i < xs.length - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2
    d += ` Q${cx},118 ${xs[i + 1]},8`
    for (const t of [0.2, 0.4, 0.6, 0.8]) bulbs.push({ x: (1 - t) ** 2 * xs[i] + 2 * (1 - t) * t * cx + t * t * xs[i + 1], y: 8 + 2 * (1 - t) * t * 110 })
  }
  return { d, bulbs }
})()
/** Guirlande lumineuse en haut du cadre : une ampoule sur deux s'allume, puis l'autre. */
const Garland: React.FC<{ f: number }> = ({ f }) => (
  <svg width={TW} height={130} style={{ position: 'absolute', left: 0, top: 0 }}>
    <path d={GARLAND.d} stroke={C.ink} strokeWidth={6} fill="none" />
    {GARLAND.bulbs.map((b, k) => {
      const on = (k + Math.floor(f / 15)) % 2 === 0
      return (
        <g key={k} transform={`translate(${b.x},${b.y})`}>
          {on && <circle cy={18} r={25} fill="#ffffff" opacity={0.3} />}
          <rect x={-6} y={-3} width={12} height={10} rx={2} fill={C.ink} />
          <ellipse cy={20} rx={12} ry={16} fill={BULBS[k % BULBS.length]} stroke={C.ink} strokeWidth={4} />
          {!on && <ellipse cy={20} rx={10} ry={14} fill={C.ink} opacity={0.2} />}
        </g>
      )
    })}
  </svg>
)

const Ground: React.FC = () => (
  <svg width={TW} height={90} style={{ position: 'absolute', left: 0, top: TH - 90 }}>
    <path d="M-10,40 Q90,4 200,30 T420,26 T620,22 T740,34 L740,100 L-10,100 Z" fill="#ffffff" stroke={C.ink} strokeWidth={5} />
  </svg>
)

// ---------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------
/** Sortie commune : la scène s'envole vers le haut sur ses 7 dernières frames. */
const Shell: React.FC<{ f: number; dur: number; children?: React.ReactNode }> = ({ f, dur, children }) => {
  const out = easeIn(ramp(f, dur - 7, dur))
  return <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 90}px)` }}>{children}</AbsoluteFill>
}

/** Arrivée d'une grande image (0 → 1), à peine rebondie. */
const rise = (f: number, at: number) => sp(f, at, { stiffness: 200, damping: 16 })

const Row: React.FC<{ top: number; children?: React.ReactNode }> = ({ top, children }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center' }}>{children}</div>
)

/** Pastille-titre d'un temps. */
const Header: React.FC<{ f: number; children?: React.ReactNode }> = ({ f, children }) => (
  <Row top={112}>
    <Pop f={f} at={0} rot={-3}><Pill bg={C.surface} size={46}>{children}</Pill></Pop>
  </Row>
)

/** Grande phrase cernée d'encre. */
const Big: React.FC<{ f: number; at?: number; top?: number; size?: number; color?: string; children?: React.ReactNode }> = ({ f, at = 8, top = 206, size = 62, color = N.gold, children }) => (
  <div style={{ position: 'absolute', left: 12, right: 12, top }}>
    <Pop f={f} at={at} from={40}><Outlined size={size} color={color}>{children}</Outlined></Pop>
  </div>
)

/** Kéké en Père Noël (planche `kevin/santa`). */
const Keke: React.FC<{ expr: string; size: number; style?: React.CSSProperties }> = ({ expr, size, style }) => (
  <Chibi slug="kevin" outfit="santa" expression={expr} size={size} style={style} />
)
/** Son portrait en pied (hotte, traîneau, renne), 3:4. */
const Portrait: React.FC<{ w: number }> = ({ w }) => (
  <Img src={staticFile('chibis/kevin/portraits/santa-hd.webp')} style={{ width: w, height: (w * 4) / 3, display: 'block' }} />
)

/** Titre de l'événement sur deux lignes, entre un sapin et un cadeau. */
const Logo: React.FC<{ f: number; at: number; top: number; scale?: number; lines: readonly [string, string] }> = ({ f, at, top, scale = 1, lines }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top, height: 290, transform: `scale(${scale})`, transformOrigin: '50% 0' }}>
    <Pop f={f} at={at} from={-80} rot={-3}><Outlined size={170} color="#ffffff" stroke={7}>{lines[0]}</Outlined></Pop>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 150 }}>
      <Pop f={f} at={at + 5} from={60} rot={-3}><Outlined size={108} color={N.gold} stroke={6}>{lines[1]}</Outlined></Pop>
    </div>
    <Pop f={f} at={at + 9} rot={-12} style={{ position: 'absolute', left: 44, top: 34, fontSize: 104, lineHeight: 1 }}>🎄</Pop>
    <Pop f={f} at={at + 12} rot={12} style={{ position: 'absolute', right: 48, top: 44, fontSize: 96, lineHeight: 1 }}>🎁</Pop>
  </div>
)

const starPoints = (cx: number, cy: number, R: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const q = i % 2 ? r : R
    return `${cx + Math.cos(a) * q},${cy + Math.sin(a) * q}`
  }).join(' ')

/** La hotte du Père Noël, ouverte (bord de fourrure blanche). Goulot au centre, à ~28 % de la hauteur. */
const Sack: React.FC<{ w: number; style?: React.CSSProperties }> = ({ w, style }) => (
  <svg width={w} height={w * 1.1} viewBox="0 0 200 220" style={{ display: 'block', overflow: 'visible', ...style }}>
    <path d="M32,66 C-6,118 0,184 30,202 C62,218 138,218 170,202 C200,184 206,118 168,66 Z" fill="#c1121f" stroke={C.ink} strokeWidth={8} strokeLinejoin="round" />
    <path d="M24,146 C28,172 40,188 56,196" stroke="#ff7b7b" strokeWidth={10} strokeLinecap="round" fill="none" />
    <polygon points={starPoints(104, 142, 34, 15)} fill={N.gold} stroke={C.ink} strokeWidth={6} strokeLinejoin="round" />
    <ellipse cx={100} cy={62} rx={82} ry={29} fill="#ffffff" stroke={C.ink} strokeWidth={8} />
    <ellipse cx={100} cy={60} rx={57} ry={15} fill="#5a0a10" stroke={C.ink} strokeWidth={6} />
  </svg>
)

// ---------------------------------------------------------------------------
// 1. Accroche : Kéké surgit, « Ho ho ho ! », le titre, les dates.
// ---------------------------------------------------------------------------
const Accroche: Scene = ({ f, dur }) => {
  const t = NOEL.accroche
  const up = rise(f, 2)
  const W = 580
  return (
    <Shell f={f} dur={dur}>
      <div style={{ position: 'absolute', left: TW / 2 - 400, top: 470, width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 68%)', opacity: clamp01(up) }} />
      <div style={{ position: 'absolute', left: (TW - W) / 2 - 56, top: Math.round(446 + (1 - up) * 900 + bob(f, 0, 10, 30)) }}>
        <Portrait w={W} />
      </div>
      {f < 57 && (
        <Row top={176}>
          <div style={{ transform: `scale(${1 - easeIn(ramp(f, 50, 56))})` }}>
            <Pop f={f} at={9} rot={-4}><Bubble size={104}>{nb(t.bulle)}</Bubble></Pop>
          </div>
        </Row>
      )}
      <Logo f={f} at={60} top={104} lines={t.titre} />
      <Row top={392}>
        <Pop f={f} at={73} rot={3}><Pill bg={N.red} color="#ffffff" size={54}>{nb(t.pastille)}</Pill></Pop>
      </Row>
      <Pop f={f} at={88} rot={5} style={{ position: 'absolute', right: 16, top: 1046 }}>
        <Panel bg={N.gold} radius={24} shadow={6} style={{ padding: '14px 20px 6px', fontSize: 35, lineHeight: 1.14, textAlign: 'center', whiteSpace: 'nowrap' }}>
          {t.dates[0]}<br />{t.dates[1]}
        </Panel>
      </Pop>
      <Sfx name="whoosh" at={0} volume={0.45} />
      <Sfx name="pop" at={10} volume={0.6} />
      <Sfx name="pop" at={61} volume={0.5} />
      <Sfx name="pop" at={74} volume={0.4} />
      <Sfx name="tap" at={89} volume={0.5} />
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// 2. Les missions du jour : 3 cases qui se cochent, +30 ❄️ chacune.
// ---------------------------------------------------------------------------
const Tick: React.FC<{ s: number }> = ({ s }) => (
  <svg width={46} height={46} viewBox="0 0 46 46" style={{ transform: `scale(${s})` }}>
    <path d="M8,24 L19,35 L39,11" stroke={C.ink} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
)

const Missions: Scene = ({ f, dur }) => {
  const t = NOEL.missions
  const CHECK = [45, 60, 75]
  const happy = f >= CHECK[2] + 6
  return (
    <Shell f={f} dur={dur}>
      <Header f={f}>{t.titre}</Header>
      <Big f={f}>{t.accroche}</Big>
      {t.liste.map((txt, k) => {
        const on = f >= CHECK[k]
        const s = sp(f, CHECK[k], SPRING.pop)
        return (
          <Pop key={k} f={f} at={18 + k * 5} from={60} rot={k % 2 ? 1.2 : -1.2} style={{ position: 'absolute', left: 36, top: 320 + k * 122 }}>
            <Panel bg={on ? '#d9fff1' : C.surface} radius={30} style={{ position: 'relative', width: 648, height: 104, display: 'flex', alignItems: 'center', gap: 20, padding: '0 22px', transform: `scale(${1 + 0.05 * Math.sin(ramp(f, CHECK[k], CHECK[k] + 10) * Math.PI)})` }}>
              <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 18, border: `5px solid ${C.ink}`, background: on ? C.mint : C.surface, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {on && <Tick s={s} />}
              </div>
              <div style={{ fontSize: 40, lineHeight: 1, paddingTop: 8 }}>{txt}</div>
              {on && <Pill bg={N.gold} size={32} style={{ position: 'absolute', right: -14, top: -30, transform: `scale(${s}) rotate(5deg)` }}>{t.gain}</Pill>}
            </Panel>
          </Pop>
        )
      })}
      <div style={{ position: 'absolute', left: 14, top: 716 + (1 - rise(f, 14)) * 600 + bob(f, 0, happy ? 26 : 8, happy ? 15 : 30), transform: `rotate(${wiggle(f, 0, 2.5)}deg)` }}>
        <Keke expr={happy ? 'joie' : 'reflexion'} size={330} />
      </div>
      <Pop f={f} at={90} rot={3} style={{ position: 'absolute', left: 340, top: 744 }}>
        <Bubble size={44}><div style={{ textAlign: 'center' }}>{t.bulle[0]}<br />{nb(t.bulle[1])}</div></Bubble>
      </Pop>
      <Row top={1060}>
        <Pop f={f} at={112} rot={-2}><Pill bg={N.gold} size={38}>{nb(t.bonus)}</Pill></Pop>
      </Row>
      <Sfx name="swoosh-up" at={0} volume={0.35} />
      <Sfx name="pop" at={9} volume={0.4} />
      {CHECK.map((c, k) => <Sfx key={k} name="pop" at={c} volume={0.6} />)}
      <Sfx name="success" at={CHECK[2] + 5} volume={0.5} />
      <Sfx name="pop" at={91} volume={0.45} />
      <Sfx name="pop" at={113} volume={0.45} />
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// 3. La Hotte du jour : 5 manches sortent de la hotte, puis les 3 règles.
// ---------------------------------------------------------------------------
const GRID: [number, number][] = [[36, 300], [260, 300], [484, 300], [148, 486], [372, 486]]

const Hotte: Scene = ({ f, dur }) => {
  const t = NOEL.hotte
  // Après lecture, la grille se range en une ligne de 5 pastilles pour laisser la place aux règles.
  const m = easeInOut(ramp(f, 104, 116))
  const SX = 563
  const SY = 922
  const puff = Math.max(0, ...t.manches.map((_, k) => 1 - Math.abs(f - (16 + k * 5) - 2) / 4))
  return (
    <Shell f={f} dur={dur}>
      <Header f={f}>{t.titre}</Header>
      <Big f={f}>{t.accroche}</Big>
      <div style={{ position: 'absolute', left: 12, top: 770 + (1 - rise(f, 6)) * 600 + bob(f, 0, 10, 30), transform: `rotate(${wiggle(f, 0, 2.5)}deg)` }}>
        <Keke expr={f >= 156 ? 'joie' : 'clin_oeil'} size={360} />
      </div>
      <div style={{ position: 'absolute', left: 428, top: 838 + (1 - rise(f, 9)) * 600, transform: `scale(${1 + 0.07 * puff}, ${1 - 0.05 * puff})`, transformOrigin: '50% 100%' }}>
        <Sack w={270} />
      </div>
      {t.manches.map((manche, k) => {
        const at = 16 + k * 5
        if (f < at) return null
        const s = sp(f, at, { stiffness: 170, damping: 19 })
        const w = lerp(200, 112, m)
        const h = lerp(168, 112, m)
        const x = lerp(SX - w / 2, lerp(GRID[k][0], 36 + k * 134, m), s)
        const y = lerp(SY - h / 2, lerp(GRID[k][1], 300, m), s)
        return (
          <div key={k} style={{ position: 'absolute', left: x, top: y, transform: `scale(${Math.max(0.1, s)}) rotate(${(k % 2 ? 2 : -2) * (1 - m) + (1 - s) * 40}deg)`, opacity: clamp01(s * 4) }}>
            <Panel radius={30} shadow={6} style={{ width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <div style={{ fontSize: lerp(74, 60, m), lineHeight: 1.12 }}>{manche.emoji}</div>
              <div style={{ height: lerp(62, 0, m), opacity: 1 - ramp(m, 0, 0.5), fontSize: 30, lineHeight: 1.02, textAlign: 'center', display: 'flex', alignItems: 'center', padding: '0 6px' }}>{nb(manche.nom)}</div>
            </Panel>
          </div>
        )
      })}
      {t.regles.map((regle, k) => (
        <Row key={k} top={448 + k * 94}>
          <Pop f={f} at={120 + k * 15} rot={k % 2 ? 2 : -2} style={{ marginLeft: [-30, 30, -6][k] }}>
            <Pill bg={k === 1 ? N.gold : C.surface} size={40}>{nb(regle)}</Pill>
          </Pop>
        </Row>
      ))}
      <Sfx name="swoosh-up" at={0} volume={0.35} />
      <Sfx name="pop" at={9} volume={0.4} />
      {t.manches.map((_, k) => <Sfx key={k} name="pop" at={16 + k * 5} volume={0.45} />)}
      <Sfx name="whoosh" at={102} volume={0.3} />
      {t.regles.map((_, k) => <Sfx key={k} name={k === 2 ? 'success' : 'pop'} at={121 + k * 15} volume={0.5} />)}
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// 4. Le Pass de Noël : la piste des 30 paliers défile, la tenue Père Noël est au bout.
// ---------------------------------------------------------------------------
const REWARD: Record<number, string> = { 3: '🧝', 6: '🎁', 9: '🍭', 10: '✨', 12: '🛷', 15: '🔴', 18: '✨', 20: '🪵', 22: '💡', 25: '✨', 27: '🌿', 30: '🎅' }
const TIERS = Array.from({ length: 30 }, (_, i) => i + 1)

const Pass: Scene = ({ f, dur }) => {
  const t = NOEL.pass
  const REVEAL = 90
  const pos = 1 + 29 * easeInOut(ramp(f, 22, 86))
  const sliding = f > 22 && f < 86
  const CY = 486
  const enter = clamp01(sp(f, 12, SPRING.snappy))
  const hide = easeIn(ramp(f, REVEAL - 6, REVEAL))
  // Extrémités visibles de la piste (du palier 1 au palier 30).
  const x0 = Math.max(-10, TW / 2 + (1 - pos) * 124)
  const x1 = Math.min(TW + 10, TW / 2 + (30 - pos) * 124)
  return (
    <Shell f={f} dur={dur}>
      <Header f={f}>{t.titre}</Header>
      <Big f={f} size={60}>{t.accroche}</Big>
      <div style={{ position: 'absolute', left: 0, top: 0, width: TW, height: TH, transform: `translateX(${(1 - enter) * 760}px)` }}>
        <div style={{ position: 'absolute', left: x0, top: CY - 10, width: x1 - x0, height: 20, background: C.surface, border: `5px solid ${C.ink}`, boxSizing: 'border-box' }} />
        <div style={{ position: 'absolute', left: x0, top: CY - 10, width: TW / 2 - x0, height: 20, background: N.gold, border: `5px solid ${C.ink}`, boxSizing: 'border-box' }} />
        {TIERS.map((n) => {
          const x = TW / 2 + (n - pos) * 124
          if (x < -90 || x > TW + 90) return null
          const d = n === 30 ? 104 : 86
          const pulse = n === 30 && f >= 86 ? 1 + 0.12 * Math.abs(Math.sin((f - 86) / 7.5)) : 1
          return (
            <div key={n} style={{ position: 'absolute', left: x - d / 2, top: CY - d / 2, width: d, height: d, transform: `scale(${pulse})` }}>
              <div style={{ width: d, height: d, borderRadius: '50%', background: n <= pos + 0.02 ? N.gold : C.surface, border: `5px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(4), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: d * 0.5, lineHeight: 1 }}>
                {REWARD[n] ?? '🪙'}
              </div>
              <Outlined size={32} stroke={3} style={{ position: 'absolute', left: -30, right: -30, top: d + 4 }}>{n}</Outlined>
            </div>
          )
        })}
        {/* Kéké file en traîneau au-dessus de la piste (image retournée : le traîneau regarde à droite). */}
        <div style={{ position: 'absolute', left: TW / 2 - 100, top: CY - 222 + bob(f, 0, sliding ? 5 : 12, sliding ? 6 : 26), transform: `rotate(${sliding ? 5 + wiggle(f, 0, 2, 10) : 0}deg) scaleX(-1)` }}>
          <Keke expr="cool" size={200} />
        </div>
      </div>
      {f < REVEAL && t.cadeaux.map((cadeau, k) => (
        <Row key={k} top={650 + k * 124}>
          <div style={{ transform: `scale(${1 - hide})`, marginLeft: [-70, 60, -30][k] }}>
            <Pop f={f} at={18 + k * 13} rot={k % 2 ? 2 : -2}><Pill bg={k === 1 ? N.gold : C.surface} size={50}>{cadeau}</Pill></Pop>
          </div>
        </Row>
      ))}
      <Row top={616}>
        <Pop f={f} at={REVEAL} from={90}>
          <Panel bg={N.cream} radius={40} shadow={10} style={{ position: 'relative', width: 500, height: 384 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 34, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: -150, top: -230, width: 800, height: 800, background: `repeating-conic-gradient(${N.gold} 0 15deg, #ffe9a8 15deg 30deg)`, transform: `rotate(${f * 0.2}deg)` }} />
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 68, background: C.surface, borderTop: `5px solid ${C.ink}`, boxSizing: 'border-box', fontSize: 38, lineHeight: '66px', textAlign: 'center', whiteSpace: 'nowrap' }}>{nb(t.tenue)}</div>
            </div>
            <div style={{ position: 'absolute', left: 133, top: 8 + bob(f, 0, 6, 24) }}><Portrait w={224} /></div>
            <Pill bg={N.red} color="#ffffff" size={34} style={{ position: 'absolute', left: 150, top: -30, transform: 'rotate(-4deg)' }}>{t.ruban}</Pill>
          </Panel>
        </Pop>
      </Row>
      <Row top={1012}>
        <Pop f={f} at={120} rot={-2} cfg={SPRING.pop}><Pill bg={C.tomato} color="#ffffff" size={42}>{nb(t.tampon)}</Pill></Pop>
      </Row>
      <Row top={1098}>
        <Pop f={f} at={140} rot={1}><Pill bg={C.surface} size={34}>{t.serie}</Pill></Pop>
      </Row>
      <ConfettiBurst f={f} at={REVEAL + 2} y={780} n={36} seed="noelpass" />
      <Sfx name="swoosh-up" at={0} volume={0.35} />
      <Sfx name="pop" at={9} volume={0.4} />
      <Sfx name="whoosh" at={22} volume={0.4} />
      {t.cadeaux.map((_, k) => <Sfx key={k} name="pop" at={19 + k * 13} volume={0.45} />)}
      <Sfx name="whoosh" at={62} volume={0.35} />
      <Sfx name="success" at={REVEAL} volume={0.6} />
      <Sfx name="tap" at={121} volume={0.6} />
      <Sfx name="pop" at={122} volume={0.35} />
      <Sfx name="pop" at={141} volume={0.45} />
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// 5. La Grande Hotte de la bande : les flocons de tous remplissent la jauge à 5 paliers → le Gros Lot.
// ---------------------------------------------------------------------------
const BAND: Slug[] = ['dede', 'cycy', 'manon', 'mika', 'kevin', 'cecile', 'carole', 'marius', 'nini']
/** Seuils des 5 paliers (6 000, 14 000, 22 000, 30 000, 38 000 ❄️) en part de la jauge. */
const FRACS = [6, 14, 22, 30, 38].map((v) => v / 38)

const GrandeHotte: Scene = ({ f, dur }) => {
  const t = NOEL.grandeHotte
  const FILL0 = 34
  const FULL = 90
  const p = ramp(f, FILL0, FULL)
  const full = f >= FULL
  const X0 = 44
  const BW = 632
  const BY = 500
  const BH = 60
  return (
    <Shell f={f} dur={dur}>
      <Header f={f}>{t.titre}</Header>
      <Big f={f} size={50} top={210}>{nb(t.accroche)}</Big>
      {BAND.map((slug, k) => (
        <Pop key={slug} f={f} at={12 + k * 2} style={{ position: 'absolute', left: 37 + k * 70, top: 296 + bob(f, k * 7, full ? 22 : 8, full ? 14 : 26), zIndex: k === 4 ? 2 : 1 }}>
          <Avatar slug={slug} outfit={slug === 'kevin' ? 'santa' : undefined} expression={full || k % 2 === 0 ? 'joie' : 'clin_oeil'} size={86} />
        </Pop>
      ))}
      {Array.from({ length: 26 }, (_, j) => {
        const at = 28 + j * 2
        const fall = ramp(f, at, at + 14)
        if (f < at || fall >= 1) return null
        const x = 37 + ((j * 4) % 9) * 70 + 43 + (random(`gh${j}`) - 0.5) * 30
        return <Flake key={j} size={40} outline style={{ position: 'absolute', left: x - 20, top: lerp(376, BY - 22, easeIn(fall)), transform: `rotate(${f * 6 + j * 30}deg)` }} />
      })}
      <Pop f={f} at={20} from={40} style={{ position: 'absolute', left: X0, top: BY }}>
        <div style={{ width: BW, height: BH, borderRadius: BH / 2, background: C.surface, border: `5px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(6), overflow: 'hidden' }}>
          <div style={{ width: `${p * 100}%`, height: '100%', background: C.sky, backgroundImage: 'radial-gradient(#ffffff 3px, transparent 3.6px)', backgroundSize: '22px 22px', borderRight: p > 0.01 && p < 1 ? `5px solid ${C.ink}` : undefined, boxSizing: 'border-box' }} />
        </div>
        {FRACS.map((frac, k) => {
          const at = FILL0 + frac * (FULL - FILL0)
          const last = k === FRACS.length - 1
          const d = last ? 96 : 68
          const hit = f >= at ? 1 + (last ? 0.3 : 0.35) * Math.sin(ramp(f, at, at + 10) * Math.PI) + (last ? 0.08 * Math.abs(Math.sin((f - at) / 6)) : 0) : 1
          return (
            <div key={k} style={{ position: 'absolute', left: frac * BW - d / 2 - (last ? 30 : 0), top: BH + (last ? 2 : 16), width: d, height: d, borderRadius: '50%', background: f >= at ? N.gold : C.surface, border: `5px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(4), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: d * 0.52, lineHeight: 1, transform: `scale(${hit})` }}>
              {t.paliers[k]}
            </div>
          )
        })}
      </Pop>
      <Big f={f} at={FULL + 2} top={676} size={84}>{nb(t.grosLot)}</Big>
      <Pop f={f} at={14} from={80} style={{ position: 'absolute', left: 14, top: 762 + bob(f, 0, full ? 22 : 10, full ? 16 : 28) }}>
        <Keke expr={f >= FULL + 4 ? 'amoureux' : 'surprise'} size={250} />
      </Pop>
      {f < FULL + 10 && (
        <Pop f={f} at={FILL0 - 6} style={{ position: 'absolute', left: 276, top: 826 }}>
          <div style={{ width: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, transform: `scale(${(1 - easeIn(ramp(f, FULL + 4, FULL + 10))) * (1 + (p > 0 && p < 1 ? 0.04 * Math.sin(f / 2) : 0))})` }}>
            <Outlined size={88} style={{ whiteSpace: 'nowrap' }}>{String(Math.round(p * 380) * 100).replace(/\B(?=(\d{3})+$)/g, ' ')}</Outlined>
            <Flake size={78} outline />
          </div>
        </Pop>
      )}
      {t.lots.map((lot, k) => (
        <Pop key={k} f={f} at={FULL + 12 + k * 9} rot={k % 2 ? 2 : -2} style={{ position: 'absolute', left: 276 + (k % 2) * 22, top: 776 + k * 76 }}>
          <Pill bg={k === 0 ? N.gold : C.surface} size={34}>{lot}</Pill>
        </Pop>
      ))}
      <Row top={1022}>
        <Pop f={f} at={136} from={50}>
          <Panel radius={30} shadow={7} style={{ padding: '16px 28px 8px', fontSize: 38, lineHeight: 1.15, textAlign: 'center', whiteSpace: 'nowrap' }}>
            {nb(t.condition[0])}<br />{nb(t.condition[1])}
          </Panel>
        </Pop>
      </Row>
      <ConfettiBurst f={f} at={FULL} x={616} y={600} n={30} seed="noelgh" />
      <Sfx name="swoosh-up" at={0} volume={0.35} />
      <Sfx name="pop" at={9} volume={0.4} />
      {FRACS.slice(0, 4).map((frac, k) => <Sfx key={k} name="tap" at={Math.round(FILL0 + frac * (FULL - FILL0))} volume={0.7} />)}
      <Sfx name="success" at={FULL} volume={0.6} />
      <Sfx name="pop" at={FULL + 3} volume={0.5} />
      {t.lots.map((_, k) => <Sfx key={k} name="pop" at={FULL + 13 + k * 9} volume={0.4} />)}
      <Sfx name="pop" at={137} volume={0.5} />
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// 6. Fin : « Rendez-vous chaque jour ! », Kéké champion, le titre.
// ---------------------------------------------------------------------------
const Fin: Scene = ({ f }) => {
  const t = NOEL.fin
  const up = rise(f, 2)
  return (
    <AbsoluteFill>
      {t.appel.map((line, k) => (
        <div key={k} style={{ position: 'absolute', left: 8, right: 8, top: 114 + k * 100 }}>
          <Pop f={f} at={5 + k * 6} from={70} rot={k ? 2 : -2}><Outlined size={96} color={k ? N.gold : '#ffffff'} stroke={6}>{nb(line)}</Outlined></Pop>
        </div>
      ))}
      <div style={{ position: 'absolute', left: TW / 2 - 300, top: 270, width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 68%)', opacity: clamp01(up) }} />
      {/* Confettis derrière Kéké et le titre (jamais sur son visage) ; le second éclat tombe sur l'accord final. */}
      <ConfettiBurst f={f} at={16} y={560} n={24} seed="noelfin" />
      <ConfettiBurst f={f} at={60} y={620} n={18} seed="noelfin2" />
      <div style={{ position: 'absolute', left: TW / 2 - 205, top: Math.round(346 + (1 - up) * 700 + bob(f, 0, 30, 15)), transform: `rotate(${wiggle(f, 0, 2)}deg)` }}>
        <Keke expr="gamer" size={410} />
      </div>
      <Logo f={f} at={22} top={770} scale={0.86} lines={t.titre} />
      <Row top={1046}>
        <Pop f={f} at={38} rot={-2}><Pill bg={C.surface} size={34}>{t.dates}</Pill></Pop>
      </Row>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1228, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, color: C.ink, opacity: ramp(f, 40, 50) }}>{t.signature}</div>
      <Sfx name="whoosh" at={0} volume={0.4} />
      {MUSIC_VOLUME === 0 && <Sfx name="jingle" at={4} volume={0.45} />}
      <Sfx name="pop" at={6} volume={0.4} />
      <Sfx name="pop" at={12} volume={0.4} />
      <Sfx name="pop" at={23} volume={0.5} />
      <Sfx name="pop" at={39} volume={0.4} />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------
const SCENES: Record<NoelPartId, Scene> = { accroche: Accroche, missions: Missions, hotte: Hotte, pass: Pass, grandeHotte: GrandeHotte, fin: Fin }
const Local: React.FC<{ id: NoelPartId }> = ({ id }) => React.createElement(SCENES[id], { f: useCurrentFrame(), dur: DUR[id] })

export const NoelIntro: React.FC = () => {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill>
      <Backdrop f={f} />
      <Snow f={f} />
      <Ground />
      {NOEL_ORDER.map((id, k) => (
        <Sequence key={id} from={STARTS[k]} durationInFrames={DUR[id]} name={id}>
          <Local id={id} />
        </Sequence>
      ))}
      <Garland f={f} />
      {MUSIC_VOLUME > 0 && <Audio src={staticFile('sfx/noel-music.mp3')} volume={MUSIC_VOLUME} />}
    </AbsoluteFill>
  )
}

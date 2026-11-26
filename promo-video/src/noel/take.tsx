// Le début de la vidéo : un salon cosy dessiné où le CHIBI de Kéké (tenue « chemise ») annonce la nouvelle dans une bulle
// en machine à écrire, puis givre, rafale (objets, bulle et lettres emportés), arrêt sur image → glaçon-sticker, fissures et 14 éclats.
// Toutes les images sont ABSOLUES (0 = début de la vidéo). Le salon + le chibi (`Room`) est un composant pur de la frame : il sert
// aussi bien en direct (0–9,7 s) que figé dans la glace (`FrozenFace`, glaçon et éclats).
import React from 'react'
import { AbsoluteFill, Img, random, staticFile } from 'remotion'
import { C, DISPLAY } from '../theme'
import { TH, TW, easeIn, easeInOut, lerp, ramp, sp } from '../tuto/kit'
import { Flake, Frost, N, Sparkle, Storm, Streaks, sec, shake, step3 } from './fx'
import { CRACK_REACH, CRACK_RAYS, CRACK_RINGS, CUBE_H, CUBE_POLY, CUBE_W, MICRO_CRACKS, SHARDS, clipPoly, partial, pts, rimTeeth, type Pt } from './geometry'
import { Sfx } from './sfx'
import { HOST, HOST_LINES, HOST_OUTFIT, T } from './script'

const easeOut = (v: number) => 1 - (1 - Math.min(1, Math.max(0, v))) ** 3
const outExpo = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * Math.min(1, Math.max(0, p))))
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export const F_PRESAGE = sec(T.presage) // 210
export const F_CUT = sec(T.cut) // 255
export const F_GLACON = sec(T.glacon) // 291
export const F_CRACKS = T.crack.map(sec) // 315, 330, 345
export const F_NOEL = sec(T.noel) // 360

// ---------------------------------------------------------------------------
// Le chibi : expression et pose à chaque image.
// ---------------------------------------------------------------------------
/** Taille (px) et haut de l'image du chibi dans le plan (le sticker 256 px est agrandi : plan poitrine). */
export const HOST_SIZE = 600
export const HOST_TOP = 440
const hostSrc = (expr: string) => staticFile(`chibis/${HOST}/${HOST_OUTFIT}/${expr}.webp`)

type Line = (typeof HOST_LINES)[number]
const lineExpr = (l: Line, t: number) => (l.expr2 && l.expr2At !== undefined && t >= l.expr2At ? l.expr2 : l.expr)

export const hostExpr = (f: number) => {
  if (f >= F_CUT) {
    const t = f - F_CUT
    return t < 18 ? 'surprise' : t < 30 ? 'pleurs' : 'surprise'
  }
  const t = f / 30
  const cur = HOST_LINES.find((l) => t >= l.from && t < l.to)
  if (cur) return lineExpr(cur, t)
  const prev = [...HOST_LINES].reverse().find((l) => t >= l.to)
  return prev ? lineExpr(prev, prev.to - 0.01) : 'joie'
}

/** Rebond de « parole » : une impulsion au début de chaque mot (0 → 1, retombe en 8 images). */
const wordBump = (f: number) => {
  let p = 0
  for (const l of HOST_LINES) {
    const s = sec(l.from)
    const e = sec(l.to)
    if (f < s || f >= e) continue
    const words = l.text.split(' ')
    const per = ((e - s) * 0.78) / words.length
    words.forEach((_, i) => {
      const d = f - (s + i * per)
      if (d >= 0 && d < 9) p = Math.max(p, Math.exp(-d / 3.2))
    })
  }
  return p
}

export const hostPose = (f: number) => {
  if (f < F_CUT) {
    const b = wordBump(f)
    const pre = ramp(f, F_PRESAGE, F_CUT)
    return { x: 0, y: -7 * b, rot: Math.sin(step3(f) / 26) * 1.1 + pre * Math.sin(f * 0.6) * 0.7, skew: pre * Math.sin(f * 0.85) * 2.4, sx: 1 - 0.035 * b, sy: 1 + 0.05 * b }
  }
  // Rafale : poussé vers la droite, secoué ; il grelotte (pleurs), puis surprise figée.
  const t = f - F_CUT
  const u = outExpo(t / 9)
  const jolt = shake(f, F_CUT, 22, 16, 'host')
  const shiver = t >= 18 && t < 30 ? { x: (random(`shx${f}`) - 0.5) * 9, y: (random(`shy${f}`) - 0.5) * 6 } : { x: 0, y: 0 }
  return {
    x: 100 * u + jolt.x + shiver.x,
    y: jolt.y * 0.5 + shiver.y,
    rot: 7 * u + jolt.r * 0.4,
    skew: -lerp(16, 10, ramp(t, 18, 26)) * u,
    sx: 1,
    sy: 1,
  }
}

// ---------------------------------------------------------------------------
// Objets du salon qui s'envolent (trajectoires de gauche à droite) : mug, coussin, cadre. Positions à l'image f.
// ---------------------------------------------------------------------------
const MUG0 = { x: 118, y: 1086 }
const CUSH0 = { x: 640, y: 1036 }
const FRAME0 = { x: 613, y: 318 }
const mugAt = (f: number) => {
  const t = f - (F_CUT + 6)
  if (t <= 0) return { ...MUG0, r: 0, fly: false }
  return { x: MUG0.x + 8.5 * t + 0.16 * t * t, y: MUG0.y - 670 * (1 - Math.exp(-t / 16)), r: t * 12, fly: true }
}
const cushionAt = (f: number) => {
  const t = f - (F_CUT + 1)
  if (t <= 0) return { ...CUSH0, r: 0 }
  return { x: CUSH0.x + 30 * t + 1.4 * t * t, y: CUSH0.y - 11 * t + 0.4 * t * t, r: t * 17 }
}
const frameAt = (f: number) => {
  const t = f - (F_CUT + 8)
  if (t <= 0) return { ...FRAME0, r: 0, fly: false }
  return { x: FRAME0.x + 22 * t + 1 * t * t, y: FRAME0.y + 6 * t + 0.9 * t * t, r: -12 + t * 22, fly: true }
}

// ---------------------------------------------------------------------------
// Le salon (SVG dessiné, style sticker : contours d'encre épais, aplats vifs). Rien de Noël, sauf un sapin pas encore décoré.
// ---------------------------------------------------------------------------
const INK = C.ink
const Room: React.FC<{ f: number }> = ({ f }) => {
  const pre = ramp(f, F_PRESAGE, F_CUT)
  const post = f >= F_CUT ? outExpo((f - F_CUT) / 12) : 0
  const lean = pre * 2.2 + post * 9 + Math.sin(f * 0.5) * (pre * 1.6 + (f >= F_CUT ? 2.4 : 0))
  const flutter = (pre * 5 + post * 14) * Math.sin(f * 0.8)
  const mug = mugAt(f)
  const cu = cushionAt(f)
  const fr = frameAt(f)
  const pose = hostPose(f)
  const intro = f < 9 ? sp(f, 0, { stiffness: 300, damping: 14 }) : 1
  const steam = (k: number) => ((step3(f) * 0.7 + k * 14) % 42) / 42
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#ffe2b5' }}>
      <svg width={TW} height={TH} viewBox={`0 0 ${TW} ${TH}`} style={{ position: 'absolute', left: 0, top: 0 }}>
        <defs>
          <radialGradient id="lampGlow">
            <stop offset="0%" stopColor="#fff3b0" stopOpacity={0.75} />
            <stop offset="100%" stopColor="#fff3b0" stopOpacity={0} />
          </radialGradient>
        </defs>
        {/* mur : rayures chaudes + lambris, plinthe, parquet, tapis */}
        <rect width={720} height={1000} fill="#ffe2b5" />
        <g fill="rgba(255,255,255,0.32)">{Array.from({ length: 8 }, (_, i) => <rect key={i} x={i * 96 + 24} y={0} width={48} height={1000} />)}</g>
        <rect y={800} width={720} height={200} fill="#e8a76a" />
        <path d="M0,800 H720" stroke={INK} strokeWidth={6} />
        <g stroke="rgba(31,27,46,0.2)" strokeWidth={4}>{Array.from({ length: 7 }, (_, i) => <path key={i} d={`M${i * 120},832 V970`} />)}</g>
        <rect y={984} width={720} height={22} fill="#fff3dc" stroke={INK} strokeWidth={5} />
        <rect y={1006} width={720} height={274} fill="#c98a54" />
        <g stroke={INK} strokeWidth={3} opacity={0.3}>
          <path d="M0,1056 H720 M0,1112 H720 M0,1172 H720 M0,1232 H720" />
          <path d="M180,1006 V1056 M520,1056 V1112 M300,1112 V1172 M600,1172 V1232 M120,1232 V1280" />
        </g>
        <ellipse cx={360} cy={1160} rx={390} ry={118} fill="#d1495b" stroke={INK} strokeWidth={6} />
        <ellipse cx={360} cy={1160} rx={330} ry={88} fill="none" stroke="#ffe2b5" strokeWidth={5} strokeDasharray="18 14" />
        {/* fenêtre de nuit, rideaux qui flottent */}
        <rect x={30} y={250} width={200} height={270} rx={16} fill="#fffaf0" stroke={INK} strokeWidth={7} />
        {[[46, 266], [134, 266], [46, 396], [134, 396]].map(([x, y], i) => <rect key={i} x={x} y={y} width={80} height={i < 2 ? 120 : 112} rx={6} fill="#233a7a" stroke={INK} strokeWidth={5} />)}
        <circle cx={84} cy={312} r={22} fill="#fff3c4" />
        <circle cx={94} cy={306} r={19} fill="#233a7a" />
        {[[170, 300], [160, 350], [78, 430], [182, 440], [100, 480]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3.5} fill="#fff3c4" />)}
        <rect x={16} y={512} width={228} height={18} rx={6} fill="#fff3dc" stroke={INK} strokeWidth={5} />
        <g transform={`translate(14 240) skewX(${flutter * 0.6})`}>
          <path d="M0,0 L52,0 Q40,130 58,272 L0,272 Z" fill="#ef476f" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
        </g>
        <g transform={`translate(246 240) skewX(${flutter * 0.6}) scale(-1 1)`}>
          <path d="M0,0 L52,0 Q40,130 58,272 L0,272 Z" fill="#ef476f" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
        </g>
        {/* cadre au mur (s'envole) */}
        {fr.fly && (
          <>
            <rect x={FRAME0.x - 65} y={FRAME0.y - 65} width={130} height={130} fill="#f5cf94" />
            <circle cx={FRAME0.x} cy={FRAME0.y - 56} r={6} fill={INK} />
          </>
        )}
        <g transform={`translate(${fr.x} ${fr.y}) rotate(${fr.r})`}>
          <rect x={-65} y={-65} width={130} height={130} fill="#8b5e34" stroke={INK} strokeWidth={7} />
          <rect x={-50} y={-50} width={100} height={100} fill="#bfe3f2" stroke={INK} strokeWidth={4} />
          <circle cx={16} cy={-18} r={17} fill="#ffb703" stroke={INK} strokeWidth={4} />
          <path d="M-50,32 Q-22,-4 10,26 T50,16 V50 H-50 Z" fill="#52b788" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        </g>
        {/* lampadaire */}
        <circle cx={639} cy={500} r={260} fill="url(#lampGlow)" />
        <rect x={632} y={520} width={14} height={480} fill="#6b4a2b" stroke={INK} strokeWidth={5} />
        <ellipse cx={639} cy={1000} rx={46} ry={12} fill="#6b4a2b" stroke={INK} strokeWidth={5} />
        <path d="M588,520 L690,520 L664,428 L614,428 Z" fill="#ffd166" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
        {/* sapin pas encore décoré : il plie sous le vent */}
        <g transform={`rotate(${lean} 100 1000)`}>
          <path d="M62,950 L138,950 L130,1004 L70,1004 Z" fill="#e07a5f" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <rect x={92} y={918} width={16} height={36} fill="#7f5539" stroke={INK} strokeWidth={4} />
          <polygon points="100,736 14,932 186,932" fill="#2d8f5a" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
          <polygon points="100,648 28,816 172,816" fill="#2d8f5a" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
          <polygon points="100,566 48,692 152,692" fill="#2d8f5a" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
          <polygon points="100,584 74,670 100,664" fill="#4cc38a" />
          <polygon points="100,666 56,792 100,786" fill="#4cc38a" />
        </g>
        {/* coussin par terre (s'envole) */}
        <g transform={`translate(${cu.x} ${cu.y}) rotate(${cu.r})`}>
          <rect x={-62} y={-52} width={124} height={104} rx={26} fill="#ffb703" stroke={INK} strokeWidth={6} />
          <path d="M-52,-32 Q0,-8 52,-32 M-52,32 Q0,8 52,32" fill="none" stroke={INK} strokeWidth={4} opacity={0.3} />
          <circle cx={0} cy={0} r={9} fill="#fb8500" stroke={INK} strokeWidth={4} />
          {[[-62, -52], [62, -52], [-62, 52], [62, 52]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={9} fill="#fb8500" stroke={INK} strokeWidth={4} />)}
        </g>
      </svg>
      {/* le chibi : un sticker posé dans le salon (plan poitrine) */}
      <div style={{ position: 'absolute', left: 360 - HOST_SIZE / 2, top: HOST_TOP, width: HOST_SIZE, height: HOST_SIZE, transformOrigin: '50% 86%', transform: `translate(${pose.x}px,${pose.y}px) rotate(${pose.rot}deg) skewX(${pose.skew}deg) scale(${pose.sx * (0.85 + 0.15 * intro)}, ${pose.sy * (0.85 + 0.15 * intro)})` }}>
        <Img src={hostSrc(hostExpr(f))} style={{ width: HOST_SIZE, height: HOST_SIZE, objectFit: 'contain', display: 'block', filter: 'drop-shadow(8px 10px 0 rgba(31,27,46,0.28))' }} />
      </div>
      {/* guéridon et mug fumant (le mug s'envole) */}
      <svg width={TW} height={TH} viewBox={`0 0 ${TW} ${TH}`} style={{ position: 'absolute', left: 0, top: 0 }}>
        <rect x={98} y={1090} width={24} height={190} fill="#8b5e34" stroke={INK} strokeWidth={5} />
        <ellipse cx={110} cy={1090} rx={136} ry={28} fill="#d9a066" stroke={INK} strokeWidth={6} />
        <g transform={`translate(${mug.x} ${mug.y}) rotate(${mug.r} 0 -44)`}>
          <path d="M44,-70 q38,0 38,28 q0,28 -38,28" fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round" />
          <rect x={-44} y={-88} width={88} height={88} rx={14} fill="#ffffff" stroke={INK} strokeWidth={6} />
          <ellipse cx={0} cy={-88} rx={44} ry={9} fill="#7b3f00" stroke={INK} strokeWidth={5} />
          <path d="M0,-30 C-22,-46 -10,-64 0,-52 C10,-64 22,-46 0,-30 Z" fill="#ef476f" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          {!mug.fly &&
            [0, 1, 2].map((k) => (
              <path key={k} d="M0,-100 q-10,-14 0,-28 q10,-14 0,-28" fill="none" stroke="#ffffff" strokeWidth={7} strokeLinecap="round" opacity={0.85 * (1 - steam(k))} transform={`translate(${(k - 1) * 24} ${-steam(k) * 44})`} />
            ))}
        </g>
      </svg>
    </AbsoluteFill>
  )
}

/** Le salon + le chibi, figés comme à 9,7 s (surprise) : le contenu du glaçon, des éclats et de leurs flocons pris dans la glace. */
const FrozenFace: React.FC = () => (
  <>
    <Room f={F_GLACON} />
    <Storm f={F_GLACON} amount={0.7} speed={1} />
  </>
)

// ---------------------------------------------------------------------------
// Bulle de dialogue en machine à écrire (2 à 4 mots à la fois), emportée par la rafale à 8,5 s.
// ---------------------------------------------------------------------------
const HOT = /(Noël|rien|prévu|Voilà|décembre|ch—)/
const LETTER_FLIGHT = 44
const typedChars = (f: number, l: Line) => {
  const n = Array.from(l.text).length
  const cf = Math.min(1.8, ((sec(l.to) - sec(l.from)) * 0.78) / n)
  return Math.max(0, Math.min(n, Math.floor((f - sec(l.from)) / cf) + 1))
}

const HostBubble: React.FC<{ f: number }> = ({ f }) => {
  const last = HOST_LINES.length - 1
  const t = f / 30
  const flying = f >= F_CUT
  const k = flying ? last : HOST_LINES.findIndex((l) => t >= l.from - 3 / 30 && t < l.to - 3 / 30)
  if (k < 0 || (flying && f >= F_CUT + LETTER_FLIGHT)) return null
  const line = HOST_LINES[k]
  const n = Array.from(line.text).length
  const shown = flying ? n : typedChars(f, line)
  const size = n <= 14 ? 96 : n <= 18 ? 84 : n <= 24 ? 72 : 64
  const s = flying ? 1 : sp(f, sec(line.from) - 3, { stiffness: 380, damping: 15 })
  const rot = (random(`hb${k}`) - 0.5) * 5
  const bt = f - F_CUT - 2
  const body = flying && bt > 0 ? `translate(${14 * bt + 1.7 * bt * bt}px,${-10 * bt}px) rotate(${bt * 9}deg)` : ''
  const words = line.text.split(' ')
  let li = 0
  const letters = (ghost: boolean) =>
    words.map((w, wi) => (
      <span key={wi} style={{ display: 'inline-flex', color: HOT.test(w) ? '#d62839' : INK }}>
        {Array.from(w).map((ch, ci) => {
          const idx = li++
          let tr: string | undefined
          let op = ghost ? 0 : idx < shown ? 1 : 0
          if (!ghost && flying) {
            const tt = f - F_CUT - (n - 1 - idx) * 0.8
            if (tt > 0 && tt < 3) tr = `translate(${(random(`bj${idx}${f}`) - 0.5) * 7}px,${(random(`bk${idx}${f}`) - 0.5) * 7}px)`
            else if (tt >= 3) {
              const u = tt - 3
              tr = `translate(${6 * u + 1.25 * u * u}px,${Math.sin(u * 0.28 + idx) * 36 * Math.min(1, u / 8) - u * 3.2 * (idx % 2 ? 1 : 0.4)}px) rotate(${(random(`bv${idx}`) - 0.3) * 38 * u}deg)`
            }
            op = 1
          }
          return (
            <span key={ci} style={{ display: 'inline-block', transform: tr, opacity: op }}>
              {ch}
            </span>
          )
        })}
      </span>
    ))
  const textStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `0 ${size * 0.26}px`, fontFamily: DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 1.04, textAlign: 'center' }
  return (
    <div style={{ position: 'absolute', left: 40, right: 40, top: 122, display: 'flex', justifyContent: 'center', transform: `scale(${0.6 + 0.4 * s}) rotate(${rot}deg)`, transformOrigin: '50% 100%', opacity: clamp01(s * 4) }}>
      <div style={{ position: 'relative', maxWidth: 640 }}>
        <div style={{ position: 'relative', padding: `${size * 0.2}px ${size * 0.42}px ${size * 0.1}px`, transform: body || undefined }}>
          <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, background: '#ffffff', border: `6px solid ${INK}`, borderRadius: 46, boxShadow: `8px 8px 0 ${INK}`, boxSizing: 'border-box' }} />
          <div style={{ position: 'absolute', left: '40%', bottom: -22, width: 36, height: 36, background: '#ffffff', borderRight: `6px solid ${INK}`, borderBottom: `6px solid ${INK}`, transform: 'rotate(45deg)', boxSizing: 'border-box' }} />
          <div style={{ ...textStyle, position: 'relative', visibility: 'hidden' }}>{letters(true)}</div>
        </div>
        <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, padding: `${size * 0.2}px ${size * 0.42}px ${size * 0.1}px`, boxSizing: 'border-box' }}>
          {(() => {
            li = 0
            return <div style={textStyle}>{letters(false)}</div>
          })()}
        </div>
      </div>
    </div>
  )
}

/** Petits claquements de machine à écrire : un tous les 2 caractères. */
export const TypeSounds: React.FC = () => (
  <>
    {HOST_LINES.flatMap((l, k) => {
      const n = Array.from(l.text).length
      const cf = Math.min(1.8, ((sec(l.to) - sec(l.from)) * 0.78) / n)
      return Array.from({ length: Math.ceil(n / 2) }, (_, i) => <Sfx key={`${k}-${i}`} name="type" at={sec(l.from) + i * 2 * cf} volume={0.22} />)
    })}
    {HOST_LINES.map((l, k) => <Sfx key={`p${k}`} name="pop" at={sec(l.from)} volume={0.2} />)}
  </>
)

// ---------------------------------------------------------------------------
// Couche « chibi qui parle » : 0 → 9,7 s (message, présage, rafale).
// ---------------------------------------------------------------------------
export const TakeLayer: React.FC<{ f: number }> = ({ f }) => {
  if (f >= F_GLACON) return null
  const p = ramp(f, F_PRESAGE, F_CUT) * 0.55 + ramp(f, F_CUT, F_GLACON) * 0.45
  const sh = shake(f, F_CUT, 30, 20, 'rafale')
  // Le salon bleuit et se couvre de givre.
  const blue = ramp(f, F_PRESAGE, F_CUT) * 0.28 + ramp(f, F_CUT, F_GLACON) * 0.2
  const frostVig = ramp(f, F_PRESAGE + 10, F_GLACON)
  // Flocon sticker qui passe devant (7,0 → 8,0 s).
  const fp = ramp(f, F_PRESAGE, F_PRESAGE + 28)
  const flakeX = lerp(-220, 960, fp)
  const flakeY = 560 - 230 * Math.sin(fp * Math.PI * 0.9) + Math.sin(fp * 7) * 30
  const flash = [1, 1, 0.75, 0.5, 0.3, 0.16, 0.07][f - F_CUT] ?? 0
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px,${sh.y}px) rotate(${sh.r}deg) scale(${1 + Math.min(0.09, Math.hypot(sh.x, sh.y) * 0.0042)})` }}>
        <Room f={f} />
        <AbsoluteFill style={{ background: `rgba(96,170,255,${blue})` }} />
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, rgba(210,240,255,0) 48%, rgba(210,240,255,${0.7 * frostVig}) 100%)` }} />
        <Frost p={p} />
      </AbsoluteFill>
      <HostBubble f={f} />
      <Storm f={f} amount={f < F_CUT ? ramp(f, F_PRESAGE + 14, F_CUT) * 0.3 : 1} speed={f < F_CUT ? 0.6 : 1.1} />
      <Streaks f={f} amount={f < F_CUT ? ramp(f, F_PRESAGE + 20, F_CUT) * 0.25 : 1} />
      {fp > 0 && fp < 1 && (
        <div style={{ position: 'absolute', left: flakeX - 140, top: flakeY - 140, transform: `rotate(${fp * 300}deg) scale(${0.8 + 0.5 * Math.sin(fp * Math.PI)})` }}>
          <Flake size={280} outline shadow />
        </div>
      )}
      {flash > 0 && <AbsoluteFill style={{ background: '#ffffff', opacity: flash }} />}
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------
// Glaçon-sticker : 9,7 → 12,0 s (puis il éclate, voir Shards).
// ---------------------------------------------------------------------------
const FaceTint: React.FC<{ f: number }> = ({ f }) => {
  const sweep = ((f * 5) % 1400) - 500
  return (
    <>
      <AbsoluteFill style={{ background: 'rgba(118,196,255,0.5)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 70%, rgba(190,235,255,0.55) 100%)' }} />
      <div style={{ position: 'absolute', left: sweep, top: -200, width: 150, height: 1700, background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.4), rgba(255,255,255,0))', transform: 'rotate(18deg)' }} />
      <div style={{ position: 'absolute', left: 110, top: 90, width: 56, height: 640, borderRadius: 40, background: 'rgba(255,255,255,0.28)', transform: 'rotate(8deg)' }} />
    </>
  )
}

const crackPath = (p: Pt[]) => `M${p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}`

const Cracks: React.FC<{ f: number }> = ({ f }) => {
  // grow : progression de chaque « crac » sur 3 images.
  const grow = (k: number) => easeInOut(ramp(f, F_CRACKS[k], F_CRACKS[k] + 3))
  const items: { d: string; w: number }[] = []
  CRACK_RAYS.forEach((r, i) => {
    let reach = 0
    CRACK_REACH.forEach((row, k) => {
      if (f >= F_CRACKS[k]) reach = Math.max(reach, lerp(k ? CRACK_REACH[k - 1][i] : 0, row[i], grow(k)))
    })
    if (reach > 0.01) items.push({ d: crackPath(partial(r, reach)), w: 6 })
  })
  if (f >= F_CRACKS[1]) CRACK_RINGS.forEach((r, i) => items.push({ d: crackPath(partial(r, grow(1) * (i % 2 ? 0.5 : 0.7) + grow(2) * 0.5)), w: 5 }))
  if (f >= F_CRACKS[2]) MICRO_CRACKS.forEach((m) => items.push({ d: crackPath(partial(m, grow(2))), w: 4 }))
  return (
    <svg width={CUBE_W} height={CUBE_H} style={{ position: 'absolute', left: 0, top: 0 }}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {items.map((it, i) => <path key={i} d={it.d} stroke={C.ink} strokeWidth={it.w + 4} />)}
        {items.map((it, i) => <path key={i} d={it.d} stroke="#ffffff" strokeWidth={it.w - 2.5} opacity={0.9} />)}
      </g>
    </svg>
  )
}

const TEETH = rimTeeth('rim')
/** Dents de givre sur tout le pourtour du glaçon. */
const Rim: React.FC<{ k: number }> = ({ k }) => (
  <svg width={CUBE_W} height={CUBE_H} style={{ position: 'absolute', left: 0, top: 0 }}>
    {TEETH.map(([a, tip, b], i) => {
      const mx = (a[0] + b[0]) / 2
      const my = (a[1] + b[1]) / 2
      return <polygon key={i} points={pts([a, [mx + (tip[0] - mx) * k, my + (tip[1] - my) * k], b])} fill="#ffffff" stroke={C.ink} strokeWidth={4} strokeLinejoin="round" />
    })}
  </svg>
)

/** Glaçon entier (face, givre, fissures, contour d'encre épais + ombre décalée). */
const IceBlock: React.FC<{ f: number; cracks?: boolean }> = ({ f, cracks = true }) => (
  <>
    <svg width={CUBE_W} height={CUBE_H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      <polygon points={pts(CUBE_POLY)} fill={C.ink} transform="translate(16,16)" strokeLinejoin="round" stroke={C.ink} strokeWidth={16} />
    </svg>
    <div style={{ position: 'absolute', left: 0, top: 0, width: CUBE_W, height: CUBE_H, clipPath: clipPoly(CUBE_POLY), overflow: 'hidden' }}>
      <FrozenFace />
      <FaceTint f={f} />
      <Rim k={easeOut(ramp(f, F_GLACON, F_GLACON + 22))} />
      <Frost p={1} />
      {cracks && <Cracks f={f} />}
    </div>
    <svg width={CUBE_W} height={CUBE_H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      <polygon points={pts(CUBE_POLY)} fill="none" stroke={C.ink} strokeWidth={18} strokeLinejoin="round" />
      <polygon points={pts(CUBE_POLY)} fill="none" stroke="#ffffff" strokeWidth={4} strokeLinejoin="round" opacity={0.55} transform="translate(360,640) scale(0.975) translate(-360,-640)" />
    </svg>
  </>
)

const SPARKS: { x: number; y: number; s: number; ph: number }[] = [
  { x: 40, y: 170, s: 86, ph: 0 }, { x: 690, y: 330, s: 66, ph: 9 }, { x: 60, y: 980, s: 70, ph: 17 }, { x: 676, y: 1090, s: 92, ph: 5 }, { x: 600, y: 80, s: 54, ph: 13 },
]

/** Fond froid + glaçon + étincelles (9,7 → 12,0 s). */
export const IceScene: React.FC<{ f: number }> = ({ f }) => {
  if (f < F_GLACON || f >= F_NOEL) return null
  const t = f - F_GLACON
  const k = sp(f, F_GLACON, { stiffness: 260, damping: 14 })
  const scale = lerp(1, 0.9, k)
  const rot = lerp(0, 3, k) + Math.sin(f * 0.37) * 0.35
  // Tension avant chaque « crac » (frémissement) puis secousse.
  let tremble = 0
  let jolt = { x: 0, y: 0, r: 0 }
  F_CRACKS.forEach((c, i) => {
    tremble = Math.max(tremble, ramp(f, c - 9, c) * (i + 1) * 1.1)
    const j = shake(f, c, 9, 9 + i * 8, `crack${i}`)
    jolt = { x: jolt.x + j.x, y: jolt.y + j.y, r: jolt.r + j.r }
  })
  const end = ramp(f, F_CRACKS[2] + 3, F_NOEL) * 7
  const trem = { x: (random(`tx${f}`) - 0.5) * (tremble + end), y: (random(`ty${f}`) - 0.5) * (tremble + end) }
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, #2f86ff 0%, #52b8ff 55%, #9fe2ff 100%)' }} />
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.22) 3px, transparent 3.6px)', backgroundSize: '40px 40px' }} />
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.45), rgba(255,255,255,0) 62%)' }} />
      <Storm f={f} amount={0.5} speed={0.9} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: CUBE_W, height: CUBE_H, transformOrigin: '360px 640px', transform: `translate(${jolt.x + trem.x}px,${jolt.y + trem.y}px) rotate(${rot + jolt.r}deg) scale(${scale})` }}>
        <IceBlock f={f} />
      </div>
      {SPARKS.map((s, i) => {
        const a = sp(f, F_GLACON + 3 + i * 2, { stiffness: 300, damping: 12 })
        const tw = 0.8 + 0.3 * Math.sin((t + s.ph) / 3.2)
        return <Sparkle key={i} size={s.s * a * tw} style={{ position: 'absolute', left: s.x - (s.s * a * tw) / 2, top: s.y - (s.s * a * tw) / 2, transform: `rotate(${t * 2}deg)` }} />
      })}
      {/* L'éclat de froid à l'arrêt sur image : flocons-stickers qui jaillissent du glaçon. */}
      {t < 14 &&
        Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2 + 0.3
          const d = (1 - (1 - Math.min(1, t / 11)) ** 2) * (560 + (i % 2) * 140)
          return <Flake key={i} size={64 - (i % 3) * 12} outline style={{ position: 'absolute', left: 360 + Math.cos(a) * d - 36, top: 640 + Math.sin(a) * d * 1.15 - 36, opacity: 1 - ramp(t, 6, 12), transform: `rotate(${t * 18 + i * 40}deg)` }} />
        })}
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------
// Les 14 éclats : à 12,0 s ils jaillissent (certains passent devant Kéké, d'autres derrière).
// ---------------------------------------------------------------------------
export const Shards: React.FC<{ f: number; front: boolean }> = ({ f, front }) => {
  const t = f - F_NOEL
  if (t < 0 || t > 36) return null
  return (
    <AbsoluteFill style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: CUBE_W, height: CUBE_H, transformOrigin: '360px 640px', transform: `rotate(3deg) scale(0.9)` }}>
        {SHARDS.map((s, i) => {
          const isFront = i % 2 === 0
          if (isFront !== front) return null
          const dx = s.cx - 372
          const dy = s.cy - 560
          const d = Math.hypot(dx, dy) || 1
          const reach = 620 + random(`sv${i}`) * 520 + s.ring * 160
          const q = 1 - Math.pow(2, -6.5 * Math.min(1, t / 24))
          const x = (dx / d) * reach * q
          const y = (dy / d) * reach * q + 0.3 * t * t - 20 * q
          const rot = (random(`sr${i}`) - 0.5) * 120 * q
          const sc = 1 + (0.5 + random(`ss${i}`) * 0.9) * q
          return (
            <div key={i} style={{ position: 'absolute', left: 0, top: 0, width: CUBE_W, height: CUBE_H, transformOrigin: `${s.cx}px ${s.cy}px`, transform: `translate(${x}px,${y}px) rotate(${rot}deg) scale(${sc})`, opacity: 1 - ramp(t, 18, 34) }}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: CUBE_W, height: CUBE_H, clipPath: clipPoly(s.poly), overflow: 'hidden' }}>
                <FrozenFace />
                <FaceTint f={0} />
              </div>
              <svg width={CUBE_W} height={CUBE_H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
                <polygon points={pts(s.poly)} fill="none" stroke={C.ink} strokeWidth={16} strokeLinejoin="round" />
                <polygon points={pts(s.poly)} fill="none" stroke="#ffffff" strokeWidth={4} strokeLinejoin="round" opacity={0.6} transform={`translate(${s.cx},${s.cy}) scale(0.93) translate(${-s.cx},${-s.cy})`} />
              </svg>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

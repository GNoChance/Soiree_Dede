// Temps 8 à 11 de la vidéo de Noël : le Pass (26,5 s), la Grande Hotte (32,5 s), le rendez-vous et la chute (39,5 s).
import React from 'react'
import { AbsoluteFill, Img, random, staticFile } from 'remotion'
import { C, DISPLAY, sticker } from '../theme'
import { Bubble, ConfettiBurst, Outlined, Panel, Pill, Pop, SPRING, bob, clamp01, easeIn, easeInOut, lerp, nb, ramp, sp, wiggle } from '../tuto/kit'
import { BEAT, Flake, N, Sparkle, shake, step3 } from './fx'
import { NOEL } from './script'
import { Sfx } from './sfx'
import { BAND, Big, Burst, Header, Logo, Row, Sack, Santa, SceneBg, outBack, outExpo, stampK, type Scene } from './scenes'

// ---------------------------------------------------------------------------
// 8. Le Pass de Noël (26,5 → 32,5 s, fond rouge) : travelling le long de 30 cases, freinage sur PALIER 30, explosion.
// ---------------------------------------------------------------------------
const REWARD: Record<number, string> = { 3: '🧝', 6: '🪙', 9: '🍭', 10: '✨', 12: '🎀', 15: '🔴', 18: '✨', 20: '🪵', 22: '💡', 25: '✨', 27: '🌿', 29: '🔔' }
const SPACING = 140
const CY = 664
const V = 29 / 82 // cases par image en croisière
/** Position (case n° 1 → 30) : accélération f6-12, croisière, freinage f84-98. */
const passPos = (f: number) => {
  if (f <= 6) return 1
  if (f < 12) return 1 + (V * (f - 6) ** 2) / 12
  if (f < 84) return 1 + V * 3 + V * (f - 12)
  if (f < 98) {
    const t = f - 84
    return 1 + V * 75 + V * (t - (t * t) / 28)
  }
  return 30
}

const GiftBox: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size * 1.05} viewBox="0 0 200 210" style={{ display: 'block', overflow: 'visible' }}>
    <rect x={22} y={84} width={156} height={112} rx={10} fill="#e63946" stroke={C.ink} strokeWidth={8} />
    <rect x={10} y={58} width={180} height={38} rx={10} fill="#ff5a65" stroke={C.ink} strokeWidth={8} />
    <rect x={84} y={58} width={32} height={138} fill={N.gold} stroke={C.ink} strokeWidth={6} />
    <path d="M100,58 C70,6 18,22 50,58 Z" fill={N.gold} stroke={C.ink} strokeWidth={7} strokeLinejoin="round" />
    <path d="M100,58 C130,6 182,22 150,58 Z" fill={N.gold} stroke={C.ink} strokeWidth={7} strokeLinejoin="round" />
    <circle cx={100} cy={58} r={13} fill="#ffe08a" stroke={C.ink} strokeWidth={6} />
    <path d="M30,100 L30,170" stroke="#ff8f98" strokeWidth={9} strokeLinecap="round" />
  </svg>
)

/** Les 10 chibis (Père Noël) : rang, position cible, taille. */
const PYRAMID: { slug: (typeof BAND)[number]; x: number; y: number; s: number; expr: string }[] = [
  { slug: 'dede', x: 140, y: 640, s: 190, expr: 'joie' },
  { slug: 'manon', x: 290, y: 630, s: 190, expr: 'clin_oeil' },
  { slug: 'mika', x: 430, y: 630, s: 190, expr: 'cool' },
  { slug: 'cecile', x: 580, y: 640, s: 190, expr: 'joie' },
  { slug: 'cycy', x: 212, y: 770, s: 207, expr: 'gamer' },
  { slug: 'kevin', x: 360, y: 762, s: 222, expr: 'cool' },
  { slug: 'carole', x: 508, y: 770, s: 207, expr: 'clin_oeil' },
  { slug: 'nini', x: 150, y: 908, s: 216, expr: 'joie' },
  { slug: 'cycy2', x: 360, y: 912, s: 227, expr: 'gamer' },
  { slug: 'marius', x: 570, y: 908, s: 216, expr: 'joie' },
]

export const Pass: Scene = ({ f }) => {
  const t = NOEL.pass
  const pos = passPos(f)
  const REVEAL = 120
  const brake = f >= 84 && f < 100 ? Math.sin(ramp(f, 84, 100) * Math.PI) : 0
  const fast = f > 6 && f < 98
  const num = Math.max(1, Math.min(30, Math.floor(pos + 0.02)))
  const near30 = clamp01(1 - Math.abs(30 - pos) / 2.4)
  const rattle = f >= 100 && f < REVEAL ? shake(f, 100, 20, 4 + ramp(f, 100, 120) * 14, 'gift') : { x: 0, y: 0, r: 0 }
  const gone = f >= REVEAL
  const enter = clamp01(sp(f, 4, SPRING.snappy))
  const x0 = 360 + (1 - pos) * SPACING - 60
  const x1 = Math.min(780, 360 + (30 - pos) * SPACING)
  return (
    <AbsoluteFill>
      <SceneBg f={f} />
      <Header f={f} at={6}>{t.titre}</Header>
      <Big f={f} at={12} top={216} size={60} color="#ffffff">{nb(t.accroche)}</Big>
      {/* traînées de vitesse (la caméra file vers la droite) */}
      {fast && (
        <AbsoluteFill style={{ overflow: 'hidden', opacity: 0.8 * (1 - brake * 0.6) }}>
          {Array.from({ length: 12 }, (_, k) => {
            const y = 560 + random(`pl${k}`) * 210
            const len = 140 + random(`pm${k}`) * 260
            const x = 760 - (((f * (50 + random(`pn${k}`) * 40)) + random(`po${k}`) * 1000) % (TWPAD + len))
            return <div key={k} style={{ position: 'absolute', left: x, top: y, width: len, height: 5, borderRadius: 3, background: 'linear-gradient(270deg, rgba(255,255,255,0), #fff)' }} />
          })}
        </AbsoluteFill>
      )}
      {f >= 86 && (
        <div style={{ position: 'absolute', left: 360 - 900, top: 664 - 900, width: 1800, height: 1800, opacity: ramp(f, 86, 100) * (1 - ramp(f, REVEAL, REVEAL + 8)), transform: `rotate(6deg)`, background: 'repeating-conic-gradient(rgba(255,255,255,0.16) 0deg 7.5deg, rgba(255,255,255,0) 7.5deg 15deg)', WebkitMaskImage: 'radial-gradient(circle, #000 0%, #000 18%, transparent 46%)', maskImage: 'radial-gradient(circle, #000 0%, #000 18%, transparent 46%)' }} />
      )}
      {/* la piste : un ruban de 30 cases */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 720, height: 1280, transform: `translateX(${(1 - enter) * 760}px) rotate(${-brake * 2.4}deg)`, transformOrigin: '360px 664px', opacity: 1 - ramp(f, REVEAL - 1, REVEAL + 4), display: f > REVEAL + 5 ? 'none' : undefined }}>
        <div style={{ position: 'absolute', left: x0, top: CY - 13, width: Math.max(0, x1 - x0), height: 26, background: C.surface, border: `5px solid ${C.ink}`, boxSizing: 'border-box' }} />
        <div style={{ position: 'absolute', left: x0, top: CY - 13, width: Math.max(0, 360 - x0), height: 26, background: N.gold, border: `5px solid ${C.ink}`, boxSizing: 'border-box' }} />
        {Array.from({ length: 30 }, (_, i) => {
          const n = i + 1
          const x = 360 + (n - pos) * SPACING
          if (x < -90 || x > 810) return null
          if (n === 30 && gone) return null
          const big = n === 30
          const d = big ? 0 : 104
          const passed = n <= pos + 0.02
          return big ? null : (
            <div key={n} style={{ position: 'absolute', left: x - d / 2, top: CY - d / 2, width: d, height: d }}>
              <div style={{ width: d, height: d, borderRadius: 24, background: passed ? N.gold : C.surface, border: `5px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(5), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 52, lineHeight: 1, transform: `rotate(${n % 2 ? -3 : 3}deg)` }}>
                {REWARD[n] ?? '🎁'}
              </div>
              <Outlined size={34} stroke={3} style={{ position: 'absolute', left: -30, right: -30, top: d + 8 }}>{n}</Outlined>
            </div>
          )
        })}
        {/* PALIER 30 : le gros cadeau */}
        {!gone && near30 > 0 && (
          <div style={{ position: 'absolute', left: 360 + (30 - pos) * SPACING - 125 + rattle.x, top: CY - 135 + rattle.y, transform: `scale(${lerp(0.5, 1, easeIn(near30)) * (1 + (f >= 100 ? 0.02 * Math.sin(f * 1.7) : 0))}) rotate(${rattle.r * 2}deg)`, transformOrigin: '50% 60%' }}>
            <GiftBox size={250} />
          </div>
        )}
      </div>
      {/* compteur */}
      <div style={{ position: 'absolute', left: 360 - 105, top: 326, width: 210, height: 210, transform: `scale(${clamp01(sp(f, 10, SPRING.pop)) * (1 - easeIn(ramp(f, 84, 92)))}) rotate(-4deg)` }}>
        <div style={{ width: 210, height: 210, borderRadius: '50%', background: N.gold, border: `6px solid ${C.ink}`, boxShadow: sticker(8), boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontWeight: 800, color: C.ink }}>
          <div style={{ fontSize: 30, lineHeight: 1, letterSpacing: 1 }}>PALIER</div>
          <div style={{ fontSize: 124, lineHeight: 0.95 }}>{num}</div>
        </div>
      </div>
      {/* « PALIER 30 » : bandeau sur le gros cadeau */}
      {f >= 88 && f < REVEAL + 6 && (
        <Row top={494} style={{ opacity: 1 - ramp(f, REVEAL, REVEAL + 6) }}>
          <Pop f={f} at={88} rot={-4} cfg={SPRING.pop}><Pill bg={N.red} color="#ffffff" size={50}>{t.palier}</Pill></Pop>
        </Row>
      )}
      {/* les 3 cadeaux, au passage ; la série en bas */}
      {t.cadeaux.map((c, k) => {
        const leave = 1 - easeIn(ramp(f, 82 + k * 2, 92 + k * 2))
        return (
          <Row key={k} top={790 + k * 92}>
            <div style={{ transform: `scale(${leave})`, marginLeft: [-80, 60, -30][k] }}>
              <Pop f={f} at={30 + k * 15} rot={k % 2 ? 2 : -2} from={50} cfg={SPRING.pop}>
                <Pill bg={k === 1 ? N.gold : C.surface} size={46}>{nb(c)}</Pill>
              </Pop>
            </div>
          </Row>
        )
      })}
      <Row top={1074}>
        <div style={{ transform: `scale(${1 - easeIn(ramp(f, REVEAL, REVEAL + 6))})` }}>
          <Pop f={f} at={66} rot={1} cfg={SPRING.pop}><Pill bg={C.surface} size={36}>{t.serie}</Pill></Pop>
        </div>
      </Row>
      {/* explosion du cadeau : les 10 chibis jaillissent en éventail */}
      {f >= REVEAL && (
        <>
          <Burst f={f} at={REVEAL} x={360} y={664} reach={720} seed="p30" />
          <ConfettiBurst f={f} at={REVEAL} x={360} y={664} n={30} seed="pass30" />
          {PYRAMID.map((c, k) => {
            const at = REVEAL + 1 + Math.floor(k * 0.6)
            const s = sp(f, at, { stiffness: 280, damping: 12 })
            const a = (k / 10) * Math.PI * 2
            const ox = 360 + Math.cos(a) * 20
            const oy = 664 + Math.sin(a) * 20
            return (
              <div key={k} style={{ position: 'absolute', left: lerp(ox, c.x, s) - c.s / 2, top: lerp(oy, c.y, s) - c.s / 2, transform: `scale(${Math.max(0.15, s)}) rotate(${(1 - s) * (k % 2 ? 160 : -160)}deg)`, zIndex: k }}>
                <Santa slug={c.slug} expr={c.expr} size={c.s} style={{ transform: `translateY(${f > 135 ? bob(step3(f), k * 9, 6, 30) : 0}px)` }} />
              </div>
            )
          })}
          <Row top={332} style={{ zIndex: 20 }}>
            <Pop f={f} at={REVEAL + 3} rot={-3} from={50} cfg={SPRING.pop}>
              <Outlined size={62} color={N.gold} stroke={6}>{nb(t.tenue)}</Outlined>
            </Pop>
          </Row>
        </>
      )}
      {f >= 150 && (() => {
        const k = stampK(f, 150)!
        return (
          <Row top={1010} style={{ zIndex: 30 }}>
            <div style={{ transform: `scale(${k.s}) rotate(-7deg)`, opacity: k.op }}>
              <Panel bg={C.tomato} radius={24} shadow={8} style={{ position: 'relative', padding: '16px 30px 8px', fontSize: 44, lineHeight: 1.1, color: '#ffffff', whiteSpace: 'nowrap', border: `6px solid ${C.ink}` }}>
                <div style={{ position: 'absolute', left: 8, top: 8, right: 8, bottom: 8, borderRadius: 16, border: '3px dashed rgba(255,255,255,0.8)' }} />
                {nb(t.tampon)}
              </Panel>
            </div>
          </Row>
        )
      })()}
      {f >= REVEAL && f < REVEAL + 4 && <AbsoluteFill style={{ background: '#ffffff', opacity: [1, 0.7, 0.4, 0.15][f - REVEAL] }} />}
      <Sfx name="whoosh" at={4} volume={0.45} />
      <Sfx name="pop" at={8} volume={0.4} />
      <Sfx name="whoosh" at={10} volume={0.4} />
      {t.cadeaux.map((_, k) => <Sfx key={k} name="pop" at={30 + k * 15} volume={0.55} />)}
      <Sfx name="pop" at={66} volume={0.5} />
      <Sfx name="skid" at={84} volume={0.6} />
      <Sfx name="pop" at={88} volume={0.5} />
      {[102, 108, 113, 117].map((a) => <Sfx key={a} name="tap" at={a} volume={0.35} />)}
      <Sfx name="boom" at={REVEAL} volume={0.7} />
      <Sfx name="shatter" at={REVEAL} volume={0.35} />
      <Sfx name="success" at={REVEAL + 1} volume={0.6} />
      {PYRAMID.map((_, k) => <Sfx key={k} name="pop" at={REVEAL + 2 + k} volume={0.35} />)}
      <Sfx name="stamp" at={150} volume={0.9} />
    </AbsoluteFill>
  )
}
const TWPAD = 720 + 760

// ---------------------------------------------------------------------------
// 9. La Grande Hotte (32,5 → 39,5 s, fond vert) : la bande remplit la hotte, le Gros Lot, Marius dort.
// ---------------------------------------------------------------------------
const SLOTS = BAND.map((_, i) => {
  const left = i < 5
  const r = i % 5
  return { x: left ? (r % 2 ? 128 : 74) : 720 - (r % 2 ? 128 : 74), y: 548 + r * 118 }
})
const PAL_X = [96, 228, 360, 492, 624]
const MOUTH = { x: 360, y: 884 }
const SACK_TOP = 764

export const GrandeHotte: Scene = ({ f }) => {
  const t = NOEL.grandeHotte
  const PAL = [30, 45, 60, 75, 90]
  const fill = ramp(f, 30, 90)
  const swell = f >= 90 ? ramp(f, 90, 105) : 0
  const burst = f >= 105
  const out = easeIn(ramp(f, 98, 107)) // la bande et les paliers s'envolent
  const sackShake = f >= 90 && f < 105 ? shake(f, 90, 15, 5 + swell * 10, 'sack') : { x: 0, y: 0, r: 0 }
  const sackOut = easeIn(ramp(f, 105, 120))
  // Marius dort dans le coin ; boule de neige à 38,0 s (f165) ; il se réveille.
  const snow = ramp(f, 155, 165)
  const wake = f >= 165
  const wakeJump = f >= 165 && f < 177 ? Math.sin(((f - 165) / 12) * Math.PI) * -70 : 0
  const sh = shake(f, 105, 10, 12, 'gros')
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px,${sh.y}px) scale(1.03)` }}>
        <SceneBg f={f} />
        <Header f={f} at={6}>{t.titre}</Header>
        {/* stade 1 : la bande lance des flocons dans la hotte */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 720, height: 1280, transform: `translateX(${out * 900}px)`, opacity: 1 - out * 0.5 }}>
          <div style={{ position: 'absolute', left: 12, right: 12, top: 200, textAlign: 'center' }}>
            <Pop f={f} at={10} from={40}><Outlined size={64} color="#ffffff" stroke={6}>Toute la bande</Outlined></Pop>
          </div>
          <div style={{ position: 'absolute', left: 12, right: 12, top: 268 }}>
            <Pop f={f} at={15} from={40}><Outlined size={64} color={N.gold} stroke={6}>la remplit !</Outlined></Pop>
          </div>
          {/* le ruban des 5 paliers */}
          <Pop f={f} at={20} from={40} style={{ position: 'absolute', left: PAL_X[0], top: 417, width: PAL_X[4] - PAL_X[0], height: 22 }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 11, background: C.surface, border: `5px solid ${C.ink}`, boxSizing: 'border-box', overflow: 'hidden' }}>
              <div style={{ width: `${fill * 100}%`, height: '100%', background: C.sky }} />
            </div>
          </Pop>
          {t.paliers.map((p, k) => {
            const on = f >= PAL[k]
            const hit = on ? 1 + 0.38 * Math.sin(ramp(f, PAL[k], PAL[k] + 10) * Math.PI) : 1
            const d = k === 4 ? 104 : 88
            return (
              <Pop key={k} f={f} at={20 + k} cfg={SPRING.pop} style={{ position: 'absolute', left: PAL_X[k] - d / 2, top: 428 - d / 2, width: d, height: d }}>
                <div style={{ width: d, height: d, borderRadius: '50%', background: on ? N.gold : C.surface, border: `5px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(4), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: d * 0.5, lineHeight: 1, transform: `scale(${hit})` }}>{p}</div>
              </Pop>
            )
          })}
        </div>
        {/* la hotte géante : se remplit puis gonfle */}
        <div style={{ position: 'absolute', left: 360 - 200 + sackShake.x, top: SACK_TOP + sackShake.y + sackOut * 700, opacity: 1 - sackOut, transform: `scale(${(1 + 0.2 * swell) * (1 + (f > 30 && f < 90 ? 0.015 * Math.sin(f / 2) : 0))}) rotate(${sackShake.r + sackOut * 40}deg)`, transformOrigin: '50% 90%' }}>
          <Pop f={f} at={14} from={500} cfg={SPRING.bouncy}>
            <div style={{ position: 'relative' }}>
              <Sack w={400} />
              <div style={{ position: 'absolute', left: 200 - lerp(30, 140, fill), top: 124 - lerp(4, 56, fill), width: lerp(60, 280, fill), height: lerp(10, 112, fill), borderRadius: '50%', background: '#ffffff', border: `5px solid ${C.ink}`, boxSizing: 'border-box', opacity: fill > 0.01 ? 1 : 0 }} />
            </div>
          </Pop>
        </div>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 720, height: 1280, transform: `translateX(${out * 900}px)`, opacity: 1 - out * 0.5 }}>
          {BAND.map((slug, i) => (
            <Pop key={slug} f={f} at={8 + i * 2} cfg={SPRING.bouncy} style={{ position: 'absolute', left: SLOTS[i].x - 70, top: SLOTS[i].y - 70 + bob(step3(f), i * 7, 12, 24) }}>
              <Santa slug={slug} expr={f >= 100 || i % 3 === 0 ? 'joie' : 'clin_oeil'} size={140} flip={i >= 5} />
            </Pop>
          ))}
          {/* flocons lancés dans la hotte */}
          {Array.from({ length: 32 }, (_, j) => {
            const who = j % 10
            const at = 24 + Math.floor(j / 10) * 14 + who * 1.4
            const u = (f - at) / 22
            if (u < 0 || u >= 1) return null
            const sx = SLOTS[who].x
            const sy = SLOTS[who].y - 20
            const tx = MOUTH.x + (random(`gt${j}`) - 0.5) * 140
            const x = lerp(sx, tx, easeInOut(u))
            const y = lerp(sy, MOUTH.y - 10, u * u * 0.4 + u * 0.6) - Math.sin(u * Math.PI) * 200
            return <Flake key={j} size={54 * (1 - 0.4 * u)} outline style={{ position: 'absolute', left: x - 30, top: y - 30, transform: `rotate(${f * 9 + j * 40}deg)` }} />
          })}
        </div>
        {/* stade 2 : LE GROS LOT */}
        {burst && (
          <>
            <Burst f={f} at={105} x={360} y={880} reach={680} seed="gh" />
            <ConfettiBurst f={f} at={105} x={360} y={820} n={30} seed="gros" />
            <div style={{ position: 'absolute', left: 8, right: 8, top: 196 }}>
              <Pop f={f} at={105} from={60} cfg={SPRING.pop}><Outlined size={84} color={N.gold} stroke={7}>{t.grosLot}</Outlined></Pop>
            </div>
            {t.lots.map((lot, k) => (
              <Pop key={k} f={f} at={120 + k * 15} rot={k % 2 ? 1.5 : -1.5} from={0} cfg={SPRING.snappy} style={{ position: 'absolute', left: 36, top: 340 + k * 138 }}>
                <Panel bg={k === 0 ? '#fff3c4' : C.surface} radius={32} style={{ position: 'relative', width: 648, height: 124, display: 'flex', alignItems: 'center', gap: 16, padding: '0 22px' }}>
                  {k === 0 && (
                    <div style={{ position: 'relative', width: 96, height: 96, flexShrink: 0 }}>
                      <Img src={staticFile('chibis/kevin/santa/joie.webp')} style={{ width: 96, height: 96, objectFit: 'contain', filter: 'brightness(0)' }} />
                      <div style={{ position: 'absolute', left: 0, right: 0, top: 18, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 60, lineHeight: 1, color: '#ffffff' }}>?</div>
                    </div>
                  )}
                  <div style={{ fontSize: k === 0 ? 40 : 42, lineHeight: 1.05, paddingTop: 6 }}>{nb(lot)}</div>
                </Panel>
              </Pop>
            ))}
          </>
        )}
        {/* Marius fait la sieste dans le coin, reçoit une boule de neige */}
        {f >= 150 && (
          <div style={{ position: 'absolute', right: 6, top: 1046 + wakeJump, transform: `rotate(${wake ? wiggle(f, 0, 4, 10) : 0}deg)`, opacity: clamp01((f - 150) / 4) }}>
            <Img src={staticFile(`chibis/marius/default/${wake ? 'surprise' : 'dodo'}.webp`)} style={{ width: 196, height: 196, objectFit: 'contain', display: 'block' }} />
          </div>
        )}
        {f >= 155 && f < 165 && (
          <div style={{ position: 'absolute', left: lerp(-40, 560, snow) - 30, top: lerp(930, 1096, snow) - Math.sin(snow * Math.PI) * 120 - 30, width: 64, height: 64, borderRadius: '50%', background: '#ffffff', border: `5px solid ${C.ink}`, boxShadow: sticker(3), boxSizing: 'border-box', transform: `rotate(${snow * 400}deg)` }} />
        )}
        {f >= 165 && f < 184 && (
          <>
            {Array.from({ length: 7 }, (_, i) => {
              const a = (i / 7) * Math.PI * 2
              const u = ramp(f, 165, 184)
              return <div key={i} style={{ position: 'absolute', left: 600 + Math.cos(a) * u * 110 - 10, top: 1120 + Math.sin(a) * u * 90 - 10, width: 22 - u * 10, height: 22 - u * 10, borderRadius: '50%', background: '#ffffff', border: `3px solid ${C.ink}`, boxSizing: 'border-box', opacity: 1 - u }} />
            })}
          </>
        )}
        {/* 38,5 s : « 400 » énorme */}
        {f >= 180 && (() => {
          const k = stampK(f, 180)!
          return (
            <div style={{ position: 'absolute', left: 36, top: 772, width: 648, opacity: k.op, transform: `scale(${k.s}) rotate(-3deg)` }}>
              <Panel bg={C.surface} radius={36} shadow={9} style={{ padding: '14px 20px 6px', textAlign: 'center', position: 'relative' }}>
                <div style={{ fontSize: 44, lineHeight: 1.1 }}>{nb(t.condition[0])}</div>
                <div style={{ fontSize: 40, lineHeight: 1.05, color: C.muted }}>{nb(t.condition[1])}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  <Outlined size={168} color={N.gold} stroke={9} style={{ lineHeight: 1 }}>400</Outlined>
                  <Outlined size={120} color={N.gold} stroke={7} style={{ lineHeight: 1 }}>❄️ !</Outlined>
                </div>
              </Panel>
            </div>
          )
        })()}
      </AbsoluteFill>
      <Sfx name="whoosh" at={4} volume={0.4} />
      <Sfx name="pop" at={8} volume={0.4} />
      {BAND.map((_, i) => <Sfx key={i} name="pop" at={9 + i * 2} volume={0.18} />)}
      {PAL.map((a) => <Sfx key={a} name="success" at={a} volume={0.5} />)}
            <Sfx name="boom" at={105} volume={0.65} />
      <Sfx name="shatter" at={105} volume={0.3} />
      <Sfx name="stamp" at={105} volume={0.5} />
      {t.lots.map((_, k) => <Sfx key={k} name="pop" at={120 + k * 15} volume={0.55} />)}
      <Sfx name="whoosh" at={152} volume={0.4} />
      <Sfx name="stamp" at={165} volume={0.5} />
      <Sfx name="pop" at={166} volume={0.6} />
      <Sfx name="stamp" at={180} volume={0.95} />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------
// 10 + 11. Le rendez-vous (39,5 → 42,5 s) puis la chute (42,5 → 45,0 s), fond rouge.
// ---------------------------------------------------------------------------
const PAGES = [
  { n: '1', m: 'DÉCEMBRE', c: C.tomato },
  { n: '2', m: 'DÉCEMBRE', c: C.tomato },
  { n: '3', m: 'DÉCEMBRE', c: C.tomato },
  { n: '4', m: 'DÉCEMBRE', c: C.tomato },
  { n: '6', m: 'JANVIER', c: N.green },
]
const TEAR = [15, 30, 45, 60]

const CalPage: React.FC<{ p: (typeof PAGES)[number] }> = ({ p }) => (
  <Panel radius={30} shadow={8} style={{ width: 520, height: 640, overflow: 'hidden', position: 'relative' }}>
    <div style={{ height: 124, background: p.c, borderBottom: `5px solid ${C.ink}`, boxSizing: 'border-box', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 14, fontSize: 60, lineHeight: 1, color: '#ffffff', letterSpacing: 2 }}>{p.m}</div>
    <div style={{ textAlign: 'center', fontSize: 400, lineHeight: '470px', color: C.ink }}>{p.n}</div>
  </Panel>
)

export const Rdv: Scene = ({ f }) => {
  const t = NOEL.fin
  const c = NOEL.chute
  const logoAt = 60
  const calOut = easeIn(ramp(f, 66, 80))
  const appelOut = easeIn(ramp(f, 54, 62))
  const iconIn = clamp01(sp(f, 72, SPRING.pop))
  const fl = ramp(f, 60, 75) // le flocon vole vers l'icône
  const badge = clamp01(sp(f, 75, { stiffness: 380, damping: 10 }))
  // La chute (42,5 s) : l'écran de fin se tasse vers le haut, Kéké Père Noël revient en gros plan (clin d'œil) avec sa bulle.
  const shrink = easeInOut(ramp(f, 88, 102))
  const endScale = lerp(1, 0.8, shrink)
  return (
    <AbsoluteFill>
      <SceneBg f={f} />
      {/* 39,5 → 41,5 s : « Rendez-vous chaque jour ! » + calendrier dont on arrache 4 pages */}
      {f < 62 &&
        t.appel.map((line, k) => (
          <div key={k} style={{ position: 'absolute', left: 8, right: 8, top: 122 + k * 104, transform: `translateX(${appelOut * 900}px) rotate(${appelOut * 14}deg)` }}>
            <Pop f={f} at={6 + k * 5} from={70} rot={k ? 2 : -2} cfg={SPRING.pop}>
              <Outlined size={100} color={k ? N.gold : '#ffffff'} stroke={6}>{nb(line)}</Outlined>
            </Pop>
          </div>
        ))}
      {f >= 3 && f < 82 && (
        <div style={{ position: 'absolute', left: 100, top: 420, width: 520, height: 640, transform: `translateX(${calOut * 900}px) rotate(${calOut * 18}deg)`, opacity: 1 - calOut * 0.3 }}>
          <Pop f={f} at={3} from={120} rot={-2} cfg={SPRING.snappy} style={{ position: 'absolute', left: 0, top: 0 }}>
            <div style={{ position: 'relative', width: 520, height: 640 }}>
              {[PAGES[4], PAGES[3], PAGES[2], PAGES[1], PAGES[0]].map((p, ri) => {
                const i = 4 - ri
                const tf = i < 4 ? f - TEAR[i] : -99
                if (tf > 10) return null
                const u = tf < 0 ? 0 : easeIn(tf / 10)
                const curl = tf >= 0 && tf < 3 ? -3 * Math.sin((tf / 3) * Math.PI) : 0
                return (
                  <div key={i} style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${u * 820}px,${u * 200}px) rotate(${curl + u * 34}deg)`, transformOrigin: '0% 0%', zIndex: 10 - i }}>
                    <CalPage p={p} />
                  </div>
                )
              })}
              {/* anneaux de reliure */}
              <div style={{ position: 'absolute', left: 0, right: 0, top: -22, display: 'flex', justifyContent: 'space-around', padding: '0 40px', zIndex: 20 }}>
                {Array.from({ length: 5 }, (_, k) => <div key={k} style={{ width: 22, height: 54, borderRadius: 12, background: '#ffffff', border: `5px solid ${C.ink}`, boxSizing: 'border-box' }} />)}
              </div>
            </div>
          </Pop>
        </div>
      )}
      {/* 41,5 s : le logo, les dates, la signature */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 720, height: 1280, transformOrigin: '50% 0', transform: `scale(${endScale})` }}>
      <Logo f={f} at={logoAt} top={92} scale={0.8} lines={t.titre} />
      <Row top={326}>
        <Pop f={f} at={logoAt + 4} rot={-2} cfg={SPRING.pop}><Pill bg={C.surface} size={30}>{t.dates}</Pill></Pop>
      </Row>
      <Row top={640}>
        <Pop f={f} at={logoAt + 8} rot={2} from={40} cfg={SPRING.pop}><Outlined size={54} color="#ffffff" stroke={5}>{t.signature}</Outlined></Pop>
      </Row>
      {/* l'icône de l'appli ; le flocon se pose dessus et devient la pastille « 1 » */}
      <div style={{ position: 'absolute', left: 360 - 90, top: 428, width: 180, height: 180, transform: `scale(${iconIn}) rotate(${(1 - iconIn) * -20}deg)`, opacity: clamp01(iconIn * 3) }}>
        <Img src={staticFile('icons/icon-512.png')} style={{ width: 180, height: 180, borderRadius: 42, border: `6px solid ${C.ink}`, boxShadow: sticker(8), boxSizing: 'border-box', display: 'block' }} />
        {f >= 75 && (
          <div style={{ position: 'absolute', right: -24, top: -24, width: 72, height: 72, borderRadius: '50%', background: N.red, border: `6px solid ${C.ink}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 48, color: '#ffffff', lineHeight: 1, paddingTop: 4, transform: `scale(${badge})`, boxShadow: sticker(4) }}>1</div>
        )}
      </div>
      {f >= 60 && f < 75 && (
        <div style={{ position: 'absolute', left: lerp(-100, 452, easeInOut(fl)) - 60, top: lerp(780, 436, easeInOut(fl)) - 60 - Math.sin(fl * Math.PI) * 90, transform: `rotate(${fl * 360}deg) scale(${lerp(1.4, 0.5, fl)})` }}>
          <Flake size={120} outline shadow />
        </div>
      )}
      {f >= 75 && f < 90 && <ConfettiBurst f={f} at={75} x={452} y={436} n={18} seed="badge" />}
      </div>
      {/* 42,5 s : Kéké Père Noël revient en gros plan, clin d'œil, et avoue */}
      {f >= 88 && (
        <>
          <Pop f={f} at={90} rot={0} from={420} cfg={SPRING.bouncy} style={{ position: 'absolute', left: 360 - 260, top: 712 }}>
            <Santa slug="kevin" expr="clin_oeil" size={520} style={{ transform: `translateY(${bob(step3(f), 0, 10, 30)}px) rotate(${wiggle(step3(f), 0, 1.6, 50)}deg)` }} />
          </Pop>
          <Pop f={f} at={102} rot={-2} cfg={SPRING.pop} style={{ position: 'absolute', left: 0, right: 0, top: 596, display: 'flex', justifyContent: 'center' }}>
            <Bubble size={42} tail="left"><div style={{ textAlign: 'center' }}>{nb(c.bulle[0])}<br />{nb(c.bulle[1])}</div></Bubble>
          </Pop>
          {[[96, 960, 70, 118], [640, 900, 56, 124], [118, 1160, 50, 130]].map(([x, y, s, at], i) => {
            const k = clamp01(sp(f, at, SPRING.pop))
            const tw = 0.85 + 0.2 * Math.sin((f + i * 6) / 3.2)
            return <Sparkle key={i} size={s * k * tw} style={{ position: 'absolute', left: x - (s * k * tw) / 2, top: y - (s * k * tw) / 2 }} />
          })}
        </>
      )}
      <Sfx name="whoosh" at={2} volume={0.35} />
      <Sfx name="pop" at={6} volume={0.4} />
      <Sfx name="pop" at={11} volume={0.4} />
      {TEAR.map((a) => <Sfx key={a} name="rip" at={a} volume={0.65} />)}
      <Sfx name="stamp" at={logoAt} volume={0.75} />
      <Sfx name="pop" at={logoAt + 4} volume={0.45} />
      <Sfx name="pop" at={logoAt + 8} volume={0.45} />
      <Sfx name="whoosh" at={64} volume={0.4} />
      <Sfx name="pop" at={73} volume={0.5} />
      <Sfx name="swoosh-up" at={62} volume={0.4} />
      <Sfx name="success" at={75} volume={0.55} />
      <Sfx name="swoosh-up" at={90} volume={0.4} />
      <Sfx name="pop" at={96} volume={0.45} />
      <Sfx name="pop" at={102} volume={0.5} />
      <Sfx name="sleigh" at={112} volume={0.28} />
      <Sfx name="success" at={118} volume={0.5} />
    </AbsoluteFill>
  )
}

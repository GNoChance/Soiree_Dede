// Temps 6 et 7 de la vidéo de Noël : les missions (16,0 s) et la Hotte du jour (21,0 s).
import React from 'react'
import { AbsoluteFill } from 'remotion'
import { C, DISPLAY, sticker } from '../theme'
import { Bubble, ConfettiBurst, Outlined, Panel, Pill, Pop, SPRING, bob, clamp01, easeIn, easeInOut, lerp, nb, ramp, sp, wiggle } from '../tuto/kit'
import { BEAT, N, shake, step3 } from './fx'
import { NOEL } from './script'
import { Sfx } from './sfx'
import { Big, Header, Row, Sack, Santa, SceneBg, stampK, type Perso, type Scene } from './scenes'

// ---------------------------------------------------------------------------
// 6. Les missions (16,0 → 21,0 s, fond rouge) : « 3 » énorme, 3 cartes tamponnées « +30 ❄️ » sur 3 temps.
// ---------------------------------------------------------------------------
const Tick: React.FC<{ s: number }> = ({ s }) => (
  <svg width={46} height={46} viewBox="0 0 46 46" style={{ transform: `scale(${s})` }}>
    <path d="M8,24 L19,35 L39,11" stroke={C.ink} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
)

/** Sceau « +30 ❄️ » tamponné. */
const Seal: React.FC<{ f: number; at: number }> = ({ f, at }) => {
  const k = stampK(f, at)
  if (!k) return null
  return (
    <div style={{ position: 'absolute', right: 14, top: 8, width: 134, height: 134, opacity: k.op, transform: `scale(${k.s}) rotate(-14deg)` }}>
      {k.ring > 0 && k.ring < 1 && <div style={{ position: 'absolute', left: -10 - k.ring * 40, top: -10 - k.ring * 40, right: -10 - k.ring * 40, bottom: -10 - k.ring * 40, borderRadius: '50%', border: `6px solid ${C.ink}`, opacity: 1 - k.ring }} />}
      <div style={{ position: 'relative', width: 134, height: 134, borderRadius: '50%', background: N.gold, border: `6px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(5), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontWeight: 800, color: C.ink }}>
        <div style={{ position: 'absolute', left: 9, top: 9, right: 9, bottom: 9, borderRadius: '50%', border: `4px dashed ${C.ink}`, opacity: 0.55 }} />
        <div style={{ fontSize: 50, lineHeight: 0.9, paddingTop: 6 }}>+30</div>
        <div style={{ fontSize: 34, lineHeight: 1 }}>❄️</div>
      </div>
    </div>
  )
}

const Three: React.FC<{ cx: number; cy: number; s: number }> = ({ cx, cy, s }) => (
  <div style={{ position: 'absolute', left: cx - 200, top: cy - 336, width: 400, height: 672, transform: `scale(${s})`, transformOrigin: '50% 50%' }}>
    <Outlined size={640} color={N.gold} stroke={14} style={{ lineHeight: '672px', textShadow: `18px 18px 0 ${C.ink}` }}>{NOEL.missions.nombre}</Outlined>
  </div>
)

export const Missions: Scene = ({ f }) => {
  const t = NOEL.missions
  const STAMP = [45, 60, 75]
  // « 3 » : slam au centre (f10), puis il devient le « 3 » de « 3 missions par jour ».
  const slamT = f - 10
  const slamS = slamT < 5 ? lerp(2.8, 1, easeIn(clamp01(slamT / 5))) : 1 + 0.09 * Math.sin(clamp01((slamT - 5) / 14) * Math.PI)
  const mv = easeInOut(ramp(f, 30, 44))
  const size = lerp(640, 250, mv)
  const cx = lerp(360, 108, mv)
  const cy = lerp(560, 232, mv)
  const sh = shake(f, 15, 12, 18, 'm3')
  const happy = f >= STAMP[2] + 6
  const bonusPulse = f > 120 ? Math.max(0, 1 - ((f - 120) % BEAT) / 6) * 0.04 : 0
  const wave = ramp(f, 15, 28)
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px,${sh.y}px) scale(1.03)` }}>
        <SceneBg f={f} />
        {f >= 15 && f < 28 && (
          <div style={{ position: 'absolute', left: 360 - 80 - wave * 600, top: 560 - 80 - wave * 600, width: 160 + wave * 1200, height: 160 + wave * 1200, borderRadius: '50%', border: `${Math.round(22 * (1 - wave)) + 4}px solid #ffffff`, opacity: 0.7 * (1 - wave), boxSizing: 'border-box' }} />
        )}
        {f >= 10 && <Three cx={cx} cy={cy} s={(size / 640) * (f < 40 ? slamS : 1)} />}
        {t.accroche.map((line, k) => (
          <div key={k} style={{ position: 'absolute', left: 218, top: 132 + k * 92 }}>
            <Pop f={f} at={34 + k * 4} from={30} rot={k ? 2 : -2} cfg={SPRING.pop}>
              <Outlined size={84} color={k ? N.gold : '#ffffff'} stroke={6} style={{ textAlign: 'left' }}>{nb(line)}</Outlined>
            </Pop>
          </div>
        ))}
        {t.liste.map((m, k) => {
          const done = f >= STAMP[k]
          const jolt = shake(f, STAMP[k] + 5, 8, 8, `card${k}`)
          const s = sp(f, STAMP[k], SPRING.pop)
          return (
            <Pop key={k} f={f} at={36 + k * 4} rot={k % 2 ? 1 : -1} cfg={SPRING.snappy} from={80} style={{ position: 'absolute', left: 36, top: 392 + k * 172, transform: `translate(${jolt.x}px,${jolt.y}px)` }}>
              <Panel bg={done ? '#d9fff1' : C.surface} radius={34} style={{ position: 'relative', width: 648, height: 150, display: 'flex', alignItems: 'center', gap: 18, padding: '0 22px' }}>
                <div style={{ width: 68, height: 68, flexShrink: 0, borderRadius: 18, border: `5px solid ${C.ink}`, background: done ? C.mint : C.surface, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {done && <Tick s={s} />}
                </div>
                <div style={{ fontSize: 54, lineHeight: 1 }}>{m.emoji}</div>
                <div style={{ fontSize: 38, lineHeight: 1.05, paddingTop: 6, maxWidth: 270 }}>{nb(m.texte)}</div>
                <Seal f={f} at={STAMP[k]} />
              </Panel>
            </Pop>
          )
        })}
        <div style={{ position: 'absolute', left: -6, top: 900 + (1 - clamp01(sp(f, 80, SPRING.snappy))) * 500 + bob(step3(f), 0, happy ? 22 : 8, happy ? 15 : 30), transform: `rotate(${wiggle(step3(f), 0, 2.5)}deg)` }}>
          {f >= 78 && <Santa slug="kevin" expr={f >= 90 ? 'joie' : 'clin_oeil'} size={290} />}
        </div>
        <Pop f={f} at={90} rot={3} cfg={SPRING.pop} style={{ position: 'absolute', left: 262, top: 898 }}>
          <Bubble size={42} tail="left"><div style={{ textAlign: 'center' }}>{t.bulle[0]}<br />{nb(t.bulle[1])}</div></Bubble>
        </Pop>
        <Pop f={f} at={105} rot={-2} cfg={SPRING.pop} style={{ position: 'absolute', right: 22, top: 1040, transform: `scale(${1 + bonusPulse})` }}>
          <Pill bg={N.gold} size={36}>{nb(t.bonus)}</Pill>
        </Pop>
      </AbsoluteFill>
      <ConfettiBurst f={f} at={105} x={500} y={1090} n={26} seed="msn" />
      <Sfx name="stamp" at={10} volume={0.85} />
      <Sfx name="boom" at={10} volume={0.45} />
      <Sfx name="pop" at={34} volume={0.5} />
      {[36, 40, 44].map((a) => <Sfx key={a} name="swoosh-up" at={a} volume={0.3} />)}
      {STAMP.map((a) => <Sfx key={a} name="stamp" at={a} volume={0.8} />)}
      <Sfx name="success" at={STAMP[2] + 6} volume={0.5} />
      <Sfx name="pop" at={80} volume={0.4} />
      <Sfx name="pop" at={90} volume={0.55} />
      <Sfx name="pop" at={105} volume={0.55} />
      <Sfx name="success" at={106} volume={0.45} />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------
// 7. La Hotte du jour (21,0 → 26,5 s, fond vert) : la hotte tombe, crache 5 cartes, un seul essai, le classement.
// ---------------------------------------------------------------------------
const GRID: [number, number][] = [[36, 296], [255, 296], [474, 296], [146, 468], [365, 468]]
const PODIUM: Perso[] = ['mika', 'cycy', 'nini']

/** Chute de la hotte : tombe, rebondit deux fois (hauteur en px). */
const sackFall = (f: number) => {
  if (f < 9) return lerp(-1400, 0, (Math.max(0, f) / 9) ** 2)
  const b1 = f - 9
  if (b1 < 9) return -(130 * 4 * (b1 / 9) * (1 - b1 / 9))
  const b2 = f - 18
  if (b2 < 6) return -(42 * 4 * (b2 / 6) * (1 - b2 / 6))
  return 0
}

/** Podium (2-1-3) : les 3 chibis se doublent, saut en arc à chaque dépassement. */
const Podium: React.FC<{ f: number }> = ({ f }) => {
  const SLOT = [
    { x: 360, top: 1004, h: 190, c: '#ffd447', n: '1' },
    { x: 168, top: 1050, h: 144, c: '#d6dde6', n: '2' },
    { x: 552, top: 1086, h: 108, c: '#f3a15a', n: '3' },
  ]
  // chibi classé 1er / 2e / 3e à chaque phase
  const ORD = [[1, 0, 2], [2, 1, 0], [0, 2, 1]]
  const phase = f < 12 ? 0 : f < 24 ? 1 : 2
  const jump = phase === 0 ? 0 : ramp(f, phase === 1 ? 12 : 24, phase === 1 ? 24 : 36)
  const rise = clamp01(sp(f, 0, SPRING.snappy))
  return (
    <>
      {SLOT.map((s, i) => (
        <div key={i} style={{ position: 'absolute', left: s.x - 88, top: s.top + (1 - rise) * 320, width: 176, height: s.h + 40, background: s.c, border: `5px solid ${C.ink}`, borderRadius: '16px 16px 0 0', boxSizing: 'border-box', boxShadow: sticker(5), fontFamily: DISPLAY, fontWeight: 800, fontSize: 64, textAlign: 'center', paddingTop: 6, color: C.ink }}>{s.n}</div>
      ))}
      {PODIUM.map((slug, ci) => {
        const rankNow = ORD[phase].indexOf(ci)
        const rankPrev = ORD[Math.max(0, phase - 1)].indexOf(ci)
        const a = SLOT[phase === 0 ? rankNow : rankPrev]
        const b = SLOT[rankNow]
        const m = phase === 0 ? 1 : easeInOut(jump)
        const x = lerp(a.x, b.x, m)
        const arc = phase === 0 ? 0 : Math.sin(jump * Math.PI) * -(rankNow < rankPrev ? 150 : 40)
        const y = lerp(a.top, b.top, m) - 140 + arc + (1 - rise) * 320
        return (
          <div key={slug} style={{ position: 'absolute', left: x - 90, top: y, zIndex: rankNow === 0 ? 3 : 2 }}>
            <Santa slug={slug} expr={rankNow === 0 ? 'cool' : 'joie'} size={180} />
          </div>
        )
      })}
    </>
  )
}

export const Hotte: Scene = ({ f }) => {
  const t = NOEL.hotte
  // 24,0 s : tout se fige 1 temps (la neige, la hotte) ; la musique est coupée pendant ce temps.
  const tf = f < 90 ? f : f < 105 ? 90 : f - 15
  const fy = sackFall(f)
  const land = f >= 9 && f < 14 ? 1 - Math.abs(f - 11) / 3 : f >= 18 && f < 21 ? 1 - Math.abs(f - 19.5) / 2 : 0
  const puff = Math.max(0, ...t.manches.map((_, k) => 1 - Math.abs(f - (15 + k * 15) - 2) / 4))
  const out = easeIn(ramp(f, 126, 142))
  const SY = 905
  const finger = f >= 90 && f < 122 ? sp(f, 90, { stiffness: 260, damping: 13 }) * (1 - easeIn(ramp(f, 112, 121))) : 0
  const fq = f >= 105 && f < 113 ? Math.sin(((f - 105) / 8) * Math.PI) * -40 : 0
  return (
    <AbsoluteFill>
      <SceneBg f={tf} />
      <Header f={f} at={6}>{t.titre}</Header>
      <Big f={f} at={12} top={214} size={64}>{nb(t.accroche)}</Big>
      {/* la hotte */}
      <div style={{ position: 'absolute', left: 360 - 165 + out * 520, top: SY + fy, transform: `scale(${1 + 0.1 * land + 0.06 * puff}, ${1 - 0.1 * land - 0.05 * puff})`, transformOrigin: '50% 100%', opacity: 1 - out * 0.4 }}>
        <Sack w={330} />
      </div>
      {f >= 9 && f < 24 && <ConfettiBurst f={f} at={9} x={360} y={1180} n={10} seed="hdrop" />}
      {t.manches.map((m, k) => {
        const at = 15 + k * 15
        if (f < at) return null
        const s = sp(f, at, { stiffness: 150, damping: 15 })
        const x = lerp(360 - 100, GRID[k][0], s)
        const y = lerp(SY - 60, GRID[k][1], s)
        return (
          <div key={k} style={{ position: 'absolute', left: x, top: y, transform: `scale(${Math.max(0.1, s)}) rotate(${(k % 2 ? 2.5 : -2.5) * s + (1 - s) * 50}deg)`, opacity: clamp01(s * 4) }}>
            <Panel radius={30} shadow={6} style={{ width: 210, height: 156, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <div style={{ fontSize: 66, lineHeight: 1.1 }}>{m.emoji}</div>
              <div style={{ fontSize: 28, lineHeight: 1, textAlign: 'center', padding: '4px 8px 0' }}>{nb(m.nom)}</div>
            </Panel>
          </div>
        )
      })}
      {/* 24,0 s : tout se fige, le doigt géant */}
      {f >= 90 && f < 122 && (
        <>
          <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 56%, rgba(8,24,18,0.1) 0%, rgba(8,24,18,0.72) 100%)', opacity: clamp01((f - 90) / 3) * (1 - ramp(f, 112, 121)) }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: 392 + fq, textAlign: 'center', fontSize: 400, lineHeight: 1, transform: `scale(${finger}) rotate(${-6 + (1 - finger) * 20}deg)`, transformOrigin: '50% 80%', filter: 'drop-shadow(10px 10px 0 rgba(31,27,46,1))' }}>☝️</div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 790, transform: `scale(${clamp01(sp(f, 96, SPRING.pop))})` }}>
            <Outlined size={104} color="#ffffff" stroke={7}>Un seul essai</Outlined>
            <Outlined size={104} color={N.gold} stroke={7}>par jour</Outlined>
          </div>
        </>
      )}
      <Row top={662}>
        <Pop f={f} at={120} rot={-2} cfg={SPRING.pop}><Pill bg={N.gold} size={38}>{nb(t.bonne)}</Pill></Pop>
      </Row>
      <Row top={758}>
        <Pop f={f} at={135} rot={2} cfg={SPRING.pop}><Pill bg={C.surface} size={34}>{nb(t.classement)}</Pill></Pop>
      </Row>
      {f >= 134 && <Podium f={f - 134} />}
      <ConfettiBurst f={f} at={120} x={360} y={700} n={22} seed="hbonne" />
      <Sfx name="boom" at={4} volume={0.75} />
      <Sfx name="stamp" at={9} volume={0.5} />
      <Sfx name="pop" at={6} volume={0.4} />
      {t.manches.map((_, k) => <Sfx key={k} name="pop" at={15 + k * 15} volume={0.55} />)}
      {t.manches.map((_, k) => <Sfx key={k} name="swoosh-up" at={14 + k * 15} volume={0.3} />)}
      <Sfx name="stamp" at={90} volume={0.7} />
      <Sfx name="pop" at={96} volume={0.5} />
      <Sfx name="whoosh" at={118} volume={0.3} />
      <Sfx name="success" at={120} volume={0.55} />
      <Sfx name="pop" at={135} volume={0.5} />
      <Sfx name="whoosh" at={142} volume={0.35} />
      <Sfx name="pop" at={146} volume={0.4} />
      <Sfx name="pop" at={156} volume={0.4} />
    </AbsoluteFill>
  )
}

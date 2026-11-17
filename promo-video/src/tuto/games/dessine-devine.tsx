// Tuto « Dessine & devine » : Cycy dessine un chat, les autres devinent.
import React from 'react'
import { C, sticker, type Slug } from '../../theme'
import { Avatar, Bubble, Chibi, Finger, Panel, Pill, Pop, SPRING, Sfx, TW, bob, clamp01, ramp, sp, wiggle } from '../kit'
import type { MockScene, TutoSpec } from '../types'

// Le chat, trait par trait (viewBox 300×300) : [tracé, part du temps de dessin].
const CAT: [string, number][] = [
  ['M70 172 C70 100 230 100 230 172 C230 244 70 244 70 172', 0.3],
  ['M86 132 L80 66 L132 106', 0.12],
  ['M214 132 L220 66 L168 106', 0.12],
  ['M116 158 L116 176 M184 158 L184 176', 0.1],
  ['M140 190 L160 190 L150 201 Z', 0.08],
  ['M150 201 Q140 218 127 209 M150 201 Q160 218 173 209', 0.1],
  ['M102 194 L46 182 M102 206 L46 220 M198 194 L254 182 M198 206 L254 220', 0.18],
]
const Cat: React.FC<{ p: number; size: number }> = ({ p, size }) => {
  let start = 0
  return (
    <svg width={size} height={size} viewBox="0 0 300 300" style={{ display: 'block' }}>
      {CAT.map(([d, share], k) => {
        const local = clamp01((p - start) / share)
        start += share
        return local > 0 ? (
          <path key={k} d={d} pathLength={1} fill="none" stroke={k === 4 ? C.tomato : C.ink} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={1} strokeDashoffset={1 - local} />
        ) : null
      })}
    </svg>
  )
}

const TimerBar: React.FC<{ p: number; width: number }> = ({ p, width }) => (
  <div style={{ width, height: 34, borderRadius: 17, background: C.surface, border: `5px solid ${C.ink}`, boxSizing: 'border-box', overflow: 'hidden', boxShadow: sticker(4) }}>
    <div style={{ width: `${(1 - p) * 100}%`, height: '100%', background: p > 0.7 ? C.tomato : C.mint }} />
  </div>
)

// 1 — Le dessinateur choisit son mot
const CHOICES = ['Fusée', 'Chat', 'Pizza']
const PICK = 1
const PICK_AT = 64
const Choosing: MockScene = ({ f }) => (
  <>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={0}>
        <Panel radius={32} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 30px 12px 14px', fontSize: 44 }}>
          <Avatar slug="cycy" expression="reflexion" size={110} badge="✏️" />
          <div>Cycy dessine</div>
        </Panel>
      </Pop>
    </div>
    {CHOICES.map((word, k) => {
      const picked = k === PICK && f >= PICK_AT
      const dim = k !== PICK && f >= PICK_AT
      const s = picked ? 1 + 0.1 * sp(f, PICK_AT) : 1
      return (
        <Pop key={word} f={f} at={12 + k * 6} rot={k % 2 ? 1.5 : -1.5} style={{ position: 'absolute', left: 110, top: 190 + k * 170 }}>
          <Panel bg={picked ? C.mint : C.surface} radius={34} shadow={picked ? 10 : 6}
            style={{ width: 500, height: 136, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 76, lineHeight: 1, paddingTop: 8, transform: `scale(${s})`, opacity: dim ? 0.45 : 1 }}>
            {word}
          </Panel>
        </Pop>
      )
    })}
    <div style={{ position: 'absolute', left: 0, right: 0, top: 730, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={PICK_AT + 14} rot={-2}><Pill bg={C.grape} color="#ffffff" size={38}>🤫 Les autres ne voient pas le mot</Pill></Pop>
    </div>
    <Finger f={f} taps={[{ at: PICK_AT - 8, x: 470, y: 190 + PICK * 170 + 80 }]} />
    <Sfx name="tap" at={PICK_AT} volume={0.8} />
    <Sfx name="pop" at={PICK_AT + 2} volume={0.6} />
  </>
)

// 2 — Il dessine, le chrono tourne
const SWATCHES = [C.ink, C.tomato, C.sun, C.mint, C.sky, C.grape]
const Drawing: MockScene = ({ f, dur }) => {
  const p = ramp(f, 12, dur - 24)
  return (
    <>
      <div style={{ position: 'absolute', left: 90, top: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ fontSize: 44, lineHeight: 1 }}>⏱️</div>
        <TimerBar p={ramp(f, 0, dur) * 0.55} width={470} />
      </div>
      <Pop f={f} at={0} cfg={SPRING.snappy} style={{ position: 'absolute', left: 90, top: 70 }}>
        <Panel radius={40} shadow={10} style={{ width: 540, height: 540, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Cat p={p} size={500} />
        </Panel>
      </Pop>
      <div style={{ position: 'absolute', left: 250, top: 640, display: 'flex', gap: 12 }}>
        {SWATCHES.map((c, k) => (
          <Pop key={c} f={f} at={6 + k * 2}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: c, border: `5px solid ${k === 0 ? C.sun : C.ink}`, boxSizing: 'border-box', boxShadow: sticker(3) }} />
          </Pop>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 10, top: 600 + (1 - sp(f, 6)) * 300 + bob(f, 0, 10, 24), transform: `rotate(${wiggle(f, 0, 3)}deg)` }}>
        <Chibi slug="cycy" expression="gamer" size={240} />
      </div>
      <Pop f={f} at={dur - 40} rot={-3} style={{ position: 'absolute', left: 250, top: 730 }}>
        <Bubble size={40} bg={C.sun}>Facile, non ?</Bubble>
      </Pop>
      <Sfx name="pop" at={dur - 34} />
    </>
  )
}

// 3 — Les autres tapent leurs propositions
const FEED: { slug: Slug; text: string; ok?: boolean; at: number }[] = [
  { slug: 'kevin', text: 'un chien ?', at: 14 },
  { slug: 'dede', text: 'lapin !', at: 42 },
  { slug: 'marius', text: '✅ Marius a trouvé !', ok: true, at: 76 },
  { slug: 'dede', text: '✅ Dédé a trouvé !', ok: true, at: 108 },
]
const Guessing: MockScene = ({ f }) => {
  const hint = f < 58 ? '____' : 'C___'
  return (
    <>
      <Panel radius={32} shadow={7} style={{ position: 'absolute', left: 36, top: 0, width: 300, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Cat p={1} size={280} />
      </Panel>
      <div style={{ position: 'absolute', left: 366, top: 14, width: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <Pill bg={C.sun} size={34}>Le mot :</Pill>
        <div style={{ display: 'flex', gap: 10 }}>
          {hint.split('').map((ch, k) => (
            <Panel key={k} radius={16} shadow={4} bg={ch === '_' ? C.surface : C.mint}
              style={{ width: 66, height: 84, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60, lineHeight: 1, paddingTop: 6, transform: `scale(${ch !== '_' ? 0.7 + 0.3 * sp(f, 58) : 1})` }}>
              {ch === '_' ? '' : ch}
            </Panel>
          ))}
        </div>
        <Pop f={f} at={60} rot={2}><Pill bg={C.surface} size={28}>💡 Des lettres en indice</Pill></Pop>
      </div>
      {FEED.map((m, k) => (
        <Pop key={k} f={f} at={m.at} from={40} style={{ position: 'absolute', left: 36, top: 336 + k * 132 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Avatar slug={m.slug} expression={m.ok ? 'joie' : 'reflexion'} size={104} />
            <Bubble tail="none" size={44} bg={m.ok ? C.mint : C.surface}>{m.text}</Bubble>
          </div>
        </Pop>
      ))}
      <Sfx name="pop" at={64} volume={0.4} />
      {FEED.map((m, k) => <Sfx key={k} name={m.ok ? 'success' : 'type'} at={m.at + 8} volume={m.ok ? 0.5 : 0.9} />)}
    </>
  )
}

// 4 — Les points
const SCORES: { slug: Slug; name: string; pts: number; note: string; at: number }[] = [
  { slug: 'marius', name: 'Marius', pts: 190, note: '⚡ le plus rapide', at: 10 },
  { slug: 'dede', name: 'Dédé', pts: 150, note: 'trouvé un peu après', at: 34 },
  { slug: 'kevin', name: 'Keke', pts: 0, note: 'pas trouvé…', at: 58 },
  { slug: 'cycy', name: 'Cycy', pts: 80, note: '✏️ +40 par joueur qui trouve', at: 82 },
]
const Scoring: MockScene = ({ f }) => (
  <>
    {SCORES.map((s, k) => {
      const n = Math.round(s.pts * ramp(f, s.at + 6, s.at + 24))
      return (
        <Pop key={s.slug} f={f} at={s.at} from={50} rot={k % 2 ? 1 : -1} style={{ position: 'absolute', left: 36, top: 6 + k * 200 }}>
          <Panel bg={k === 3 ? '#d6fbef' : C.surface} radius={36} style={{ width: TW - 72, height: 172, display: 'flex', alignItems: 'center', gap: 18, padding: '0 26px 0 18px' }}>
            <Avatar slug={s.slug} expression={s.pts ? 'joie' : 'pleurs'} size={124} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 50, lineHeight: 1.05 }}>{s.name}</div>
              <div style={{ fontSize: 28, lineHeight: 1.2, color: C.muted }}>{s.note}</div>
            </div>
            <div style={{ fontSize: 76, lineHeight: 1, color: s.pts ? C.tangerine : C.muted, transform: `scale(${1 + 0.2 * Math.sin(ramp(f, s.at + 22, s.at + 32) * Math.PI)})` }}>+{n}</div>
          </Panel>
        </Pop>
      )
    })}
    {SCORES.map((s, k) => <Sfx key={k} name={s.pts ? 'pop' : 'tap'} at={s.at + 8} volume={0.6} />)}
  </>
)

export const dessineDevine: TutoSpec = {
  id: 'dessine-devine',
  name: 'Dessine & devine',
  emoji: '✏️',
  color: '#06D6A0',
  players: '3 à 9 joueurs',
  goal: 'Fais deviner ton dessin… et devine ceux des autres !',
  cast: ['cycy', 'kevin', 'dede', 'marius'],
  steps: [
    { text: 'Le dessinateur choisit 1 mot secret parmi 3', seconds: 5, Mock: Choosing },
    { text: 'Il le dessine au doigt sur son téléphone', seconds: 5.6, Mock: Drawing },
    { text: 'Les autres tapent leurs propositions, vite !', seconds: 6, Mock: Guessing },
    { text: 'Plus tu trouves vite, plus tu marques', seconds: 5.4, Mock: Scoring },
  ],
  win: {
    text: 'Chacun dessine à son tour. Le plus gros score gagne !',
    winners: ['marius', 'cycy'],
  },
}

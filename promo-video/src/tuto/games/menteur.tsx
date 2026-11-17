// Tuto « Menteur » : dés de bluff. 4 joueurs × 5 dés, les 1 sont jokers ; enchère « 5 dés de 5 » fausse (4 seulement).
import React from 'react'
import { C, sticker, type Slug } from '../../theme'
import { Avatar, Bubble, Chibi, Finger, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, bob, clamp01, ramp, sp, wiggle } from '../kit'
import { Btn } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
}
export const Die: React.FC<{ v: number; size?: number; bg?: string; dim?: boolean }> = ({ v, size = 90, bg = C.surface, dim }) => (
  <svg width={size} height={size} viewBox="-6 -6 118 118" style={{ display: 'block', opacity: dim ? 0.4 : 1 }}>
    <rect x={6} y={6} width={100} height={100} rx={22} fill={C.ink} />
    <rect x={0} y={0} width={100} height={100} rx={22} fill={bg} stroke={C.ink} strokeWidth={7} />
    {PIPS[v].map(([x, y], k) => <circle key={k} cx={x} cy={y} r={v === 1 ? 14 : 9.5} fill={v === 1 ? C.tomato : C.ink} />)}
  </svg>
)
const Cup: React.FC<{ size?: number; color?: string }> = ({ size = 150, color = C.grape }) => (
  <svg width={size} height={size * 1.1} viewBox="0 0 160 176" style={{ display: 'block' }}>
    <path d="M38 14 H130 L152 168 H16 Z" fill={C.ink} transform="translate(6 6)" />
    <path d="M34 10 H126 L148 164 H12 Z" fill={color} stroke={C.ink} strokeWidth={8} strokeLinejoin="round" />
    <path d="M30 40 H130" stroke={C.ink} strokeWidth={6} opacity={0.5} />
  </svg>
)

const TABLE: { slug: Slug; name: string; dice: number[] }[] = [
  { slug: 'dede', name: 'Dédé', dice: [5, 2, 1, 4, 6] },
  { slug: 'kevin', name: 'Keke', dice: [5, 3, 3, 2, 6] },
  { slug: 'cycy', name: 'Cycy', dice: [4, 4, 2, 6, 3] },
  { slug: 'mika', name: 'Mika', dice: [1, 2, 6, 3, 4] },
]

// 1 — Les dés cachés
const Hidden: MockScene = ({ f }) => (
  <>
    {TABLE.slice(1).map((p, k) => (
      <Pop key={p.slug} f={f} at={k * 5} style={{ position: 'absolute', left: 50 + k * 215, top: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <Avatar slug={p.slug} expression="clin_oeil" size={110} />
          <div style={{ transform: `rotate(${f < 60 ? Math.sin((f + k * 5) / 2) * 9 : 0}deg) translateY(${f < 60 ? Math.abs(Math.sin((f + k * 5) / 2.5)) * -14 : 0}px)` }}><Cup /></div>
        </div>
      </Pop>
    ))}
    <Pop f={f} at={52} rot={-3} style={{ position: 'absolute', left: 0, right: 0, top: 320, display: 'flex', justifyContent: 'center' }}>
      <Pill bg={C.surface} size={34}>🙈 Leurs dés restent cachés</Pill>
    </Pop>
    <Pop f={f} at={66} from={80} style={{ position: 'absolute', left: 40, top: 430 }}>
      <Panel bg="#e6dcff" radius={40} shadow={9} style={{ width: TW - 80, height: 250, padding: '22px 20px 0' }}>
        <div style={{ fontSize: 38, lineHeight: 1, textAlign: 'center', marginBottom: 20 }}>👀 Tes 5 dés (toi seul les vois)</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          {TABLE[0].dice.map((v, k) => <div key={k} style={{ transform: `scale(${sp(f, 74 + k * 4)}) rotate(${(k - 2) * 4}deg)` }}><Die v={v} size={112} /></div>)}
        </div>
      </Panel>
    </Pop>
    <div style={{ position: 'absolute', left: 250, top: 690 + (1 - sp(f, 80)) * 300 + bob(f, 0, 8, 26) }}>
      <Chibi slug="dede" expression="reflexion" size={190} />
    </div>
    {Array.from({ length: 8 }, (_, k) => <Sfx key={k} name="type" at={4 + k * 7} volume={0.8} />)}
    <Sfx name="pop" at={74} volume={0.6} />
  </>
)

// 2 — Les enchères montent
const BIDS: { k: number; q: number; at: number }[] = [{ k: 0, q: 3, at: 16 }, { k: 1, q: 4, at: 58 }, { k: 2, q: 5, at: 100 }]
const Bidding: MockScene = ({ f }) => (
  <>
    {BIDS.map((b, i) => {
      const p = TABLE[b.k]
      const left = i % 2 === 0
      const talking = f >= b.at && f < b.at + 40
      return (
        <React.Fragment key={i}>
          <div style={{ position: 'absolute', [left ? 'left' : 'right']: 30, top: i * 190 + bob(f, i * 9, talking ? 16 : 5, talking ? 12 : 30), opacity: sp(f, i * 3) }}>
            <Chibi slug={p.slug} expression={talking ? 'cool' : 'clin_oeil'} size={180} />
          </div>
          <Pop f={f} at={b.at} rot={left ? -2 : 2} style={{ position: 'absolute', [left ? 'left' : 'right']: 210, top: i * 190 + 30 }}>
            <Bubble tail={left ? 'left' : 'right'} size={50} bg={i === 2 ? C.sun : C.surface}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>« {b.q} dés de <Die v={5} size={64} /> »</span>
            </Bubble>
          </Pop>
          <Sfx name="pop" at={b.at + 8} volume={0.55} />
        </React.Fragment>
      )
    })}
    <Pop f={f} at={36} rot={-2} style={{ position: 'absolute', left: 40, top: 590 }}>
      <Pill bg={C.surface} size={36}>📈 Toujours plus haut !</Pill>
    </Pop>
    <Pop f={f} at={78} rot={2} style={{ position: 'absolute', left: 40, top: 680 }}>
      <Pill bg={C.surface} size={32}>🎲 Tous les dés de la table comptent</Pill>
    </Pop>
    <Pop f={f} at={118} rot={-2} style={{ position: 'absolute', left: 40, top: 770 }}>
      <Pill bg="#ffd0da" size={38}><Die v={1} size={50} /> Les 1 sont des jokers</Pill>
    </Pop>
  </>
)

// 3 — « Menteur ! »
const CALL = 50
const Calling: MockScene = ({ f }) => {
  const lift = ramp(f, CALL + 22, CALL + 40)
  return (
    <>
      <div style={{ position: 'absolute', left: 40, top: 0 + bob(f, 0, f >= CALL ? 22 : 8, f >= CALL ? 12 : 28), transform: `rotate(${wiggle(f, 0, 3)}deg)` }}>
        <Chibi slug="mika" expression={f >= CALL ? 'colere' : 'reflexion'} size={230} />
      </div>
      <Pop f={f} at={4} rot={3} style={{ position: 'absolute', left: 290, top: 20 }}>
        <Bubble size={36} bg={C.sun}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>Cycy : « 5 dés de <Die v={5} size={48} /> »</span></Bubble>
      </Pop>
      <Pop f={f} at={12} rot={-2} style={{ position: 'absolute', left: 290, top: 130 }}>
        <Pill bg={C.surface} size={34}>🤔 Cinq ? Impossible…</Pill>
      </Pop>
      <Pop f={f} at={14} cfg={SPRING.bouncy} style={{ position: 'absolute', left: 80, top: 260 }}>
        <Btn bg={C.tomato} color="#ffffff" size={84} w={TW - 160} h={170} pressed={f >= CALL && f < CALL + 8} style={{ borderRadius: 48, transform: f < CALL ? `scale(${1 + 0.04 * Math.sin(f / 4)})` : undefined }}>🫵 Menteur !</Btn>
      </Pop>
      {TABLE.map((p, k) => (
        <div key={p.slug} style={{ position: 'absolute', left: 26 + k * 170, top: 520, width: 160, opacity: sp(f, 20 + k * 3) }}>
          <div style={{ position: 'absolute', left: 14, top: 150, display: 'flex', flexWrap: 'wrap', gap: 4, width: 140, justifyContent: 'center', opacity: lift }}>
            {p.dice.map((v, i) => <Die key={i} v={v} size={42} bg={v === 5 || v === 1 ? C.sun : C.surface} />)}
          </div>
          <div style={{ position: 'absolute', left: 5, top: 110 - lift * 120, transform: `rotate(${lift * (k % 2 ? 14 : -14)}deg)`, opacity: 1 - lift * 0.75 }}><Cup /></div>
          <div style={{ position: 'absolute', left: 35, top: 0 }}><Avatar slug={p.slug} expression={f >= CALL ? 'surprise' : 'joie'} size={90} /></div>
        </div>
      ))}
      <Finger f={f} taps={[{ at: CALL - 8, x: 500, y: 360 }]} />
      <Sfx name="tap" at={CALL} volume={0.9} />
      <Sfx name="pop" at={CALL + 4} volume={0.8} />
      <Sfx name="whoosh" at={CALL + 22} volume={0.5} />
    </>
  )
}

// 4 — On compte, le perdant perd un dé
const COUNT0 = 30
const VERDICT = 108
const Counting: MockScene = ({ f }) => {
  let seen = 0
  const hits: number[] = []
  TABLE.forEach((p) => p.dice.forEach((v) => { if (v === 5 || v === 1) hits.push(COUNT0 + hits.length * 14) }))
  const count = hits.filter((at) => f >= at).length
  const lost = f >= VERDICT + 16
  return (
    <>
      {TABLE.map((p, k) => (
        <Pop key={p.slug} f={f} at={k * 4} from={40} style={{ position: 'absolute', left: 30, top: k * 128 }}>
          <Panel bg={k === 2 && f >= VERDICT ? '#ffd0da' : C.surface} radius={28} shadow={5} style={{ width: TW - 60, height: 110, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px' }}>
            <Avatar slug={p.slug} expression={k === 2 && f >= VERDICT ? 'pleurs' : 'joie'} size={84} />
            {p.dice.map((v, i) => {
              const match = v === 5 || v === 1
              const at = match ? hits[seen++] : 0
              const on = match && f >= at
              const gone = k === 2 && i === 4 && lost
              return (
                <div key={i} style={{ transform: `scale(${gone ? 1 - sp(f, VERDICT + 16) : on ? 1 + 0.25 * clamp01(1 - (f - at) / 8) : 1}) translateY(${gone ? -40 : 0}px)` }}>
                  <Die v={v} size={92} bg={on ? C.sun : C.surface} dim={!match && f >= COUNT0} />
                </div>
              )
            })}
          </Panel>
        </Pop>
      ))}
      <Pop f={f} at={COUNT0 - 6} rot={-3} style={{ position: 'absolute', left: 40, top: 530 }}>
        <Panel bg={C.sun} radius={36} shadow={8} style={{ width: 300, height: 190, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 30, lineHeight: 1, display: 'flex', alignItems: 'center', gap: 6 }}><Die v={5} size={40} /> + jokers <Die v={1} size={40} /></div>
          <div style={{ fontSize: 120, lineHeight: 1, paddingTop: 8 }}>{count}</div>
        </Panel>
      </Pop>
      <Pop f={f} at={VERDICT} rot={3} style={{ position: 'absolute', left: 370, top: 530 }}>
        <Panel bg="#ffd0da" radius={36} shadow={8} style={{ width: 310, height: 190, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 40, lineHeight: 1.1 }}>
          Il en fallait 5 :<div style={{ color: C.tomato, fontSize: 46 }}>Cycy mentait !</div>
        </Panel>
      </Pop>
      <Pop f={f} at={VERDICT + 18} rot={-3} style={{ position: 'absolute', left: 0, right: 0, top: 750, display: 'flex', justifyContent: 'center' }}>
        <Outlined size={70} color={C.sun}>Cycy perd un dé !</Outlined>
      </Pop>
      {hits.map((at, k) => <Sfx key={k} name="pop" at={at + 8} volume={0.6} />)}
      <Sfx name="whoosh" at={VERDICT} volume={0.5} />
      <Sfx name="tap" at={VERDICT + 18} volume={0.9} />
    </>
  )
}

export const menteur: TutoSpec = {
  id: 'menteur',
  name: 'Menteur',
  emoji: '🎲',
  color: '#8B5CF6',
  players: '2 à 9 joueurs',
  goal: 'Bluffe sur les dés… sans te faire prendre !',
  cast: ['dede', 'kevin', 'cycy', 'mika'],
  steps: [
    { text: 'Chacun cache 5 dés sous son gobelet', seconds: 4.8, Mock: Hidden },
    { text: 'À ton tour, monte l’enchère : « 4 dés de 5 » sur toute la table', seconds: 5.8, Mock: Bidding },
    { text: 'Tu n’y crois pas ? Crie « Menteur ! » : on soulève tout', seconds: 5, Mock: Calling },
    { text: 'On compte : celui qui s’est trompé perd un dé', seconds: 5.8, Mock: Counting },
  ],
  win: {
    text: 'Plus de dé ? Éliminé ! Le dernier à avoir des dés gagne.',
    sub: 'Si l’enchère était vraie, c’est celui qui a crié « Menteur ! » qui perd un dé.',
    winners: ['mika'],
  },
}

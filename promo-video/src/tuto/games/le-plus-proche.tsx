// Tuto « Le plus proche » : « Combien de marches à la tour Eiffel ? » (1 665).
import React from 'react'
import { C, sticker, type Slug } from '../../theme'
import { Avatar, Chibi, Finger, Outlined, Panel, Pill, Pop, Sfx, TW, bob, ramp, sp, wiggle, type Tap } from '../kit'
import { ScoreRows, type ScoreRow } from '../parts'
import type { MockScene, TutoSpec } from '../types'

// 1 — La question
const Question: MockScene = ({ f }) => (
  <>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={0} rot={-2}><Pill bg={C.surface} size={34}>Manche 1/8</Pill></Pop>
    </div>
    <Pop f={f} at={6} from={80} rot={1} style={{ position: 'absolute', left: 50, top: 90 }}>
      <Panel bg={C.surface} radius={48} shadow={11} style={{ width: TW - 100, padding: '44px 36px 38px', fontSize: 64, lineHeight: 1.1, textAlign: 'center' }}>
        <div style={{ fontSize: 110, lineHeight: 1, marginBottom: 8 }}>🗼</div>
        Combien de marches à la tour Eiffel ?
      </Panel>
    </Pop>
    <div style={{ position: 'absolute', left: 60, top: 640 + (1 - sp(f, 30)) * 320 + bob(f, 0, 10, 26), transform: `rotate(${wiggle(f, 0, 3)}deg)` }}>
      <Chibi slug="dede" expression="reflexion" size={230} />
    </div>
    <div style={{ position: 'absolute', right: 60, top: 660 + (1 - sp(f, 36)) * 320 + bob(f, 12, 10, 26), transform: `rotate(${wiggle(f, 9, 3)}deg)` }}>
      <Chibi slug="mika" expression="surprise" size={230} />
    </div>
    <Pop f={f} at={70} rot={-4} style={{ position: 'absolute', left: 250, top: 620 }}>
      <Outlined size={70} color={C.sun}>Euh… 300 ?</Outlined>
    </Pop>
    <Sfx name="whoosh" at={6} volume={0.4} />
    <Sfx name="pop" at={78} volume={0.5} />
  </>
)

// 2 — Chacun tape son estimation
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK']
const KW = 150
const KH = 104
const KX = (TW - (KW * 3 + 32)) / 2
const keyXY = (k: number) => ({ x: KX + (k % 3) * (KW + 16), y: 176 + Math.floor(k / 3) * (KH + 16) })
const TYPED: { key: string; at: number }[] = [{ key: '1', at: 30 }, { key: '7', at: 48 }, { key: '0', at: 66 }, { key: '0', at: 84 }, { key: 'OK', at: 112 }]
const Typing: MockScene = ({ f }) => {
  const value = TYPED.filter((t) => t.key !== 'OK' && f >= t.at).map((t) => t.key).join('')
  const sent = f >= 112
  const taps: Tap[] = TYPED.map((t) => ({ at: t.at - 6, x: keyXY(KEYS.indexOf(t.key)).x + KW / 2, y: keyXY(KEYS.indexOf(t.key)).y + KH / 2 }))
  return (
    <>
      <Pop f={f} at={0} style={{ position: 'absolute', left: KX, top: 0 }}>
        <Panel bg={sent ? C.mint : C.surface} radius={32} shadow={7} style={{ width: KW * 3 + 32, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 92, lineHeight: 1, paddingTop: 10 }}>
          {value ? value.replace(/(\d)(\d{3})$/, '$1 $2') : <span style={{ color: '#c9c4d6' }}>?</span>}
          {sent && <span style={{ fontSize: 60, marginLeft: 16 }}>🔒</span>}
        </Panel>
      </Pop>
      {KEYS.map((key, k) => {
        const { x, y } = keyXY(k)
        const press = TYPED.some((t) => t.key === key && f >= t.at && f < t.at + 6)
        return (
          <Pop key={key} f={f} at={4 + k} style={{ position: 'absolute', left: x, top: y }}>
            <Panel bg={key === 'OK' ? C.mint : key === '⌫' ? C.sunk : C.surface} radius={26} shadow={press ? 1 : 5}
              style={{ width: KW, height: KH, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 62, lineHeight: 1, paddingTop: 8, transform: press ? 'translate(4px, 4px)' : undefined }}>
              {key}
            </Panel>
          </Pop>
        )
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 690, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={118} rot={-2}><Pill bg={C.grape} color="#ffffff" size={38}>🤫 Personne ne voit ta réponse</Pill></Pop>
      </div>
      <Finger f={f} taps={taps} />
      {TYPED.map((t, k) => <Sfx key={k} name={t.key === 'OK' ? 'pop' : 'type'} at={t.at} volume={0.9} />)}
    </>
  )
}

// 3 — Révélation sur une règle graduée
const MAX = 2400
const AX0 = 60
const AXW = 600
const xOf = (v: number) => AX0 + (v / MAX) * AXW
const AXIS_Y = 430
const GUESSES: { slug: Slug; name: string; v: number; up: boolean; at: number }[] = [
  { slug: 'mika', name: 'Mika', v: 300, up: true, at: 16 },
  { slug: 'kevin', name: 'Keke', v: 1200, up: false, at: 32 },
  { slug: 'cycy', name: 'Cycy', v: 2000, up: false, at: 48 },
  { slug: 'dede', name: 'Dédé', v: 1700, up: true, at: 64 },
]
const ANSWER = 1665
const ANS_AT = 96
const fmt = (v: number) => String(v).replace(/(\d)(\d{3})$/, '$1 $2')
const Reveal: MockScene = ({ f }) => (
  <>
    <div style={{ position: 'absolute', left: AX0 - 20, top: AXIS_Y - 9, width: AXW + 40, height: 18, borderRadius: 9, background: C.ink, transform: `scaleX(${ramp(f, 0, 12)})` }} />
    {[0, 600, 1200, 1800, 2400].map((v) => (
      <React.Fragment key={v}>
        <div style={{ position: 'absolute', left: xOf(v) - 4, top: AXIS_Y - 22, width: 8, height: 44, borderRadius: 4, background: C.ink, opacity: ramp(f, 4, 12) }} />
      </React.Fragment>
    ))}
    {GUESSES.map((g, k) => {
      const win = g.slug === 'dede' && f >= ANS_AT + 16
      return (
        <Pop key={g.slug} f={f} at={g.at} from={g.up ? -80 : 80} style={{ position: 'absolute', left: xOf(g.v) - 70, top: g.up ? AXIS_Y - 250 : AXIS_Y + 34, zIndex: win ? 4 : 1 }}>
          <div style={{ width: 140, display: 'flex', flexDirection: g.up ? 'column' : 'column-reverse', alignItems: 'center', gap: 4, transform: `scale(${win ? 1.12 + 0.04 * Math.sin(f / 4) : 1})` }}>
            <Pill bg={win ? C.mint : C.surface} size={34}>{fmt(g.v)}</Pill>
            <Avatar slug={g.slug} expression={win ? 'joie' : f >= ANS_AT ? (k === 0 ? 'pleurs' : 'surprise') : 'reflexion'} size={110} />
            <div style={{ width: 8, height: 36, background: C.ink, borderRadius: 4 }} />
          </div>
        </Pop>
      )
    })}
    {f >= ANS_AT && (
      <div style={{ position: 'absolute', left: xOf(ANSWER) - 6, top: 96, width: 12, height: AXIS_Y - 96 + 30, borderRadius: 6, background: C.tomato, border: `3px solid ${C.ink}`, boxSizing: 'border-box', transformOrigin: 'bottom', transform: `scaleY(${sp(f, ANS_AT)})`, zIndex: 3 }} />
    )}
    <Pop f={f} at={ANS_AT + 4} rot={-3} style={{ position: 'absolute', left: xOf(ANSWER) - 250, top: 0, zIndex: 5 }}>
      <Pill bg={C.tomato} color="#ffffff" size={50} style={{ boxShadow: sticker(7) }}>✅ 1 665 marches</Pill>
    </Pop>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 720, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={ANS_AT + 20} rot={-4}><Outlined size={58} color={C.mint} style={{ whiteSpace: 'nowrap' }}>Dédé est la plus proche !</Outlined></Pop>
    </div>
    {GUESSES.map((g, k) => <Sfx key={k} name="pop" at={g.at + 8} volume={0.5} />)}
    <Sfx name="whoosh" at={ANS_AT} volume={0.5} />
    <Sfx name="success" at={ANS_AT + 22} volume={0.5} />
  </>
)

// 4 — Les points
const ROWS: ScoreRow[] = [
  { slug: 'dede', name: 'Dédé', pts: 3, note: '🥇 la plus proche', at: 6 },
  { slug: 'cycy', name: 'Cycy', pts: 2, note: '🥈 2e', at: 26 },
  { slug: 'kevin', name: 'Keke', pts: 1, note: '🥉 3e', at: 46 },
]
const Points: MockScene = ({ f }) => (
  <>
    <ScoreRows f={f} rows={ROWS} rowH={160} />
    <Pop f={f} at={84} from={60} rot={-2} style={{ position: 'absolute', left: 36, top: 590 }}>
      <Panel bg={C.sun} radius={40} shadow={10} style={{ width: TW - 72, height: 210, display: 'flex', alignItems: 'center', gap: 20, padding: '0 30px' }}>
        <div style={{ fontSize: 110, lineHeight: 1 }}>🎯</div>
        <div style={{ flex: 1, fontSize: 48, lineHeight: 1.1 }}>Pile exact ?<div style={{ fontSize: 32 }}>bonus en plus des points</div></div>
        <div style={{ fontSize: 100, lineHeight: 1, paddingTop: 10, transform: `scale(${1 + 0.12 * Math.abs(Math.sin(Math.max(0, f - 90) / 6))})` }}>+5</div>
      </Panel>
    </Pop>
    <Sfx name="success" at={92} volume={0.5} />
  </>
)

export const lePlusProche: TutoSpec = {
  id: 'le-plus-proche',
  name: 'Le plus proche',
  emoji: '🎯',
  color: '#FFB570',
  players: '2 à 9 joueurs',
  goal: 'Estime le bon nombre… au plus près !',
  cast: ['dede', 'cycy', 'kevin', 'mika'],
  steps: [
    { text: 'Une question dont la réponse est un nombre', seconds: 4.6, Mock: Question },
    { text: 'Chacun tape son estimation en secret', seconds: 5.2, Mock: Typing },
    { text: 'Révélation : qui est le plus proche ?', seconds: 5.8, Mock: Reveal },
    { text: '3, 2, 1 points pour le podium… +5 si c’est pile exact !', seconds: 5.2, Mock: Points },
  ],
  win: {
    text: 'Le plus de points après toutes les manches gagne !',
    winners: ['dede'],
  },
}

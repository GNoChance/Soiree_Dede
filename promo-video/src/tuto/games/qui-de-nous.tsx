// Tuto « Qui de nous ? » : 6 joueurs, la majorité désigne Mika.
import React from 'react'
import { C, type Slug } from '../../theme'
import { Avatar, Chibi, Finger, Outlined, Panel, Pill, Pop, Sfx, TW, bob, bySlug, easeInOut, lerp, ramp, sp, wiggle } from '../kit'
import { ScoreRows, type ScoreRow } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const PLAYERS: { slug: Slug; name: string }[] = [
  { slug: 'dede', name: 'Dédé' }, { slug: 'kevin', name: 'Keke' }, { slug: 'cycy', name: 'Cycy' },
  { slug: 'mika', name: 'Mika' }, { slug: 'manon', name: 'Manon' }, { slug: 'marius', name: 'Marius' },
]
const ELU = 3
const QUESTION = 'Qui finirait les restes du frigo à 3 h du mat’ ?'

// 1 — La question
const Question: MockScene = ({ f }) => (
  <>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={0} rot={-2}><Pill bg={C.surface} size={34}>Question 1/10</Pill></Pop>
    </div>
    <Pop f={f} at={6} from={80} rot={-1} style={{ position: 'absolute', left: 50, top: 90 }}>
      <Panel bg={C.sun} radius={48} shadow={11} style={{ width: TW - 100, padding: '50px 40px 40px', fontSize: 66, lineHeight: 1.1, textAlign: 'center' }}>
        <div style={{ fontSize: 90, lineHeight: 1, marginBottom: 12 }}>🫵</div>
        {QUESTION.replace(' ?', ' ?')}
      </Panel>
    </Pop>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 650, display: 'flex', justifyContent: 'center', gap: 4 }}>
      {(['dede', 'kevin', 'cycy', 'manon'] as const).map((slug, k) => (
        <div key={slug} style={{ transform: `translateY(${(1 - sp(f, 30 + k * 5)) * 320 + bob(f, k * 9, 10, 26)}px) rotate(${wiggle(f, k * 7, 3)}deg)` }}>
          <Chibi slug={slug} expression={f > 70 + k * 8 ? 'clin_oeil' : 'reflexion'} size={168} />
        </div>
      ))}
    </div>
    <Sfx name="whoosh" at={6} volume={0.4} />
  </>
)

const seat = (k: number) => ({ x: 44 + (k % 3) * 216, y: 20 + Math.floor(k / 3) * 300 })
const Grid: React.FC<{ f: number; picked?: number; pickedAt?: number; counts?: number[]; hit?: number[]; elu?: boolean }> = ({ f, picked, pickedAt = 0, counts, hit, elu }) => (
  <>
    {PLAYERS.map((p, k) => {
      const { x, y } = seat(k)
      const on = picked === k && f >= pickedAt
      const n = counts?.[k] ?? 0
      const h = hit?.[k] ?? 0
      return (
        <Pop key={p.slug} f={f} at={k * 3} style={{ position: 'absolute', left: x, top: y }}>
          <Panel bg={on ? C.mint : elu && k === ELU ? '#ffe0e6' : C.surface} radius={34} shadow={on ? 10 : 6}
            style={{ width: 200, height: 270, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, transform: `scale(${(on ? 1 + 0.06 * sp(f, pickedAt) : 1) + h * 0.1}) rotate(${h * (k % 2 ? 4 : -4)}deg)` }}>
            <Avatar slug={p.slug} expression={elu && k === ELU ? 'boude' : n ? 'surprise' : 'joie'} size={150} />
            <div style={{ fontSize: 40, lineHeight: 1 }}>{p.name}</div>
            {n > 0 && <div style={{ position: 'absolute', right: -14, top: -16 }}><Pill bg={C.tomato} color="#ffffff" size={36}>{n}</Pill></div>}
            {on && <div style={{ position: 'absolute', right: -14, top: -16 }}><Pill bg={C.surface} size={36}>✔</Pill></div>}
          </Panel>
        </Pop>
      )
    })}
  </>
)

// 2 — Vote secret
const PICK_AT = 52
const Vote: MockScene = ({ f }) => (
  <>
    <Grid f={f} picked={ELU} pickedAt={PICK_AT} />
    <div style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={PICK_AT + 12} rot={-2}><Pill bg={C.grape} color="#ffffff" size={38}>🤫 Personne ne voit ton vote</Pill></Pop>
    </div>
    <div style={{ position: 'absolute', left: 250, top: 716 + (1 - sp(f, 20)) * 300 + bob(f, 0, 10, 24) }}>
      <Chibi slug="cycy" expression={f >= PICK_AT ? 'clin_oeil' : 'reflexion'} size={200} />
    </div>
    <Finger f={f} taps={[{ at: PICK_AT - 8, x: seat(ELU).x + 110, y: seat(ELU).y + 150 }]} />
    <Sfx name="tap" at={PICK_AT} volume={0.8} />
    <Sfx name="pop" at={PICK_AT + 14} volume={0.5} />
  </>
)

// 3 — Révélation des votes
const VOTES: { from: number; to: number; at: number }[] = [
  { from: 0, to: 3, at: 24 }, { from: 1, to: 0, at: 38 }, { from: 2, to: 3, at: 52 }, { from: 3, to: 1, at: 66 }, { from: 4, to: 3, at: 80 }, { from: 5, to: 3, at: 94 },
]
const Reveal: MockScene = ({ f }) => {
  const counts = PLAYERS.map((_, k) => VOTES.filter((v) => v.to === k && f >= v.at + 12).length)
  const hit = PLAYERS.map((_, k) => Math.max(0, ...VOTES.filter((v) => v.to === k).map((v) => 1 - Math.abs(f - v.at - 13) / 5)))
  return (
    <>
      <Grid f={f} counts={counts} hit={hit} elu={f >= 110} />
      {VOTES.map((v, i) => {
        const p = easeInOut(ramp(f, v.at, v.at + 12))
        if (f < v.at || p >= 1) return null
        const a = seat(v.from)
        const b = seat(v.to)
        return (
          <div key={i} style={{ position: 'absolute', left: lerp(a.x + 60, b.x + 60, p), top: lerp(a.y + 60, b.y + 60, p) - Math.sin(p * Math.PI) * 80, transform: `rotate(${p * 360}deg)`, zIndex: 5 }}>
            <div style={{ width: 76, height: 76, borderRadius: '50%', background: bySlug(PLAYERS[v.from].slug).color, border: `5px solid ${C.ink}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 42 }}>🫵</div>
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 650, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={112} rot={-4}><Outlined size={84} color={C.sun}>C’est Mika !</Outlined></Pop>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 770, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={124} rot={2}><Pill bg={C.surface} size={36}>4 votes : c’est la majorité</Pill></Pop>
      </div>
      {VOTES.map((v, i) => <Sfx key={i} name="pop" at={v.at + 20} volume={0.5} />)}
      <Sfx name="success" at={120} volume={0.5} />
    </>
  )
}

// 4 — Qui marque ?
const ROWS: ScoreRow[] = [
  { slug: 'dede', name: 'Dédé', pts: 1, note: 'a voté Mika ✅', at: 8 },
  { slug: 'cycy', name: 'Cycy', pts: 1, note: 'a voté Mika ✅', at: 30 },
  { slug: 'kevin', name: 'Keke', pts: 0, note: 'a voté Dédé… raté', at: 54, expr: 'boude' },
  { slug: 'mika', name: 'Mika', pts: 0, note: 'a voté Keke… raté', at: 78, expr: 'pleurs' },
]
const Points: MockScene = ({ f }) => <ScoreRows f={f} rows={ROWS} />

export const quiDeNous: TutoSpec = {
  id: 'qui-de-nous',
  name: 'Qui de nous ?',
  emoji: '🫵',
  color: '#FF8FA3',
  players: '3 à 9 joueurs',
  goal: 'Vote comme la majorité pour marquer !',
  cast: ['dede', 'kevin', 'cycy', 'mika'],
  steps: [
    { text: 'Une question s’affiche pour tout le monde', seconds: 4.8, Mock: Question },
    { text: 'En secret, touche le joueur qui correspond le mieux', seconds: 5, Mock: Vote },
    { text: 'Les votes sont révélés !', seconds: 5.8, Mock: Reveal },
    { text: 'Tu as voté comme la majorité ? +1 point', seconds: 5, Mock: Points },
  ],
  win: {
    text: 'Le plus de points à la fin des questions gagne !',
    winners: ['dede', 'cycy'],
  },
}

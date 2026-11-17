// Tuto « Undercover » : 4 joueurs, mot civil « Chat », mot de l'infiltré « Chien ».
import React from 'react'
import { C, type Slug } from '../../theme'
import { Avatar, Bubble, Chibi, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, bob, bySlug, clamp01, easeInOut, lerp, ramp, sp, wiggle } from '../kit'
import type { MockScene, TutoSpec } from '../types'

const PLAYERS: { slug: Slug; name: string; word: string; clue: string }[] = [
  { slug: 'dede', name: 'Dédé', word: 'Chat', clue: 'Moustaches' },
  { slug: 'kevin', name: 'Keke', word: 'Chat', clue: 'Ronron' },
  { slug: 'cycy', name: 'Cycy', word: 'Chat', clue: 'Griffes' },
  { slug: 'mika', name: 'Mika', word: 'Chien', clue: 'Aboie' },
]
const SPY = 3

// 1 — Chacun reçoit un mot secret (cartes qui se retournent)
const Words: MockScene = ({ f }) => (
  <>
    {PLAYERS.map((p, k) => {
      const x = 44 + (k % 2) * 326
      const y = 10 + Math.floor(k / 2) * 370
      const flip = easeInOut(ramp(f, 22 + k * 12, 34 + k * 12))
      const back = flip < 0.5
      const spy = k === SPY
      return (
        <Pop key={p.slug} f={f} at={k * 4} rot={k % 2 ? 2 : -2} style={{ position: 'absolute', left: x, top: y }}>
          <Panel bg={back ? C.grape : spy ? '#ffe0e6' : C.surface} radius={36}
            style={{ width: 306, height: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, transform: `scaleX(${Math.abs(1 - 2 * flip)})` }}>
            {back ? (
              <div style={{ fontSize: 150, lineHeight: 1, color: '#ffffff' }}>?</div>
            ) : (
              <>
                <Avatar slug={p.slug} expression={spy ? 'reflexion' : 'joie'} size={120} />
                <div style={{ fontSize: 32, lineHeight: 1, color: C.muted }}>{p.name}</div>
                <div style={{ fontSize: 76, lineHeight: 1, color: spy ? C.tomato : C.ink }}>{p.word}</div>
              </>
            )}
          </Panel>
        </Pop>
      )
    })}
    <div style={{ position: 'absolute', left: 0, right: 0, top: 752, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={84} rot={-2}><Pill bg={C.tomato} color="#ffffff" size={36}>🕵️ L’infiltré a un mot voisin…</Pill></Pop>
    </div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 826, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={104} rot={1}><Pill bg={C.surface} size={30}>…et il ne le sait pas !</Pill></Pop>
    </div>
    {PLAYERS.map((_, k) => <Sfx key={k} name="swoosh-up" at={30 + k * 12} volume={0.35} />)}
    <Sfx name="pop" at={92} volume={0.6} />
  </>
)

// 2 — Chacun décrit son mot en un seul mot
const Clues: MockScene = ({ f }) => (
  <>
    {PLAYERS.map((p, k) => {
      const at = 14 + k * 30
      const left = k % 2 === 0
      const y = 0 + k * 208
      const talking = f >= at && f < at + 30
      const shocked = f >= 14 + SPY * 30 + 8 && k !== SPY
      return (
        <React.Fragment key={p.slug}>
          <div style={{ position: 'absolute', [left ? 'left' : 'right']: 36, top: y + (1 - sp(f, k * 3)) * 60 + bob(f, k * 9, talking ? 18 : 6, talking ? 12 : 30), opacity: clamp01(sp(f, k * 3) * 3) }}>
            <Chibi slug={p.slug} expression={shocked ? 'surprise' : k === SPY && f >= at ? 'clin_oeil' : 'joie'} size={196} />
          </div>
          <Pop f={f} at={at} rot={left ? -3 : 3} style={{ position: 'absolute', [left ? 'left' : 'right']: 236, top: y + 36 }}>
            <Bubble tail={left ? 'left' : 'right'} size={50} bg={k === SPY ? '#ffe0e6' : C.surface}>« {p.clue} »</Bubble>
          </Pop>
          <Sfx name="pop" at={at + 8} volume={0.55} />
        </React.Fragment>
      )
    })}
    <Pop f={f} at={14 + SPY * 30 + 14} rot={-8} style={{ position: 'absolute', left: 150, top: 790 }}>
      <Outlined size={84} color={C.sun}>Hein ?!</Outlined>
    </Pop>
  </>
)

// 3 — On vote contre le suspect
const VOTES: { from: number; to: number; at: number }[] = [
  { from: 0, to: 3, at: 34 },
  { from: 1, to: 3, at: 50 },
  { from: 3, to: 2, at: 66 },
  { from: 2, to: 3, at: 82 },
]
const seat = (k: number) => ({ x: 70 + (k % 2) * 330, y: 60 + Math.floor(k / 2) * 380 })
const Voting: MockScene = ({ f }) => (
  <>
    {PLAYERS.map((p, k) => {
      const { x, y } = seat(k)
      const n = VOTES.filter((v) => v.to === k && f >= v.at + 12).length
      const hit = Math.max(0, ...VOTES.filter((v) => v.to === k).map((v) => 1 - Math.abs(f - v.at - 13) / 5))
      return (
        <Pop key={p.slug} f={f} at={k * 3} style={{ position: 'absolute', left: x, top: y }}>
          <div style={{ width: 250, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transform: `scale(${1 + hit * 0.12}) rotate(${hit * (k % 2 ? 5 : -5)}deg)` }}>
            <Avatar slug={p.slug} expression={n >= 2 ? 'surprise' : 'reflexion'} size={210} />
            <Pill bg={n ? C.tomato : C.surface} color={n ? '#ffffff' : C.ink} size={34}>{p.name}{n ? ` · ${n} 🗳️` : ''}</Pill>
          </div>
        </Pop>
      )
    })}
    {VOTES.map((v, i) => {
      const p = easeInOut(ramp(f, v.at, v.at + 12))
      if (f < v.at || p >= 1) return null
      const a = seat(v.from)
      const b = seat(v.to)
      return (
        <div key={i} style={{ position: 'absolute', left: lerp(a.x + 85, b.x + 85, p), top: lerp(a.y + 60, b.y + 60, p) - Math.sin(p * Math.PI) * 90, transform: `rotate(${p * 360}deg)` }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: bySlug(PLAYERS[v.from].slug).color, border: `5px solid ${C.ink}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44 }}>👉</div>
        </div>
      )
    })}
    {VOTES.map((v, i) => <Sfx key={i} name="pop" at={v.at + 20} volume={0.5} />)}
    <div style={{ position: 'absolute', left: 0, right: 0, top: 800, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={8} rot={-2}><Pill bg={C.sun} size={34}>🤫 Vote secret sur ton téléphone</Pill></Pop>
    </div>
  </>
)

// 4 — Le plus voté est éliminé, son rôle est révélé
const Reveal: MockScene = ({ f }) => {
  const stamp = sp(f, 48, SPRING.pop)
  return (
    <>
      <Pop f={f} at={2} from={80} style={{ position: 'absolute', left: (TW - 520) / 2, top: 30 }}>
        <Panel radius={48} shadow={10} style={{ width: 520, height: 620, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 30 }}>
          <div style={{ fontSize: 40, color: C.muted, lineHeight: 1 }}>Éliminé !</div>
          <div style={{ transform: `rotate(${wiggle(f, 0, 3)}deg)`, marginTop: 8 }}>
            <Chibi slug="mika" expression={f >= 48 ? 'pleurs' : 'surprise'} size={360} />
          </div>
          <div style={{ fontSize: 64, lineHeight: 1 }}>Mika</div>
          <div style={{ fontSize: 36, lineHeight: 1.3, color: C.muted, opacity: clamp01(sp(f, 70) * 2) }}>Son mot : <span style={{ color: C.tomato }}>Chien</span></div>
        </Panel>
      </Pop>
      {f >= 48 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 336, display: 'flex', justifyContent: 'center', transform: `scale(${3 - 2 * Math.min(1, stamp)}) rotate(-12deg)`, opacity: clamp01(stamp * 2) }}>
          <Pill bg={C.tomato} color="#ffffff" size={56} style={{ borderWidth: 6 }}>🕵️ UNDERCOVER</Pill>
        </div>
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 716, display: 'flex', justifyContent: 'center', gap: 18 }}>
        {(['dede', 'kevin', 'cycy'] as const).map((slug, k) => (
          <div key={slug} style={{ transform: `translateY(${(1 - sp(f, 70 + k * 4)) * 300 + bob(f, k * 8, 26, 14)}px)` }}>
            <Chibi slug={slug} expression="joie" size={150} />
          </div>
        ))}
      </div>
      <Sfx name="whoosh" at={2} volume={0.4} />
      <Sfx name="pop" at={56} volume={0.8} />
      <Sfx name="success" at={76} volume={0.5} />
    </>
  )
}

export const undercover: TutoSpec = {
  id: 'undercover',
  name: 'Undercover',
  emoji: '🕵️',
  color: '#8B5CF6',
  players: '3 à 9 joueurs',
  goal: 'Démasquez l’infiltré… sans vous trahir !',
  cast: ['dede', 'kevin', 'cycy', 'mika'],
  steps: [
    { text: 'Chacun reçoit un mot secret sur son téléphone', seconds: 5.8, Mock: Words },
    { text: 'À tour de rôle, décris ton mot à voix haute… en UN seul mot', seconds: 6, Mock: Clues },
    { text: 'Débattez, puis votez pour éliminer le suspect', seconds: 5, Mock: Voting },
    { text: 'Le plus voté est éliminé : son rôle est révélé !', seconds: 5, Mock: Reveal },
  ],
  win: {
    text: 'Les civils gagnent en éliminant tous les infiltrés.',
    sub: 'Les infiltrés gagnent s’ils tiennent jusqu’à être aussi nombreux que les civils !',
    winners: ['dede', 'kevin', 'cycy'],
  },
}

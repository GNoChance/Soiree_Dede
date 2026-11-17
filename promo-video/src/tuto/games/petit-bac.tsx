// Tuto « Petit bac » : lettre B, 4 joueurs.
import React from 'react'
import { random } from 'remotion'
import { C, sticker, type Slug } from '../../theme'
import { Avatar, ConfettiBurst, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, clamp01, ramp, sp, wiggle } from '../kit'
import { Fly, ScoreRows, TimerBar, type ScoreRow } from '../parts'
import type { MockScene, TutoSpec } from '../types'

// 1 — Tirage de la lettre
const ALPHA = 'AMRTPLSCDFGHN'
const STOP = 56
const Letter: MockScene = ({ f }) => {
  const done = f >= STOP
  const letter = done ? 'B' : ALPHA[Math.floor(random(`l${Math.floor(f / 3)}`) * ALPHA.length)]
  const s = done ? 0.8 + 0.2 * sp(f, STOP, SPRING.pop) : 1
  return (
    <>
      <Pop f={f} at={0} style={{ position: 'absolute', left: (TW - 400) / 2, top: 90 }}>
        <Panel bg={done ? C.lime : C.surface} radius={80} shadow={14}
          style={{ width: 400, height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 320, lineHeight: 1, paddingTop: 36, transform: `scale(${s}) rotate(${done ? -4 : wiggle(f, 0, 3, 10)}deg)` }}>
          {letter}
        </Panel>
      </Pop>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 570, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={STOP + 8} rot={-3}><Outlined size={60} color={C.sun} style={{ whiteSpace: 'nowrap' }}>Tout commence par B !</Outlined></Pop>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 760, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={STOP + 22} rot={2}><Pill bg={C.surface} size={36}>Nouvelle lettre à chaque manche</Pill></Pop>
      </div>
      <ConfettiBurst f={f} at={STOP} y={300} seed="pb" n={26} />
      {Array.from({ length: 9 }, (_, k) => <Sfx key={k} name="type" at={k * 6} volume={0.7} />)}
      <Sfx name="success" at={STOP + 2} volume={0.5} />
    </>
  )
}

// 2 — On remplit sa feuille
const CATS = [
  { icon: '🌍', label: 'Pays', word: 'Belgique' },
  { icon: '🐾', label: 'Animal', word: 'Baleine' },
  { icon: '🧑‍🍳', label: 'Métier', word: 'Boulanger' },
  { icon: '🍎', label: 'Fruit ou légume', word: 'Banane' },
]
const Filling: MockScene = ({ f, dur }) => (
  <>
    <div style={{ position: 'absolute', left: 40, top: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
      <Panel bg={C.lime} radius={22} shadow={5} style={{ width: 84, height: 84, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64, lineHeight: 1, paddingTop: 8 }}>B</Panel>
      <div style={{ fontSize: 40, lineHeight: 1 }}>⏱️</div>
      <TimerBar p={0.15 + ramp(f, 0, dur) * 0.6} width={TW - 250} />
    </div>
    {CATS.map((c, k) => {
      const start = 16 + k * 34
      const n = Math.max(0, Math.min(c.word.length, Math.floor((f - start) / 2.6) + 1))
      const typing = f >= start && n < c.word.length
      const full = n >= c.word.length
      return (
        <Pop key={c.label} f={f} at={2 + k * 3} from={40} style={{ position: 'absolute', left: 40, top: 120 + k * 172 }}>
          <Panel bg={full ? '#eefbc8' : C.surface} radius={30} shadow={typing ? 9 : 6} style={{ width: TW - 80, height: 148, padding: '14px 26px 0', borderColor: C.ink }}>
            <div style={{ fontSize: 30, lineHeight: 1.1, color: C.muted }}>{c.icon} {c.label}</div>
            <div style={{ fontSize: 66, lineHeight: 1.15 }}>
              {f >= start ? c.word.slice(0, n) : ''}
              {typing ? <span style={{ color: C.grape }}>|</span> : null}
              {full ? <span style={{ float: 'right', fontSize: 50 }}>✔️</span> : null}
            </div>
          </Panel>
        </Pop>
      )
    })}
    {CATS.map((c, k) => [...c.word].map((_, i) => (i % 2 === 0 ? <Sfx key={`${k}-${i}`} name="type" at={16 + k * 34 + Math.round(i * 2.6)} volume={0.6} /> : null)))}
  </>
)

// 3 — Validation collective
const ANSWERS: { slug: Slug; name: string; word: string }[] = [
  { slug: 'dede', name: 'Dédé', word: 'Boulanger' },
  { slug: 'kevin', name: 'Keke', word: 'Boucher' },
  { slug: 'mika', name: 'Mika', word: 'Bébé' },
]
const NO_AT = [58, 82]
const REFUSED = 104
const Validation: MockScene = ({ f }) => {
  const n = NO_AT.filter((at) => f >= at + 12).length
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={0} rot={-2}><Pill bg={C.lime} size={44}>🧑‍🍳 Métier en B</Pill></Pop>
      </div>
      {ANSWERS.map((a, k) => {
        const bad = k === 2
        const out = bad && f >= REFUSED
        return (
          <Pop key={a.slug} f={f} at={8 + k * 8} from={40} rot={k % 2 ? 1 : -1} style={{ position: 'absolute', left: 40, top: 100 + k * 190 }}>
            <Panel bg={out ? '#ffd0da' : C.surface} radius={34} style={{ width: TW - 80, height: 160, display: 'flex', alignItems: 'center', gap: 18, padding: '0 24px 0 16px', transform: `translateX(${bad && n && !out ? Math.sin(f * 1.6) * 4 : 0}px)` }}>
              <Avatar slug={a.slug} expression={bad ? (out ? 'boude' : 'clin_oeil') : 'joie'} size={118} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 28, lineHeight: 1.1, color: C.muted }}>{a.name}</div>
                <div style={{ fontSize: 62, lineHeight: 1.1, textDecoration: out ? 'line-through' : 'none' }}>{a.word}</div>
              </div>
              {bad && n > 0 && <Pill bg={C.tomato} color="#ffffff" size={40} style={{ transform: `scale(${1 + 0.2 * clamp01(1 - Math.abs(f - NO_AT[n - 1] - 14) / 5)})` }}>👎 {n}</Pill>}
              {!bad && <div style={{ fontSize: 56, opacity: clamp01(sp(f, 30 + k * 6)) }}>✅</div>}
            </Panel>
          </Pop>
        )
      })}
      {NO_AT.map((at, k) => <Fly key={k} f={f} at={at} len={12} from={[k ? 520 : 200, 760]} to={[590, 560]} arc={60} size={70}>👎</Fly>)}
      {(['cycy', 'dede'] as const).map((slug, k) => (
        <Pop key={slug} f={f} at={40 + k * 6} style={{ position: 'absolute', left: k ? 460 : 140, top: 716 }}>
          <Avatar slug={slug} expression={f >= NO_AT[k] ? 'colere' : 'reflexion'} size={120} />
        </Pop>
      ))}
      {f >= REFUSED && (
        <div style={{ position: 'absolute', left: 300, top: 590, transform: `scale(${3 - 2 * Math.min(1, sp(f, REFUSED, SPRING.pop))}) rotate(-10deg)`, opacity: clamp01(sp(f, REFUSED) * 2), zIndex: 6 }}>
          <Pill bg={C.tomato} color="#ffffff" size={46} style={{ boxShadow: sticker(6) }}>Refusé : 0 point</Pill>
        </div>
      )}
      <div style={{ position: 'absolute', left: 270, top: 744 }}>
        <Pop f={f} at={REFUSED + 12}><Pill bg={C.surface} size={28}>la majorité<br />a contesté</Pill></Pop>
      </div>
      {NO_AT.map((at, k) => <Sfx key={k} name="pop" at={at + 20} volume={0.6} />)}
      <Sfx name="tap" at={REFUSED + 8} volume={0.9} />
    </>
  )
}

// 4 — Le barème
const ROWS: ScoreRow[] = [
  { slug: 'cycy', name: 'Bolivie', pts: 2, note: 'Cycy · réponse unique', at: 8, bg: '#eefbc8' },
  { slug: 'dede', name: 'Belgique', pts: 1, note: 'Dédé · réponse partagée', at: 34 },
  { slug: 'kevin', name: 'Belgique', pts: 1, note: 'Keke · réponse partagée', at: 52 },
  { slug: 'mika', name: '…', pts: 0, note: 'Mika · case vide', at: 76 },
]
const Scoring: MockScene = ({ f }) => (
  <>
    <ScoreRows f={f} rows={ROWS} top={84} rowH={152} />
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={0} rot={-2}><Pill bg={C.lime} size={40}>🌍 Pays en B</Pill></Pop>
    </div>
  </>
)

export const petitBac: TutoSpec = {
  id: 'petit-bac',
  name: 'Petit bac',
  emoji: '🔤',
  color: '#B5E61D',
  players: '2 à 9 joueurs',
  goal: 'Un mot par catégorie, avec la bonne lettre !',
  cast: ['cycy', 'dede', 'kevin', 'mika'],
  steps: [
    { text: 'Une lettre est tirée au sort', seconds: 4.4, Mock: Letter },
    { text: 'Remplis un mot par catégorie avant la fin du chrono', seconds: 6, Mock: Filling },
    { text: 'On valide ensemble : 👎 pour contester', seconds: 5.6, Mock: Validation },
    { text: 'Réponse unique : 2 points. Réponse partagée : 1 point', seconds: 5.2, Mock: Scoring },
  ],
  win: {
    text: 'Le plus de points après toutes les manches gagne !',
    winners: ['cycy'],
  },
}

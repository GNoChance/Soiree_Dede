// Tuto « Cerveau en fête » : quiz chronométré, questions à taper ou en QCM (le mode dépend de la question).
import React from 'react'
import { C, type Slug } from '../../theme'
import { Chibi, Finger, Panel, Pill, Pop, Sfx, TW, bob, ramp, sp, wiggle } from '../kit'
import { ScoreRows, TimerBar, type ScoreRow } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const QuestionCard: React.FC<{ f: number; dur: number; from?: number; badge: string; badgeBg: string; text: string; emoji?: string }> = ({ f, dur, from = 0, badge, badgeBg, text, emoji }) => (
  <>
    <div style={{ position: 'absolute', left: 40, top: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ fontSize: 40, lineHeight: 1 }}>⏱️</div>
      <TimerBar p={from + ramp(f, 0, dur) * 0.4} width={TW - 140} />
    </div>
    <Pop f={f} at={2} from={60} rot={-1} style={{ position: 'absolute', left: 40, top: 76 }}>
      <Panel radius={40} shadow={9} style={{ width: TW - 80, padding: emoji ? '34px 30px 30px' : '40px 26px 22px', fontSize: emoji ? 58 : 44, lineHeight: 1.1, textAlign: 'center' }}>
        {emoji && <div style={{ fontSize: 100, lineHeight: 1, marginBottom: 6 }}>{emoji}</div>}
        {text}
        <div style={{ position: 'absolute', left: 24, top: -26, transform: 'rotate(-3deg)' }}><Pill bg={badgeBg} color="#ffffff" size={30}>{badge}</Pill></div>
      </Panel>
    </Pop>
  </>
)
const Q = 'Quelle est la capitale de l’Australie ?'

// 1 — Une question, un chrono
const Question: MockScene = ({ f, dur }) => (
  <>
    <QuestionCard f={f} dur={dur} badge="🌍 Géographie" badgeBg={C.sky} text={Q} emoji="🦘" />
    {(['kevin', 'manon', 'marius'] as const).map((slug, k) => (
      <div key={slug} style={{ position: 'absolute', left: 50 + k * 215, top: 560 + (k % 2) * 30 + (1 - sp(f, 26 + k * 5)) * 400 + bob(f, k * 9, 10, 24), transform: `rotate(${wiggle(f, k * 8, 3)}deg)` }}>
        <Chibi slug={slug} expression={f > 80 && k === 1 ? 'joie' : 'reflexion'} size={210} />
      </div>
    ))}
    <Sfx name="whoosh" at={4} volume={0.4} />
  </>
)

// 2 — Réponse tapée : essais illimités, petites fautes acceptées
const TRY1 = 'sydney'
const TRY2 = 'canbera'
const T1 = 16
const SEND1 = 46
const T2 = 74
const SEND2 = 110
const Typed: MockScene = ({ f, dur }) => {
  const second = f >= T2
  const text = second ? TRY2.slice(0, Math.max(0, Math.floor((f - T2) / 4) + 1)) : f >= SEND1 + 14 ? '' : TRY1.slice(0, Math.max(0, Math.floor((f - T1) / 4) + 1))
  const wrong = f >= SEND1 && f < SEND1 + 14
  const ok = f >= SEND2
  return (
    <>
      <QuestionCard f={f} dur={dur} from={0.1} badge="⌨️ Tape ta réponse" badgeBg={C.grape} text={Q} />
      <div style={{ position: 'absolute', left: 40, top: 330, transform: `translateX(${wrong ? Math.sin(f * 2.4) * 14 : 0}px)` }}>
        <Panel bg={ok ? C.mint : wrong ? '#ffd0da' : C.surface} radius={32} shadow={7} style={{ width: TW - 80, height: 130, display: 'flex', alignItems: 'center', padding: '8px 30px 0', fontSize: 64, lineHeight: 1 }}>
          <div style={{ flex: 1 }}>{f >= T1 ? text : ''}{!ok && !wrong && Math.floor(f / 8) % 2 === 0 ? <span style={{ color: C.grape }}>|</span> : null}</div>
          <div>{ok ? '✅' : wrong ? '❌' : ''}</div>
        </Panel>
      </div>
      <Pop f={f} at={SEND1 + 4} rot={-2} style={{ position: 'absolute', left: 60, top: 500 }}>
        <Pill bg={C.surface} size={36}>❌ Raté ? Réessaie tout de suite !</Pill>
      </Pop>
      <Pop f={f} at={SEND2 + 6} rot={2} style={{ position: 'absolute', left: 60, top: 590 }}>
        <Pill bg={C.mint} size={36}>✅ Petite faute acceptée : Canberra</Pill>
      </Pop>
      <div style={{ position: 'absolute', left: 250, top: 690 + (1 - sp(f, 10)) * 300 + bob(f, 0, ok ? 26 : 8, ok ? 14 : 26) }}>
        <Chibi slug="manon" expression={ok ? 'joie' : wrong ? 'surprise' : 'gamer'} size={220} />
      </div>
      {[...TRY1].map((_, k) => <Sfx key={k} name="type" at={T1 + k * 4} volume={0.8} />)}
      {[...TRY2].map((_, k) => <Sfx key={`b${k}`} name="type" at={T2 + k * 4} volume={0.8} />)}
      <Sfx name="tap" at={SEND1} volume={0.9} />
      <Sfx name="success" at={SEND2} volume={0.55} />
    </>
  )
}

// 3 — Question en QCM : un seul essai
const CHOICES = ['Diplodocus', 'Tyrannosaure', 'Tricératops', 'Vélociraptor']
const GOOD = 1
const PICK_AT = 70
const Mcq: MockScene = ({ f, dur }) => (
  <>
    <QuestionCard f={f} dur={dur} from={0.05} badge="🔘 QCM · 1 essai" badgeBg={C.sky} text="Quel dinosaure est surnommé « T. rex » ?" />
    {CHOICES.map((c, k) => {
      const on = k === GOOD && f >= PICK_AT
      return (
        <Pop key={c} f={f} at={10 + k * 4} style={{ position: 'absolute', left: 60, top: 330 + k * 116 }}>
          <Panel bg={on ? C.mint : C.surface} radius={28} shadow={on ? 9 : 5}
            style={{ width: TW - 120, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 50, lineHeight: 1, paddingTop: 8, transform: `scale(${on ? 1 + 0.06 * sp(f, PICK_AT) : 1})`, opacity: f >= PICK_AT && !on ? 0.5 : 1 }}>
            {c}{on ? ' ✅' : ''}
          </Panel>
        </Pop>
      )
    })}
    <div style={{ position: 'absolute', left: 0, right: 0, top: 800, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={22} rot={-2}><Pill bg={C.sun} size={38}>☝️ Un seul essai : réfléchis bien !</Pill></Pop>
    </div>
    <Finger f={f} taps={[{ at: PICK_AT - 8, x: 520, y: 330 + GOOD * 116 + 56 }]} />
    <Sfx name="tap" at={PICK_AT} volume={0.8} />
    <Sfx name="success" at={PICK_AT + 4} volume={0.5} />
  </>
)

// 4 — La vitesse paie
const ROWS: (ScoreRow & { slug: Slug })[] = [
  { slug: 'manon', name: 'Manon', pts: 200, note: '⚡ 1re à trouver : bonus +20', at: 8 },
  { slug: 'marius', name: 'Marius', pts: 150, note: 'trouvé un peu après', at: 32 },
  { slug: 'kevin', name: 'Keke', pts: 110, note: 'trouvé à la dernière seconde', at: 56 },
  { slug: 'mika', name: 'Mika', pts: 0, note: 'pas trouvé…', at: 80 },
]
const Scoring: MockScene = ({ f }) => <ScoreRows f={f} rows={ROWS} />

export const cerveauEnFete: TutoSpec = {
  id: 'cerveau-en-fete',
  name: 'Cerveau en fête',
  emoji: '🧠',
  color: '#4CC9F0',
  players: '2 à 9 joueurs',
  goal: 'Réponds juste… et plus vite que les autres !',
  cast: ['manon', 'marius', 'kevin', 'mika'],
  steps: [
    { text: 'Une question, un chrono', seconds: 4.4, Mock: Question },
    { text: 'Tape ta réponse : essais illimités, petites fautes acceptées', seconds: 6, Mock: Typed },
    { text: 'Certaines questions sont en QCM : un seul essai !', seconds: 5, Mock: Mcq },
    { text: 'Plus tu es rapide, plus tu marques : +20 pour le premier !', seconds: 5.2, Mock: Scoring },
  ],
  win: {
    text: 'Le meilleur score à la fin du quiz gagne !',
    winners: ['manon'],
  },
}

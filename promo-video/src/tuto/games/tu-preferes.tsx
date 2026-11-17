// Tuto « Tu préfères ? » : 5 joueurs, Mika est le seul à préférer les spaghettis (Rebelle) mais parie bien.
import React from 'react'
import { C, type Slug } from '../../theme'
import { Avatar, Finger, Panel, Pill, Pop, Sfx, TW, ramp, sp } from '../kit'
import type { MockScene, TutoSpec } from '../types'

const A = { emoji: '🍝', text: 'Des spaghettis à la place des mains', bg: '#ffe9bf' }
const B = { emoji: '🌭', text: 'Des saucisses à la place des pieds', bg: '#e6dcff' }
const CARD_H = 250
const yOf = (k: number) => 110 + k * (CARD_H + 80)

const Dilemma: React.FC<{ f: number; pickA?: number; pickB?: number; intro?: boolean }> = ({ f, pickA, pickB, intro }) => (
  <>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={0} rot={-2}><Pill bg={C.surface} size={44}>🤔 Tu préfères…</Pill></Pop>
    </div>
    {[A, B].map((c, k) => {
      const at = k ? pickB : pickA
      const on = at !== undefined && f >= at
      return (
        <Pop key={k} f={f} at={intro ? 8 + k * 26 : 2 + k * 3} rot={k ? 1.5 : -1.5} from={60} style={{ position: 'absolute', left: 40, top: yOf(k) }}>
          <Panel bg={c.bg} radius={40} shadow={on ? 12 : 8}
            style={{ width: TW - 80, height: CARD_H, display: 'flex', alignItems: 'center', gap: 22, padding: '0 30px', transform: `scale(${on ? 1 + 0.05 * sp(f, at) : 1})`, borderColor: C.ink }}>
            <div style={{ fontSize: 130, lineHeight: 1 }}>{c.emoji}</div>
            <div style={{ fontSize: 50, lineHeight: 1.1 }}>{c.text}</div>
            {on && (
              <div style={{ position: 'absolute', right: -10, top: -20, transform: `scale(${sp(f, at)}) rotate(${k ? 4 : -4}deg)` }}>
                <Pill bg={k ? C.grape : C.tomato} color="#ffffff" size={36}>{k ? '🔮 Mon pari' : '❤️ Mon choix'}</Pill>
              </div>
            )}
          </Panel>
        </Pop>
      )
    })}
    <div style={{ position: 'absolute', left: TW / 2 - 55, top: yOf(1) - 96, zIndex: 3 }}>
      <Pop f={f} at={intro ? 22 : 4} rot={-6}>
        <Panel bg={C.sun} radius={55} shadow={5} style={{ width: 110, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 50, lineHeight: 1, paddingTop: 6 }}>OU</Panel>
      </Pop>
    </div>
  </>
)

// 1 — Le dilemme
const Intro: MockScene = ({ f }) => (
  <>
    <Dilemma f={f} intro />
    <Sfx name="pop" at={16} volume={0.5} />
    <Sfx name="pop" at={42} volume={0.5} />
  </>
)

// 2 — Mon choix (secret)
const PICK = 44
const Choice: MockScene = ({ f }) => (
  <>
    <Dilemma f={f} pickA={PICK} />
    <div style={{ position: 'absolute', left: 0, right: 0, top: 790, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={PICK + 14} rot={-2}><Pill bg={C.surface} size={36}>🤫 Les autres ne voient rien</Pill></Pop>
    </div>
    <Finger f={f} taps={[{ at: PICK - 8, x: 470, y: yOf(0) + 150 }]} />
    <Sfx name="tap" at={PICK} volume={0.8} />
    <Sfx name="pop" at={PICK + 4} volume={0.5} />
  </>
)

// 3 — Mon pari sur la majorité
const Bet: MockScene = ({ f }) => (
  <>
    <Dilemma f={f} pickA={-99} pickB={PICK} />
    <div style={{ position: 'absolute', left: 0, right: 0, top: 790, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={PICK + 14} rot={2}><Pill bg={C.surface} size={34}>Que vont choisir les autres ?</Pill></Pop>
    </div>
    <Finger f={f} taps={[{ at: PICK - 8, x: 470, y: yOf(1) + 150 }]} />
    <Sfx name="tap" at={PICK} volume={0.8} />
    <Sfx name="pop" at={PICK + 4} volume={0.5} />
  </>
)

// 4 — Résultat : majorité, paris justes, Rebelle
const CAMP_A: Slug[] = ['mika']
const CAMP_B: Slug[] = ['dede', 'kevin', 'cycy', 'manon']
const Result: MockScene = ({ f }) => (
  <>
    {[{ c: A, camp: CAMP_A }, { c: B, camp: CAMP_B }].map(({ c, camp }, k) => {
      const grow = ramp(f, 14, 40)
      return (
        <Pop key={k} f={f} at={k * 4} from={50} style={{ position: 'absolute', left: 40, top: 0 + k * 226 }}>
          <Panel bg={c.bg} radius={34} style={{ width: TW - 80, height: 200, display: 'flex', alignItems: 'center', gap: 16, padding: '0 22px' }}>
            <div style={{ fontSize: 96, lineHeight: 1 }}>{c.emoji}</div>
            <div style={{ flex: 1 }}>
              <div style={{ height: 40, borderRadius: 20, background: C.surface, border: `4px solid ${C.ink}`, boxSizing: 'border-box', overflow: 'hidden' }}>
                <div style={{ width: `${(camp.length / 5) * 100 * grow}%`, height: '100%', background: k ? C.grape : C.tangerine }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                {camp.map((slug, i) => (
                  <Pop key={slug} f={f} at={26 + i * 5 + k * 4}><Avatar slug={slug} expression={k ? 'joie' : 'cool'} size={78} /></Pop>
                ))}
                <div style={{ fontSize: 40, marginLeft: 8, paddingTop: 6 }}>{f >= 40 ? camp.length : ''}</div>
              </div>
            </div>
            {k === 1 && (
              <div style={{ position: 'absolute', right: -8, top: -26, transform: `scale(${sp(f, 50)}) rotate(4deg)` }}>
                <Pill bg={C.sun} size={34}>👑 Majorité</Pill>
              </div>
            )}
          </Panel>
        </Pop>
      )
    })}
    <Pop f={f} at={78} from={40} rot={-1} style={{ position: 'absolute', left: 40, top: 470 }}>
      <Panel bg={C.surface} radius={34} style={{ width: TW - 80, height: 150, display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px' }}>
        <div style={{ flex: 1, fontSize: 40, lineHeight: 1.1 }}>🔮 Pari juste<div style={{ fontSize: 28, color: C.muted }}>tu avais parié 🌭</div></div>
        <div style={{ fontSize: 80, lineHeight: 1, color: C.tangerine, paddingTop: 8 }}>+1</div>
      </Panel>
    </Pop>
    <Pop f={f} at={112} from={40} rot={1} style={{ position: 'absolute', left: 40, top: 650 }}>
      <Panel bg="#d6fbef" radius={34} style={{ width: TW - 80, height: 170, display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px 0 16px' }}>
        <Avatar slug="mika" expression="cool" size={120} />
        <div style={{ flex: 1, fontSize: 40, lineHeight: 1.1 }}>😎 Bonus Rebelle<div style={{ fontSize: 28, color: C.muted }}>seul de son avis</div></div>
        <div style={{ fontSize: 80, lineHeight: 1, color: C.tangerine, paddingTop: 8 }}>+1</div>
      </Panel>
    </Pop>
    <Sfx name="pop" at={58} volume={0.6} />
    <Sfx name="pop" at={86} volume={0.6} />
    <Sfx name="success" at={120} volume={0.5} />
  </>
)

export const tuPreferes: TutoSpec = {
  id: 'tu-preferes',
  name: 'Tu préfères ?',
  emoji: '🤔',
  color: '#C4B5FD',
  players: '2 à 9 joueurs',
  goal: 'Devine ce que préfère la majorité !',
  cast: ['mika', 'dede', 'kevin', 'cycy'],
  steps: [
    { text: 'Un dilemme, deux choix', seconds: 4.4, Mock: Intro },
    { text: 'En secret : ce que TU préfères…', seconds: 4.6, Mock: Choice },
    { text: '…puis ce que choisira la MAJORITÉ', seconds: 4.6, Mock: Bet },
    { text: 'Pari juste : +1 point. Seul de ton avis ? Bonus Rebelle +1 !', seconds: 6.4, Mock: Result },
  ],
  win: {
    text: 'Le plus de points à la fin des dilemmes gagne !',
    sub: 'Égalité parfaite entre les deux choix : personne ne marque.',
    winners: ['mika'],
  },
}

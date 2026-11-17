// Tuto « Devine en équipe » : Rouges (Dédé, Keke) contre Bleus (Cycy, Mika), 3 manches avec les mêmes mots.
import React from 'react'
import { C, type Slug } from '../../theme'
import { Bubble, Chibi, Outlined, Panel, Pill, Pop, Sfx, TW, bob, clamp01, ramp, sp, wiggle } from '../kit'
import { TimerBar } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const RED = '#ef476f'
const BLUE = '#3a86ff'
const RED_BG = '#ffd0da'
const BLUE_BG = '#d6e6ff'

// 1 — Deux équipes, une pioche
const Teams: MockScene = ({ f }) => (
  <>
    {[{ name: 'Rouges', bg: RED_BG, col: RED, team: ['dede', 'kevin'] as Slug[] }, { name: 'Bleus', bg: BLUE_BG, col: BLUE, team: ['cycy', 'mika'] as Slug[] }].map((t, k) => (
      <Pop key={t.name} f={f} at={2 + k * 8} from={60} rot={k ? 2 : -2} style={{ position: 'absolute', left: k ? 376 : 34, top: 20 }}>
        <Panel bg={t.bg} radius={40} style={{ width: 310, height: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 22 }}>
          <Pill bg={t.col} color="#ffffff" size={40}>{t.name}</Pill>
          <div style={{ display: 'flex', marginTop: 20 }}>
            {t.team.map((slug, i) => (
              <div key={slug} style={{ marginLeft: i ? -40 : 0, transform: `translateY(${bob(f, k * 14 + i * 9, 14, 22)}px) rotate(${wiggle(f, i * 9, 3)}deg)` }}>
                <Chibi slug={slug} expression={i ? 'cool' : 'joie'} size={180} />
              </div>
            ))}
          </div>
        </Panel>
      </Pop>
    ))}
    <div style={{ position: 'absolute', left: TW / 2 - 70, top: 150, transform: `scale(${sp(f, 20)}) rotate(-8deg)`, zIndex: 3 }}>
      <Outlined size={110} color={C.sun}>VS</Outlined>
    </div>
    {[2, 1, 0].map((k) => (
      <Pop key={k} f={f} at={40 + (2 - k) * 5} rot={-4 + k * 5} style={{ position: 'absolute', left: 190 + k * 14, top: 480 + k * 12 }}>
        <Panel bg={k ? C.sunk : C.surface} radius={30} shadow={k ? 3 : 8} style={{ width: 320, height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 54, lineHeight: 1.1 }}>
          {!k && <>🃏<div style={{ fontSize: 44 }}>30 mots</div></>}
        </Panel>
      </Pop>
    ))}
    <div style={{ position: 'absolute', left: 0, right: 0, top: 750, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={66} rot={-2}><Pill bg={C.surface} size={36}>Les mêmes mots pendant 3 manches</Pill></Pop>
    </div>
    <Sfx name="whoosh" at={2} volume={0.4} />
    <Sfx name="pop" at={22} volume={0.6} />
    <Sfx name="pop" at={48} volume={0.5} />
  </>
)

type RoundProps = { f: number; dur: number; n: number; title: string; red: boolean; speaker: Slug; mate: Slug; clue: React.ReactNode; mime?: boolean; scores: [number, number] }
const CLUE_AT = 24
const GUESS_AT = 78
const OK_AT = 96
const Round: React.FC<RoundProps> = ({ f, dur, n, title, red, speaker, mate, clue, mime, scores }) => {
  const ok = f >= OK_AT
  const sc: [number, number] = ok ? [scores[0] + (red ? 1 : 0), scores[1] + (red ? 0 : 1)] : scores
  return (
    <>
      <div style={{ position: 'absolute', left: 30, right: 30, top: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Pill bg={red ? RED : BLUE} color="#ffffff" size={34}>Manche {n}/3 · {title}</Pill>
        <div style={{ flex: 1 }} />
        <Pill bg={C.surface} size={34}><span style={{ color: RED }}>{sc[0]}</span> – <span style={{ color: BLUE }}>{sc[1]}</span></Pill>
      </div>
      <div style={{ position: 'absolute', left: 30, top: 84, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 36, lineHeight: 1 }}>⏱️</div>
        <TimerBar p={0.2 + ramp(f, 0, dur) * 0.35} width={TW - 120} height={28} />
      </div>
      {/* L'orateur et sa carte */}
      <div style={{ position: 'absolute', left: 20, top: 180 + (1 - sp(f, 2)) * -60 + bob(f, 0, mime ? 30 : 12, mime ? 10 : 22), transform: `rotate(${wiggle(f, 0, mime ? 14 : 3, mime ? 18 : 36)}deg)`, opacity: clamp01(sp(f, 2) * 3) }}>
        <Chibi slug={speaker} expression={ok ? 'joie' : mime ? 'surprise' : 'clin_oeil'} size={270} />
      </div>
      <Pop f={f} at={6} rot={3} style={{ position: 'absolute', left: 60, top: 440 }}>
        <Panel bg={C.sun} radius={24} shadow={5} style={{ padding: '12px 22px 6px', fontSize: 40, lineHeight: 1 }}>
          PARAPLUIE<div style={{ fontSize: 22, color: C.ink, opacity: 0.7, marginTop: 4 }}>🤫 la carte de l’orateur</div>
        </Panel>
      </Pop>
      <Pop f={f} at={CLUE_AT} rot={-2} style={{ position: 'absolute', left: 290, top: 190 }}>
        {clue}
      </Pop>
      {/* Le coéquipier devine */}
      <div style={{ position: 'absolute', right: 20, top: 560 + (1 - sp(f, 8)) * 300 + bob(f, 9, ok ? 30 : 8, ok ? 12 : 26) }}>
        <Chibi slug={mate} expression={ok ? 'joie' : f >= GUESS_AT ? 'surprise' : 'reflexion'} size={250} />
      </div>
      <Pop f={f} at={GUESS_AT} rot={2} style={{ position: 'absolute', right: 250, top: 600 }}>
        <Bubble tail="right" size={44} bg={ok ? C.mint : C.surface}>Un parapluie !{ok ? ' ✅' : ''}</Bubble>
      </Pop>
      <Pop f={f} at={OK_AT + 2} rot={-8} style={{ position: 'absolute', left: 70, top: 690 }}>
        <Outlined size={100} color={red ? RED : BLUE}>+1</Outlined>
      </Pop>
      <Sfx name="pop" at={CLUE_AT + 8} volume={0.55} />
      <Sfx name="pop" at={GUESS_AT + 8} volume={0.55} />
      <Sfx name="success" at={OK_AT + 2} volume={0.5} />
    </>
  )
}

// 2 — Manche 1 : on décrit
const Describe: MockScene = ({ f, dur }) => (
  <Round f={f} dur={dur} n={1} title="Décris" red speaker="dede" mate="kevin" scores={[2, 1]}
    clue={<Bubble size={38}>Ça s’ouvre quand<br />il pleut…</Bubble>} />
)
// 3 — Manche 2 : un seul mot
const OneWord: MockScene = ({ f, dur }) => (
  <Round f={f} dur={dur} n={2} title="Un seul mot" red={false} speaker="cycy" mate="mika" scores={[9, 8]}
    clue={<Bubble size={62} bg="#d6e6ff">« Pluie »</Bubble>} />
)
// 4 — Manche 3 : on mime
const Mime: MockScene = ({ f, dur }) => (
  <Round f={f} dur={dur} n={3} title="Mime" red speaker="kevin" mate="dede" mime scores={[15, 16]}
    clue={<div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><div style={{ fontSize: 130, lineHeight: 1, transform: `rotate(${wiggle(f, 0, 14, 20)}deg)` }}>☂️</div><Pill bg={C.surface} size={40}>🤐 Chut !</Pill></div>} />
)

export const devineEnEquipe: TutoSpec = {
  id: 'devine-en-equipe',
  name: 'Devine en équipe',
  emoji: '🗣️',
  color: '#FF8FA3',
  players: '4 à 9 joueurs',
  goal: 'Fais deviner un max de mots à ton équipe !',
  cast: ['dede', 'kevin', 'cycy', 'mika'],
  steps: [
    { text: 'Rouges contre Bleus, une pioche de mots', seconds: 4.8, Mock: Teams },
    { text: 'Manche 1 : décris le mot… sans le dire !', seconds: 5.6, Mock: Describe },
    { text: 'Manche 2 : un seul mot d’indice !', seconds: 5.2, Mock: OneWord },
    { text: 'Manche 3 : mime, sans parler', seconds: 5.2, Mock: Mime },
  ],
  win: {
    text: 'L’équipe qui trouve le plus de mots gagne !',
    sub: 'À chaque passage, un orateur fait deviner son équipe contre le chrono. Les adversaires surveillent la triche !',
    winners: ['dede', 'kevin'],
  },
}

// Tuto « Action ou vérité » : la roue désigne Marius, la bande choisit sa carte puis juge.
import React from 'react'
import { C, sticker, type Slug } from '../../theme'
import { Avatar, Chibi, Finger, Outlined, Panel, Pill, Pop, Sfx, TW, bob, bySlug, clamp01, ramp, sp, wiggle } from '../kit'
import { Btn, Fly } from '../parts'
import type { MockScene, TutoSpec } from '../types'

// 1 — La roue
const WHEEL: Slug[] = ['dede', 'cycy', 'kevin', 'marius', 'manon']
const TARGET = 3
const SEG = 360 / WHEEL.length
const R = 250
const SPIN_END = 84
const Wheel: MockScene = ({ f }) => {
  const p = 1 - Math.pow(1 - ramp(f, 8, SPIN_END), 3)
  const rot = p * (360 * 3 - TARGET * SEG)
  const done = f >= SPIN_END
  return (
    <>
      <div style={{ position: 'absolute', left: TW / 2 - R, top: 70, width: R * 2, height: R * 2, transform: `scale(${sp(f, 0)})` }}>
        <div
          style={{
            position: 'absolute', inset: 0, borderRadius: '50%', border: `7px solid ${C.ink}`, boxSizing: 'border-box', boxShadow: sticker(10), transform: `rotate(${rot}deg)`,
            background: `conic-gradient(from ${-SEG / 2}deg, ${WHEEL.map((s, k) => `${bySlug(s).color} ${k * SEG}deg ${(k + 1) * SEG}deg`).join(', ')})`,
          }}
        >
          {WHEEL.map((slug, k) => {
            const a = (k * SEG * Math.PI) / 180
            const hit = done && k === TARGET
            return (
              <div key={slug} style={{ position: 'absolute', left: R - 7 + Math.sin(a) * 150 - 62, top: R - 7 - Math.cos(a) * 150 - 62, transform: `rotate(${-rot}deg) scale(${hit ? 1.25 + 0.06 * Math.sin(f / 4) : 1})`, zIndex: hit ? 2 : 1 }}>
                <Avatar slug={slug} expression={hit ? 'surprise' : 'joie'} size={124} />
              </div>
            )
          })}
        </div>
        <div style={{ position: 'absolute', left: R - 36, top: R - 36, width: 72, height: 72, borderRadius: '50%', background: C.surface, border: `6px solid ${C.ink}`, boxSizing: 'border-box' }} />
        <div style={{ position: 'absolute', left: R - 34, top: -44, width: 0, height: 0, borderLeft: '34px solid transparent', borderRight: '34px solid transparent', borderTop: `70px solid ${C.ink}` }} />
        <div style={{ position: 'absolute', left: R - 22, top: -40, width: 0, height: 0, borderLeft: '22px solid transparent', borderRight: '22px solid transparent', borderTop: `48px solid ${C.tomato}` }} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={SPIN_END + 4} rot={-4}><Outlined size={84} color={C.sun}>C’est pour Marius !</Outlined></Pop>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 790, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={SPIN_END + 18} rot={2}><Pill bg={C.surface} size={32}>Jamais le même deux fois de suite</Pill></Pop>
      </div>
      {Array.from({ length: 10 }, (_, k) => <Sfx key={k} name="type" at={10 + Math.round(k * k * 0.75)} volume={0.8} />)}
      <Sfx name="success" at={SPIN_END + 4} volume={0.5} />
    </>
  )
}

// 2 — Action ou vérité ?
const PICK = 62
const Choose: MockScene = ({ f }) => (
  <>
    <div style={{ position: 'absolute', left: TW / 2 - 140, top: 0 + (1 - sp(f, 0)) * -200 + bob(f, 0, 10, 26), transform: `rotate(${wiggle(f, 0, 3)}deg)` }}>
      <Chibi slug="marius" expression={f >= PICK ? 'cool' : 'reflexion'} size={280} />
    </div>
    <Pop f={f} at={10} rot={-2} style={{ position: 'absolute', left: 50, top: 320 }}>
      <Btn bg={C.tomato} color="#ffffff" size={84} w={TW - 100} h={190} pressed={f >= PICK && f < PICK + 8} style={{ transform: f >= PICK + 8 ? 'scale(1.05)' : undefined, borderRadius: 44 }}>🎬 ACTION</Btn>
    </Pop>
    <Pop f={f} at={16} rot={2} style={{ position: 'absolute', left: 50, top: 550 }}>
      <Btn bg={C.sky} size={84} w={TW - 100} h={190} style={{ opacity: f >= PICK + 8 ? 0.45 : 1, borderRadius: 44 }}>💬 VÉRITÉ</Btn>
    </Pop>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 790, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={26}><Pill bg={C.surface} size={34}>⏱️ 15 s pour te décider !</Pill></Pop>
    </div>
    <Finger f={f} taps={[{ at: PICK - 8, x: 500, y: 430 }]} />
    <Sfx name="tap" at={PICK} volume={0.8} />
    <Sfx name="pop" at={PICK + 8} volume={0.6} />
  </>
)

// 3 — Les autres votent parmi 3 cartes
const CARDS = ['Imite une poule qui pond un œuf', 'Danse la Macarena sans musique', 'Fais 5 pompes en chantant']
const CARD_VOTES: { slug: Slug; to: number; at: number }[] = [
  { slug: 'dede', to: 1, at: 40 }, { slug: 'cycy', to: 0, at: 58 }, { slug: 'kevin', to: 1, at: 76 }, { slug: 'manon', to: 1, at: 94 },
]
const ELECTED = 118
const CardVote: MockScene = ({ f }) => (
  <>
    {CARDS.map((text, k) => {
      const votes = CARD_VOTES.filter((v) => v.to === k && f >= v.at + 12)
      const win = k === 1 && f >= ELECTED
      const lose = k !== 1 && f >= ELECTED
      return (
        <Pop key={k} f={f} at={2 + k * 6} from={50} rot={k % 2 ? 1 : -1} style={{ position: 'absolute', left: 40, top: 0 + k * 196, zIndex: win ? 3 : 1 }}>
          <Panel bg={win ? C.mint : '#ffe0e6'} radius={34} shadow={win ? 11 : 6}
            style={{ width: TW - 80, height: 170, display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', transform: `scale(${win ? 1 + 0.07 * sp(f, ELECTED) : 1})`, opacity: lose ? 0.45 : 1 }}>
            <div style={{ fontSize: 64, lineHeight: 1 }}>🎬</div>
            <div style={{ flex: 1, fontSize: 42, lineHeight: 1.1 }}>{text}</div>
            <div style={{ display: 'flex', width: 120 }}>
              {votes.map((v, i) => <div key={v.slug} style={{ marginLeft: i ? -26 : 0, transform: `scale(${sp(f, v.at + 12)})` }}><Avatar slug={v.slug} size={64} /></div>)}
            </div>
          </Panel>
        </Pop>
      )
    })}
    {CARD_VOTES.map((v, k) => (
      <React.Fragment key={v.slug}>
        <Pop f={f} at={20 + k * 4} style={{ position: 'absolute', left: 50 + k * 165, top: 640 }}>
          <div style={{ transform: `translateY(${bob(f, k * 9, f >= v.at ? 16 : 6, 22)}px)` }}><Chibi slug={v.slug} expression={f >= v.at ? 'clin_oeil' : 'reflexion'} size={150} /></div>
        </Pop>
        <Fly f={f} at={v.at} len={12} from={[125 + k * 165, 640]} to={[590, 85 + v.to * 196]} arc={70} size={54}>🗳️</Fly>
        <Sfx name="pop" at={v.at + 20} volume={0.5} />
      </React.Fragment>
    ))}
    <div style={{ position: 'absolute', left: 0, right: 0, top: 810, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={ELECTED + 6} rot={-2}><Pill bg={C.sun} size={36}>La carte la plus votée est pour Marius !</Pill></Pop>
    </div>
    <Sfx name="success" at={ELECTED + 4} volume={0.5} />
  </>
)

// 4 — Réussi (+1) ou refusé (gage)
const THUMBS: { slug: Slug; up: boolean; at: number }[] = [
  { slug: 'dede', up: true, at: 44 }, { slug: 'cycy', up: true, at: 60 }, { slug: 'kevin', up: false, at: 76 }, { slug: 'manon', up: true, at: 92 },
]
const PLUS = 112
const GAGE = 138
const Judge: MockScene = ({ f }) => {
  const ups = THUMBS.filter((t) => t.up && f >= t.at + 12).length
  const downs = THUMBS.filter((t) => !t.up && f >= t.at + 12).length
  return (
    <>
      <Pop f={f} at={0} from={40} rot={-1} style={{ position: 'absolute', left: 40, top: 0 }}>
        <Panel bg={C.mint} radius={30} shadow={6} style={{ width: TW - 80, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, lineHeight: 1, paddingTop: 6 }}>🎬 Danse la Macarena</Panel>
      </Pop>
      <div style={{ position: 'absolute', left: 30, top: 120 + bob(f, 0, 34, 12), transform: `rotate(${wiggle(f, 0, 12, 24)}deg)` }}>
        <Chibi slug="marius" expression={f >= PLUS ? 'joie' : 'cool'} size={300} />
      </div>
      <div style={{ position: 'absolute', left: 350, top: 150, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Pop f={f} at={30}><Pill bg={C.surface} size={56} style={{ transform: `scale(${1 + 0.1 * clamp01(1 - Math.abs(f - PLUS) / 8)})` }}>👍 {ups}</Pill></Pop>
        <Pop f={f} at={34}><Pill bg={C.surface} size={56}>👎 {downs}</Pill></Pop>
      </div>
      <Pop f={f} at={PLUS} rot={-8} style={{ position: 'absolute', left: 580, top: 190 }}>
        <Outlined size={110} color={C.sun}>+1</Outlined>
      </Pop>
      {THUMBS.map((t, k) => (
        <React.Fragment key={t.slug}>
          <Pop f={f} at={14 + k * 4} style={{ position: 'absolute', left: 46 + k * 165, top: 440 }}>
            <Avatar slug={t.slug} expression={f >= t.at ? (t.up ? 'joie' : 'boude') : 'reflexion'} size={130} />
          </Pop>
          <Fly f={f} at={t.at} len={12} from={[110 + k * 165, 440]} to={[400, t.up ? 190 : 290]} arc={50} size={60}>{t.up ? '👍' : '👎'}</Fly>
          <Sfx name="pop" at={t.at + 20} volume={0.5} />
        </React.Fragment>
      ))}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 590, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={PLUS + 6} rot={-2}><Pill bg={C.sun} size={36}>Majorité de 👍 : c’est réussi !</Pill></Pop>
      </div>
      <Pop f={f} at={GAGE} from={60} rot={1.5} style={{ position: 'absolute', left: 40, top: 680 }}>
        <Panel bg="#ffd0da" radius={34} style={{ width: TW - 80, height: 170, display: 'flex', alignItems: 'center', gap: 18, padding: '0 26px' }}>
          <div style={{ fontSize: 84, lineHeight: 1 }}>🚩</div>
          <div style={{ fontSize: 44, lineHeight: 1.1 }}>Tu refuses la carte ?<div style={{ fontSize: 34, color: C.tomato }}>Un gage tiré au sort, 0 point !</div></div>
        </Panel>
      </Pop>
      <Sfx name="success" at={PLUS + 2} volume={0.55} />
      <Sfx name="whoosh" at={GAGE} volume={0.4} />
    </>
  )
}

export const actionOuVerite: TutoSpec = {
  id: 'action-ou-verite',
  name: 'Action ou vérité',
  emoji: '🎭',
  color: '#FF8FA3',
  players: '3 à 9 joueurs',
  goal: 'Relève le défi… ou gare au gage !',
  cast: ['marius', 'dede', 'cycy', 'kevin'],
  steps: [
    { text: 'La roue désigne un joueur', seconds: 4.8, Mock: Wheel },
    { text: 'Il choisit : ACTION ou VÉRITÉ', seconds: 4.4, Mock: Choose },
    { text: 'Les autres votent en secret parmi 3 cartes', seconds: 5.8, Mock: CardVote },
    { text: 'Réussi ? La bande vote 👍 : +1 point. Refusé : un gage !', seconds: 6.4, Mock: Judge },
  ],
  win: {
    text: 'Le plus de points à la fin des tours gagne !',
    winners: ['marius'],
  },
}

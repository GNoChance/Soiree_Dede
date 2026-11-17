// Tuto « Loup-garou » : 6 joueurs (2 loups : Mika et Manon ; Cycy voyante, Dédé sorcière). Fond nuit pour les étapes 2 et 3.
import React from 'react'
import { random } from 'remotion'
import { C, type Slug } from '../../theme'
import { Avatar, Bubble, Chibi, Outlined, Panel, Pill, Pop, SPRING, Sfx, TH, TW, bob, clamp01, easeInOut, ramp, sp, wiggle } from '../kit'
import { Fly } from '../parts'
import type { MockScene, TutoSpec } from '../types'

/** Ciel de nuit plein cadre, glissé derrière le bandeau de l'étape (z-index négatif dans la scène). */
const STARS = Array.from({ length: 34 }, (_, k) => ({ x: random(`sx${k}`) * TW, y: random(`sy${k}`) * TH, s: 4 + random(`ss${k}`) * 7, p: random(`sp${k}`) * 40 }))
const Night: React.FC<{ f: number; dur: number }> = ({ f, dur }) => (
  <div style={{ position: 'absolute', left: 0, top: -286, width: TW, height: TH, zIndex: -1, background: `linear-gradient(${C.night}, #2a2458)`, opacity: ramp(f, -8, 6) * (1 - ramp(f, dur - 8, dur)) }}>
    {STARS.map((s, k) => (
      <div key={k} style={{ position: 'absolute', left: s.x, top: s.y, width: s.s, height: s.s, borderRadius: '50%', background: '#fff6c9', opacity: 0.35 + 0.5 * Math.abs(Math.sin((f + s.p) / 14)) }} />
    ))}
    <div style={{ position: 'absolute', right: 40, top: 262, width: 120, height: 120, borderRadius: '50%', background: '#fff6c9', boxShadow: '0 0 60px #fff6c988' }} />
    <div style={{ position: 'absolute', right: 20, top: 250, width: 100, height: 100, borderRadius: '50%', background: '#201c45' }} />
  </div>
)

// 1 — Les rôles secrets
const ROLES = [
  { icon: '🧑‍🌾', name: 'Villageois', bg: '#fff1cf' },
  { icon: '🐺', name: 'Loup-garou', bg: '#ffd0da' },
  { icon: '🔮', name: 'Voyante', bg: '#e6dcff' },
  { icon: '🧪', name: 'Sorcière', bg: '#d6fbef' },
]
const Roles: MockScene = ({ f }) => (
  <>
    {ROLES.map((r, k) => {
      const flip = easeInOut(ramp(f, 22 + k * 14, 34 + k * 14))
      const back = flip < 0.5
      return (
        <Pop key={r.name} f={f} at={k * 4} rot={k % 2 ? 2 : -2} style={{ position: 'absolute', left: 44 + (k % 2) * 326, top: 10 + Math.floor(k / 2) * 360 }}>
          <Panel bg={back ? '#5B4B8A' : r.bg} radius={36} style={{ width: 306, height: 330, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, transform: `scaleX(${Math.abs(1 - 2 * flip)})` }}>
            {back ? <div style={{ fontSize: 150, lineHeight: 1, color: '#ffffff' }}>?</div> : (
              <>
                <div style={{ fontSize: 150, lineHeight: 1 }}>{r.icon}</div>
                <div style={{ fontSize: 52, lineHeight: 1, color: k === 1 ? C.tomato : C.ink }}>{r.name}</div>
              </>
            )}
          </Panel>
        </Pop>
      )
    })}
    <div style={{ position: 'absolute', left: 0, right: 0, top: 750, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={86} rot={-2}><Pill bg={C.sun} size={36}>🤫 Ne montre ton écran à personne !</Pill></Pop>
    </div>
    {ROLES.map((_, k) => <Sfx key={k} name="swoosh-up" at={30 + k * 14} volume={0.35} />)}
    <Sfx name="pop" at={94} volume={0.6} />
  </>
)

const VILLAGE: { slug: Slug; name: string; wolf?: boolean }[] = [
  { slug: 'dede', name: 'Dédé' }, { slug: 'mika', name: 'Mika', wolf: true }, { slug: 'cycy', name: 'Cycy' },
  { slug: 'kevin', name: 'Keke' }, { slug: 'manon', name: 'Manon', wolf: true }, { slug: 'marius', name: 'Marius' },
]
const VICTIM = 5
const seat = (k: number) => ({ x: 44 + (k % 3) * 216, y: 96 + Math.floor(k / 3) * 250 })

// 2 — La nuit : les loups choisissent
const WAKE = 56
const BITE = 112
const NightWolves: MockScene = ({ f, dur }) => (
  <>
    <Night f={f} dur={dur} />
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={4} rot={-2}><Pill bg={C.nightSurface} color="#ffffff" size={36}>🌙 Yeux fermés, un doigt sur l’écran</Pill></Pop>
    </div>
    {VILLAGE.map((p, k) => {
      const { x, y } = seat(k)
      const awake = p.wolf && f >= WAKE
      const hit = k === VICTIM && f >= BITE
      return (
        <Pop key={p.slug} f={f} at={k * 3} style={{ position: 'absolute', left: x, top: y }}>
          <div style={{ width: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${bob(f, k * 9, awake ? 14 : 4, awake ? 16 : 40)}px) scale(${awake ? 1.08 : 1})` }}>
            <div style={{ filter: awake ? 'none' : 'brightness(0.75)' }}><Chibi slug={p.slug} expression={awake ? 'clin_oeil' : 'dodo'} size={190} /></div>
            {awake && <div style={{ position: 'absolute', right: -4, top: -20, fontSize: 70, lineHeight: 1, transform: `scale(${sp(f, WAKE + (k > 2 ? 6 : 0))}) rotate(12deg)` }}>🐺</div>}
            {hit && <div style={{ position: 'absolute', left: 30, top: 24, width: 140, height: 140, borderRadius: '50%', border: `10px solid ${C.tomato}`, boxSizing: 'border-box', transform: `scale(${sp(f, BITE, SPRING.pop)})` }} />}
          </div>
        </Pop>
      )
    })}
    {[1, 4].map((k, i) => <Fly key={k} f={f} at={BITE - 22 + i * 8} len={14} from={[seat(k).x + 100, seat(k).y + 80]} to={[seat(VICTIM).x + 100, seat(VICTIM).y + 90]} arc={70} size={60}>🐾</Fly>)}
    <div style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={WAKE + 8} rot={-3}><Outlined size={62} color={C.tomato} style={{ whiteSpace: 'nowrap' }}>Les loups se réveillent…</Outlined></Pop>
    </div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 760, display: 'flex', justifyContent: 'center' }}>
      <Pop f={f} at={BITE + 6} rot={2}><Pill bg={C.tomato} color="#ffffff" size={36}>…et choisissent leur victime en secret</Pill></Pop>
    </div>
    <Sfx name="whoosh" at={WAKE} volume={0.4} />
    <Sfx name="pop" at={BITE} volume={0.7} />
  </>
)

// 3 — Les rôles spéciaux
const SPECIALS = [
  { icon: '🔮', name: 'La Voyante', text: 'découvre le rôle d’un joueur', slug: 'cycy' as Slug },
  { icon: '🧪', name: 'La Sorcière', text: 'peut sauver… ou éliminer', slug: 'dede' as Slug },
]
const NightSpecials: MockScene = ({ f, dur }) => {
  const flip = easeInOut(ramp(f, 46, 60))
  return (
    <>
      <Night f={f} dur={dur} />
      {SPECIALS.map((s, k) => (
        <Pop key={s.name} f={f} at={6 + k * 56} from={60} rot={k ? 1 : -1} style={{ position: 'absolute', left: 36, top: 10 + k * 270 }}>
          <Panel bg={C.nightSurface} radius={38} style={{ width: TW - 72, height: 236, display: 'flex', alignItems: 'center', gap: 16, padding: '0 22px', color: '#ffffff', borderColor: '#0b0920' }}>
            <div style={{ position: 'relative' }}>
              <Avatar slug={s.slug} expression="clin_oeil" size={150} />
              <div style={{ position: 'absolute', right: -16, bottom: -14, fontSize: 70, lineHeight: 1 }}>{s.icon}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 50, lineHeight: 1.05, color: C.sun }}>{s.name}</div>
              <div style={{ fontSize: 36, lineHeight: 1.15 }}>{s.text}</div>
            </div>
            {k === 0 && (
              <Panel bg={flip < 0.5 ? '#5B4B8A' : '#ffd0da'} radius={22} shadow={4} style={{ width: 120, height: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 64, lineHeight: 1, transform: `scaleX(${Math.abs(1 - 2 * flip)})`, color: flip < 0.5 ? '#ffffff' : C.ink }}>
                {flip < 0.5 ? '?' : <>🐺<div style={{ fontSize: 26, marginTop: 6 }}>Mika</div></>}
              </Panel>
            )}
            {k === 1 && <div style={{ fontSize: 70, lineHeight: 1, transform: `rotate(${wiggle(f, 0, 12, 20)}deg)` }}>⚗️</div>}
          </Panel>
        </Pop>
      ))}
      <Pop f={f} at={118} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 570, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.nightSurface} color="#ffffff" size={30}>💘 Cupidon · 🏹 Chasseur · 🛡️ Protecteur…</Pill>
      </Pop>
      <Pop f={f} at={126} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 680, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.sun} size={36}>📱 Chacun agit sur son téléphone</Pill>
      </Pop>
      <Sfx name="swoosh-up" at={50} volume={0.4} />
      <Sfx name="pop" at={70} volume={0.6} />
      <Sfx name="pop" at={126} volume={0.5} />
    </>
  )
}

// 4 — Le jour : débat puis vote
const ALIVE = VILLAGE.slice(0, 5)
const VOTES: { from: number; at: number }[] = [{ from: 0, at: 96 }, { from: 2, at: 110 }, { from: 3, at: 124 }]
const OUT = 146
const Day: MockScene = ({ f }) => {
  const n = VOTES.filter((v) => f >= v.at + 12).length
  const out = f >= OUT
  return (
    <>
      <div style={{ position: 'absolute', right: 30, top: -10, fontSize: 110, lineHeight: 1, transform: `scale(${sp(f, 0)}) rotate(${f}deg)` }}>☀️</div>
      <Pop f={f} at={6} rot={-2} style={{ position: 'absolute', left: 30, top: 10 }}>
        <Pill bg={C.surface} size={34}>Au matin : Marius a été dévoré 😱</Pill>
      </Pop>
      {ALIVE.map((p, k) => {
        const x = 20 + k * 138
        const target = k === 1
        return (
          <Pop key={p.slug} f={f} at={10 + k * 3} style={{ position: 'absolute', left: x, top: 330 + (k % 2) * 30 }}>
            <div style={{ width: 130, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${target ? 1 + 0.1 * clamp01(n / 3) : 1})`, opacity: target && out ? 0.5 : 1 }}>
              <Chibi slug={p.slug} expression={target ? (n ? 'surprise' : 'clin_oeil') : f >= 96 ? 'colere' : 'reflexion'} size={150} />
              {target && n > 0 && <Pill bg={C.tomato} color="#ffffff" size={30}>{n} 🗳️</Pill>}
            </div>
          </Pop>
        )
      })}
      <Pop f={f} at={30} rot={-2} style={{ position: 'absolute', left: 30, top: 120 }}><Bubble size={38}>C’est Mika, j’en suis sûre !</Bubble></Pop>
      <Pop f={f} at={58} rot={2} style={{ position: 'absolute', left: 190, top: 220 }}><Bubble size={38} bg="#ffd0da">Moi ? Jamais de la vie !</Bubble></Pop>
      {VOTES.map((v, i) => <Fly key={i} f={f} at={v.at} len={12} from={[20 + v.from * 138 + 65, 380]} to={[20 + 138 + 65, 400]} arc={90} size={54}>👉</Fly>)}
      {out && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 600, display: 'flex', justifyContent: 'center', transform: `scale(${3 - 2 * Math.min(1, sp(f, OUT, SPRING.pop))}) rotate(-6deg)`, opacity: clamp01(sp(f, OUT) * 2) }}>
          <Pill bg={C.tomato} color="#ffffff" size={42} style={{ borderWidth: 6 }}>Mika éliminé : c’était un 🐺 !</Pill>
        </div>
      )}
      <Pop f={f} at={OUT + 16} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 740, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.nightSurface} color="#ffffff" size={36}>🌙 Puis la nuit retombe…</Pill>
      </Pop>
      <Sfx name="pop" at={38} volume={0.55} />
      <Sfx name="pop" at={66} volume={0.55} />
      {VOTES.map((v, i) => <Sfx key={i} name="pop" at={v.at + 20} volume={0.5} />)}
      <Sfx name="success" at={OUT + 4} volume={0.5} />
    </>
  )
}

export const loupGarou: TutoSpec = {
  id: 'loup-garou',
  name: 'Loup-garou',
  emoji: '🐺',
  color: '#5B4B8A',
  players: '5 à 9 joueurs',
  goal: 'Village contre loups : qui ment autour de la table ?',
  cast: ['dede', 'mika', 'cycy', 'kevin'],
  steps: [
    { text: 'Chacun reçoit un rôle secret sur son téléphone', seconds: 4.8, Mock: Roles },
    { text: 'La nuit, tout le monde ferme les yeux… sauf les loups !', seconds: 6, Mock: NightWolves },
    { text: 'Les rôles spéciaux agissent en douce', seconds: 5.6, Mock: NightSpecials },
    { text: 'Le jour : débattez, puis votez pour éliminer un suspect', seconds: 6.2, Mock: Day },
  ],
  win: {
    text: 'Le village gagne s’il élimine tous les loups.',
    sub: 'Les loups gagnent s’ils deviennent aussi nombreux que les autres joueurs !',
    winners: ['dede', 'cycy', 'kevin'],
  },
}

// Tuto « Bombe à mots » : syllabe imposée, mèche cachée, 3 vies, alphabet bonus (21 lettres : a–v sans k).
import React from 'react'
import { random } from 'remotion'
import { C, sticker, type Slug } from '../../theme'
import { Chibi, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, bob, clamp01, easeInOut, lerp, ramp, sp } from '../kit'
import type { MockScene, TutoSpec } from '../types'

const Bomb: React.FC<{ f: number; size: number; shake?: number }> = ({ f, size, shake = 0 }) => (
  <div style={{ position: 'relative', width: size, height: size, transform: `translate(${Math.sin(f * 2.1) * shake}px, ${Math.cos(f * 2.7) * shake}px) rotate(${Math.sin(f / 3) * (4 + shake)}deg)` }}>
    <div style={{ fontSize: size * 0.86, lineHeight: 1, textAlign: 'center' }}>💣</div>
    <div style={{ position: 'absolute', right: size * 0.02, top: -size * 0.1, fontSize: size * 0.3, lineHeight: 1, transform: `scale(${0.8 + 0.4 * Math.abs(Math.sin(f / 2))})` }}>✨</div>
  </div>
)
const Hearts: React.FC<{ n: number; max?: number; size?: number }> = ({ n, max = 3, size = 34 }) => (
  <div style={{ display: 'flex', gap: 2, fontSize: size, lineHeight: 1 }}>
    {Array.from({ length: max }, (_, k) => <span key={k} style={{ opacity: k < n ? 1 : 0.25, filter: k < n ? 'none' : 'grayscale(1)' }}>❤️</span>)}
  </div>
)

// 1 — La bombe tourne
const TABLE: Slug[] = ['dede', 'kevin', 'cycy', 'mika', 'manon']
const seat = (k: number) => {
  const a = (k / TABLE.length) * Math.PI * 2 - Math.PI / 2
  return { x: TW / 2 + Math.cos(a) * 250, y: 400 + Math.sin(a) * 300 }
}
const HOP = 26
const Circle: MockScene = ({ f }) => {
  const t = Math.max(0, f - 16)
  const k = Math.floor(t / HOP)
  const p = easeInOut(clamp01(((t % HOP) - 14) / 12))
  const a = seat(k % TABLE.length)
  const b = seat((k + 1) % TABLE.length)
  return (
    <>
      {TABLE.map((slug, i) => {
        const s = seat(i)
        const has = k % TABLE.length === i && p < 0.5
        return (
          <Pop key={slug} f={f} at={i * 3} style={{ position: 'absolute', left: s.x - 95, top: s.y - 105 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${bob(f, i * 9, has ? 18 : 6, has ? 10 : 28)}px)` }}>
              <Chibi slug={slug} expression={has ? 'surprise' : 'joie'} size={190} />
              <Hearts n={3} />
            </div>
          </Pop>
        )
      })}
      <div style={{ position: 'absolute', left: lerp(a.x, b.x, p) - 60, top: lerp(a.y, b.y, p) - 70 - Math.sin(p * Math.PI) * 60, zIndex: 5, transform: `scale(${sp(f, 10)})` }}>
        <Bomb f={f} size={120} />
      </div>
      <div style={{ position: 'absolute', left: TW / 2 - 90, top: 340 }}>
        <Pop f={f} at={8} rot={-4}>
          <Panel bg={C.sun} radius={30} shadow={7} style={{ width: 180, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 76, lineHeight: 1, paddingTop: 8 }}>TRA</Panel>
        </Pop>
      </div>
      {Array.from({ length: 5 }, (_, i) => <Sfx key={i} name="swoosh-up" at={16 + 14 + i * HOP} volume={0.35} />)}
    </>
  )
}

// 2 — Un mot qui contient la syllabe
const WORD = 'TRACTEUR'
const T0 = 36
const SENT = T0 + WORD.length * 5 + 10
const Typing: MockScene = ({ f }) => {
  const n = Math.max(0, Math.min(WORD.length, Math.floor((f - T0) / 5) + 1))
  const ok = f >= SENT
  const fly = easeInOut(ramp(f, SENT + 14, SENT + 30))
  return (
    <>
      <Pop f={f} at={0} rot={-3} style={{ position: 'absolute', left: (TW - 330) / 2, top: 0 }}>
        <Panel bg={C.sun} radius={48} shadow={11} style={{ width: 330, height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 28, lineHeight: 1, color: C.ink, opacity: 0.7 }}>la syllabe</div>
          <div style={{ fontSize: 140, lineHeight: 1, paddingTop: 6 }}>TRA</div>
        </Panel>
      </Pop>
      <div style={{ position: 'absolute', left: 40 + fly * 620, top: 250 - Math.sin(fly * Math.PI) * 80, opacity: 1 - ramp(f, SENT + 26, SENT + 32) }}>
        <Bomb f={f} size={150} shake={ok ? 0 : 2} />
      </div>
      <Pop f={f} at={10} style={{ position: 'absolute', left: 40, top: 420 }}>
        <Panel bg={ok ? C.mint : C.surface} radius={34} shadow={8} style={{ width: TW - 80, height: 150, display: 'flex', alignItems: 'center', padding: '10px 30px 0', fontSize: 84, lineHeight: 1, letterSpacing: 2 }}>
          <div style={{ flex: 1 }}>
            {f >= T0 && <><span style={{ color: C.tomato }}>{WORD.slice(0, Math.min(3, n))}</span>{WORD.slice(3, n)}</>}
            {!ok && Math.floor(f / 8) % 2 === 0 ? <span style={{ color: C.grape }}>|</span> : null}
          </div>
          {ok && <div style={{ fontSize: 70 }}>✅</div>}
        </Panel>
      </Pop>
      <div style={{ position: 'absolute', left: 40, top: 620 + (1 - sp(f, 14)) * 300 + bob(f, 0, ok ? 26 : 8, ok ? 14 : 24) }}>
        <Chibi slug="kevin" expression={ok ? 'joie' : 'gamer'} size={230} />
      </div>
      <Pop f={f} at={SENT + 8} rot={2} style={{ position: 'absolute', left: 290, top: 660 }}>
        <Pill bg={C.surface} size={38}>💣 La bombe passe<br />au suivant !</Pill>
      </Pop>
      {[...WORD].map((_, k) => <Sfx key={k} name="type" at={T0 + k * 5} volume={0.85} />)}
      <Sfx name="success" at={SENT} volume={0.5} />
      <Sfx name="swoosh-up" at={SENT + 14} volume={0.45} />
    </>
  )
}

// 3 — BOUM : une vie en moins
const BOOM = 92
const Explosion: MockScene = ({ f }) => {
  const boom = f >= BOOM
  const b = sp(f, BOOM, SPRING.pop)
  return (
    <>
      <div style={{ position: 'absolute', left: 60, top: 300 + bob(f, 0, 6, 20) }}>
        <Chibi slug="mika" expression={boom ? 'pleurs' : f > 40 ? 'surprise' : 'reflexion'} size={300} />
      </div>
      <Pop f={f} at={6} style={{ position: 'absolute', left: 70, top: 620 }}>
        <Panel bg={boom ? '#ffd0da' : C.surface} radius={30} shadow={6} style={{ width: 280, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 40 }}>
          <div style={{ paddingTop: 6 }}>Mika</div><Hearts n={boom ? 1 : 2} size={40} />
        </Panel>
      </Pop>
      {!boom && (
        <div style={{ position: 'absolute', left: 380, top: 60, transform: `scale(${sp(f, 0) * (1 + ramp(f, 30, BOOM) * 0.25)})` }}>
          <Bomb f={f} size={280} shake={ramp(f, 10, BOOM) * 10} />
        </div>
      )}
      {!boom && [0, 1, 2].map((k) => (
        <div key={k} style={{ position: 'absolute', left: 360 + k * 80 + Math.sin((f + k * 9) / 4) * 8, top: 370 + k * 14, fontSize: 56, opacity: ramp(f, 30 + k * 14, 44 + k * 14), lineHeight: 1 }}>💦</div>
      ))}
      <Pop f={f} at={22} rot={-3} style={{ position: 'absolute', left: 40, top: 20 }}>
        <Panel radius={28} shadow={6} style={{ padding: '14px 24px 8px', fontSize: 56, lineHeight: 1, color: C.muted }}>tr{f > 50 ? 'o' : ''}{f > 66 ? 'u' : ''}…</Panel>
      </Pop>
      <Pop f={f} at={30} rot={3} style={{ position: 'absolute', left: 40, top: 150 }}>
        <Pill bg={C.surface} size={32}>⏳ Mèche cachée…</Pill>
      </Pop>
      {boom && (
        <>
          <div style={{ position: 'absolute', left: 300, top: 0, width: 420, height: 420, transform: `scale(${b * 1.1}) rotate(${f * 2}deg)`, opacity: 1 - ramp(f, BOOM + 30, BOOM + 44) * 0.4 }}>
            {Array.from({ length: 12 }, (_, k) => (
              <div key={k} style={{ position: 'absolute', left: 190, top: 0, width: 40, height: 210, transformOrigin: '50% 100%', transform: `rotate(${k * 30}deg) scaleY(${0.7 + random(`bm${k}`) * 0.4})`, background: k % 2 ? C.sun : C.tangerine, border: `4px solid ${C.ink}`, boxSizing: 'border-box', borderRadius: '50% 50% 0 0' }} />
            ))}
          </div>
          <div style={{ position: 'absolute', left: 310, top: 130, transform: `scale(${b}) rotate(-10deg)` }}>
            <Outlined size={150} color={C.tomato}>BOUM !</Outlined>
          </div>
          <Pop f={f} at={BOOM + 14} rot={4} style={{ position: 'absolute', left: 380, top: 640 }}>
            <Outlined size={84} color={C.sun}>−1 vie</Outlined>
          </Pop>
        </>
      )}
      {Array.from({ length: 12 }, (_, k) => <Sfx key={k} name="type" at={Math.round(BOOM - 88 * Math.pow(0.82, k))} volume={0.7} />)}
      <Sfx name="whoosh" at={BOOM - 2} volume={0.9} />
      <Sfx name="pop" at={BOOM} volume={1} />
    </>
  )
}

// 4 — L'alphabet bonus
const ALPHA = 'ABCDEFGHIJLMNOPQRSTUV'.split('')
const DONE_BEFORE = 'TRACEUOIFSLMNPDGBJHQ' // tout sauf V
const LAST_AT = 62
const LIFE_AT = 86
const Alphabet: MockScene = ({ f }) => (
  <>
    <Pop f={f} at={0} from={40} style={{ position: 'absolute', left: 40, top: 0 }}>
      <Panel radius={36} shadow={8} style={{ width: TW - 80, height: 430, padding: '22px 22px 0' }}>
        <div style={{ fontSize: 34, lineHeight: 1, color: C.muted, marginBottom: 14 }}>🔤 Mon alphabet bonus</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {ALPHA.map((l, k) => {
            const pre = DONE_BEFORE.includes(l)
            const on = pre ? f >= 8 + k : f >= LAST_AT
            const pulse = !pre && f >= LAST_AT ? sp(f, LAST_AT, SPRING.pop) : 1
            return (
              <div key={l} style={{ width: 72, height: 96, borderRadius: 18, boxSizing: 'border-box', border: `4px solid ${C.ink}`, background: on ? C.mint : C.surface, boxShadow: sticker(3), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 54, lineHeight: 1, paddingTop: 6, color: on ? C.ink : C.muted, transform: `scale(${!pre && f < LAST_AT ? 1 + 0.08 * Math.sin(f / 3) : pulse})` }}>
                {l}
              </div>
            )
          })}
        </div>
      </Panel>
    </Pop>
    <Pop f={f} at={30} rot={-2} style={{ position: 'absolute', left: 60, top: 460 }}>
      <Panel bg={f >= LAST_AT ? C.mint : C.surface} radius={28} shadow={6} style={{ padding: '14px 26px 6px', fontSize: 60, lineHeight: 1, letterSpacing: 2 }}>
        TRA<span style={{ color: C.tomato }}>V</span>AIL{f >= LAST_AT ? ' ✅' : ''}
      </Panel>
    </Pop>
    <div style={{ position: 'absolute', left: 40, top: 600 + bob(f, 0, f >= LIFE_AT ? 28 : 8, f >= LIFE_AT ? 14 : 26) }}>
      <Chibi slug="cycy" expression={f >= LIFE_AT ? 'joie' : 'gamer'} size={240} />
    </div>
    <Pop f={f} at={LIFE_AT} rot={-6} style={{ position: 'absolute', left: 300, top: 600 }}>
      <Outlined size={120} color={C.tomato}>+1 ❤️</Outlined>
    </Pop>
    <Pop f={f} at={LIFE_AT + 12} rot={2} style={{ position: 'absolute', left: 300, top: 760 }}>
      <Pill bg={C.surface} size={36}>Alphabet complet !</Pill>
    </Pop>
    <Sfx name="tap" at={LAST_AT} volume={0.9} />
    <Sfx name="success" at={LIFE_AT} volume={0.6} />
  </>
)

export const bombeAMots: TutoSpec = {
  id: 'bombe-a-mots',
  name: 'Bombe à mots',
  emoji: '💣',
  color: '#EF476F',
  players: '2 à 9 joueurs',
  goal: 'Trouve un mot avant que ça fasse BOUM !',
  cast: ['kevin', 'cycy', 'mika', 'dede'],
  steps: [
    { text: 'La bombe tourne autour de la table', seconds: 4.6, Mock: Circle },
    { text: 'À ton tour : tape un mot qui contient la syllabe', seconds: 5.6, Mock: Typing },
    { text: 'Personne ne sait quand elle explose…', seconds: 5.2, Mock: Explosion },
    { text: 'Utilise toutes les lettres de ton alphabet bonus : +1 vie', seconds: 5.4, Mock: Alphabet },
  ],
  win: {
    text: 'Plus de vie ? Tu es éliminé. Le dernier debout gagne !',
    winners: ['cycy'],
  },
}

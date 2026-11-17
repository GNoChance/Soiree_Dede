// Tuto « Pas de bol ! » : jeu de défausse (même couleur ou même symbole, +2 / +4 cumulables, « Dernière carte ! »).
import React from 'react'
import { C, sticker, type Slug } from '../../theme'
import { Avatar, Bubble, Chibi, Finger, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, bob, clamp01, easeInOut, lerp, ramp, sp } from '../kit'
import { Btn } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const COLORS = { tomate: '#EF476F', soleil: '#FFB703', menthe: '#06D6A0', ciel: '#4CC9F0', noir: '#1f1b2e' } as const
type CardDef = { color: keyof typeof COLORS; v: string }
const CW = 150
const CH = 220

const Card: React.FC<{ c: CardDef; w?: number; dim?: boolean; glow?: boolean }> = ({ c, w = CW, dim, glow }) => {
  const h = (w * CH) / CW
  const light = c.color === 'tomate' || c.color === 'noir'
  return (
    <div
      style={{
        position: 'relative', width: w, height: h, borderRadius: w * 0.16, boxSizing: 'border-box', background: COLORS[c.color], border: `5px solid ${C.ink}`,
        boxShadow: glow ? `0 0 0 6px ${C.surface}, ${sticker(6)}` : sticker(5), opacity: dim ? 0.45 : 1, fontFamily: 'inherit', color: light ? '#ffffff' : C.ink,
      }}
    >
      <div style={{ position: 'absolute', inset: w * 0.1, borderRadius: '50%', background: c.color === 'noir' ? `conic-gradient(${COLORS.tomate} 0 25%, ${COLORS.soleil} 0 50%, ${COLORS.menthe} 0 75%, ${COLORS.ciel} 0)` : '#ffffff55', transform: 'rotate(-20deg) scaleX(0.82)' }} />
      <Panel bg="transparent" shadow={0} style={{ position: 'absolute', inset: 0, border: 'none', boxShadow: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: w * (c.v.length > 1 ? 0.5 : 0.66), lineHeight: 1, paddingTop: w * 0.06, color: light ? '#ffffff' : C.ink, WebkitTextStroke: c.color === 'noir' ? `3px ${C.ink}` : undefined, paintOrder: 'stroke fill' }}>
        {c.v}
      </Panel>
    </div>
  )
}
const Back: React.FC<{ w?: number }> = ({ w = CW }) => (
  <div style={{ width: w, height: (w * CH) / CW, borderRadius: w * 0.16, boxSizing: 'border-box', background: C.grape, border: `5px solid ${C.ink}`, boxShadow: sticker(5), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: w * 0.5 }}>🃏</div>
)

const PILE = { x: 390, y: 60 }
const DECK = { x: 180, y: 60 }
const handPos = (k: number, n: number, y = 560) => {
  const mid = (n - 1) / 2
  const step = Math.min(128, 560 / n)
  return { x: TW / 2 - CW / 2 + (k - mid) * step, y: y + Math.pow(Math.abs(k - mid), 2) * 9, r: (k - mid) * 7 }
}
const Table: React.FC<{ f: number; top: CardDef; deck?: boolean }> = ({ f, top, deck = true }) => (
  <>
    {deck && <Pop f={f} at={0} rot={-4} style={{ position: 'absolute', left: DECK.x, top: DECK.y }}><Back /></Pop>}
    <Pop f={f} at={3} rot={5} style={{ position: 'absolute', left: PILE.x, top: PILE.y }}><Card c={top} /></Pop>
  </>
)

// 1 — Même couleur ou même symbole
const HAND1: CardDef[] = [{ color: 'tomate', v: '7' }, { color: 'menthe', v: '9' }, { color: 'soleil', v: '2' }, { color: 'ciel', v: '5' }, { color: 'tomate', v: '3' }]
const PLAY_AT = 92
const Matching: MockScene = ({ f }) => {
  const p = easeInOut(ramp(f, PLAY_AT, PLAY_AT + 14))
  return (
    <>
      <Table f={f} top={{ color: 'menthe', v: '5' }} />
      {HAND1.map((c, k) => {
        const h = handPos(k, HAND1.length)
        const ok = k === 1 || k === 3
        const lift = ok ? sp(f, 30 + k * 6) * 46 : 0
        const fly = k === 1 ? p : 0
        return (
          <Pop key={k} f={f} at={6 + k * 3} from={120} style={{ position: 'absolute', left: lerp(h.x, PILE.x, fly), top: lerp(h.y - lift, PILE.y, fly), zIndex: k === 1 && fly > 0 ? 9 : k }}>
            <div style={{ transform: `rotate(${lerp(h.r, 5, fly)}deg)` }}>
              <Card c={c} dim={!ok && f >= 30} glow={ok && f >= 30 && fly < 1} />
            </div>
          </Pop>
        )
      })}
      <Pop f={f} at={40} rot={-4} style={{ position: 'absolute', left: 60, top: 400 }}><Pill bg={C.mint} size={34}>même couleur ✅</Pill></Pop>
      <Pop f={f} at={56} rot={4} style={{ position: 'absolute', left: 390, top: 420 }}><Pill bg={C.sky} size={34}>même chiffre ✅</Pill></Pop>
      <Finger f={f} taps={[{ at: PLAY_AT - 8, x: handPos(1, 5).x + 75, y: 600 }]} />
      <Sfx name="pop" at={48} volume={0.5} />
      <Sfx name="pop" at={64} volume={0.5} />
      <Sfx name="tap" at={PLAY_AT} volume={0.8} />
      <Sfx name="swoosh-up" at={PLAY_AT + 2} volume={0.45} />
    </>
  )
}

// 2 — Rien à poser : on pioche
const HAND2: CardDef[] = [{ color: 'ciel', v: '7' }, { color: 'menthe', v: '1' }, { color: 'soleil', v: '8' }]
const DRAW_AT = 64
const Drawing: MockScene = ({ f }) => {
  const p = easeInOut(ramp(f, DRAW_AT, DRAW_AT + 16))
  const n = f >= DRAW_AT + 16 ? 4 : 3
  const dst = handPos(3, 4)
  return (
    <>
      <Table f={f} top={{ color: 'tomate', v: '3' }} />
      {HAND2.map((c, k) => {
        const h = handPos(k, n)
        return (
          <Pop key={k} f={f} at={6 + k * 3} from={120} style={{ position: 'absolute', left: h.x, top: h.y, zIndex: k }}>
            <div style={{ transform: `rotate(${h.r}deg)` }}><Card c={c} dim={f >= 24 && f < DRAW_AT} /></div>
          </Pop>
        )
      })}
      {f >= DRAW_AT && (
        <div style={{ position: 'absolute', left: lerp(DECK.x, dst.x, p), top: lerp(DECK.y, dst.y, p) - Math.sin(p * Math.PI) * 60, transform: `rotate(${lerp(-4, dst.r, p)}deg)`, zIndex: 8 }}>
          {p < 0.6 ? <Back /> : <Card c={{ color: 'ciel', v: '4' }} />}
        </div>
      )}
      <Pop f={f} at={26} rot={-3} style={{ position: 'absolute', left: 0, right: 0, top: 380, display: 'flex', justifyContent: 'center' }}>
        <Outlined size={72} color={C.tomato}>Aucune ne va…</Outlined>
      </Pop>
      <Pop f={f} at={DRAW_AT + 20} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 480, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.surface} size={36}>+1 carte dans ta main</Pill>
      </Pop>
      <Finger f={f} taps={[{ at: DRAW_AT - 8, x: DECK.x + 80, y: DECK.y + 120 }]} />
      <Sfx name="tap" at={DRAW_AT} volume={0.8} />
      <Sfx name="swoosh-up" at={DRAW_AT + 4} volume={0.45} />
    </>
  )
}

// 3 — Les +2 et +4 se cumulent
const CHAIN: { slug: Slug; c: CardDef; at: number; total: number }[] = [
  { slug: 'dede', c: { color: 'tomate', v: '+2' }, at: 22, total: 2 },
  { slug: 'kevin', c: { color: 'ciel', v: '+2' }, at: 54, total: 4 },
  { slug: 'cycy', c: { color: 'noir', v: '+4' }, at: 86, total: 8 },
]
const OUCH = 122
const Stacking: MockScene = ({ f }) => {
  const total = CHAIN.reduce((n, c) => (f >= c.at + 12 ? c.total : n), 0)
  const last = CHAIN.reduce((n, c) => (f >= c.at + 12 ? c.at + 12 : n), 0)
  return (
    <>
      {CHAIN.map((c, k) => {
        const p = easeInOut(ramp(f, c.at, c.at + 12))
        const sx = 60 + k * 170
        return (
          <React.Fragment key={c.slug}>
            <Pop f={f} at={k * 4} style={{ position: 'absolute', left: sx, top: 0 }}>
              <Avatar slug={c.slug} expression={f >= c.at ? 'clin_oeil' : 'reflexion'} size={130} />
            </Pop>
            {f >= c.at && (
              <div style={{ position: 'absolute', left: lerp(sx, 50 + k * 118, p), top: lerp(20, 220 + k * 14, p), transform: `rotate(${lerp(0, -8 + k * 8, p)}deg) scale(${lerp(0.5, 1.05, p)})`, zIndex: 2 + k }}>
                <Card c={c.c} />
              </div>
            )}
            <Sfx name="swoosh-up" at={c.at} volume={0.4} />
            <Sfx name="pop" at={c.at + 12} volume={0.6} />
          </React.Fragment>
        )
      })}
      <Pop f={f} at={12} style={{ position: 'absolute', left: 570, top: 0 }}>
        <Avatar slug="mika" expression={f >= OUCH ? 'pleurs' : f >= 60 ? 'surprise' : 'joie'} size={130} />
      </Pop>
      {total > 0 && (
        <div style={{ position: 'absolute', left: 476, top: 250, transform: `scale(${1 + 0.3 * clamp01(1 - (f - last) / 8)}) rotate(-6deg)` }}>
          <Outlined size={150} color={total >= 8 ? C.tomato : C.sun}>+{total}</Outlined>
        </div>
      )}
      <div style={{ position: 'absolute', left: 250, top: 560 + (1 - sp(f, OUCH - 8)) * 400 + bob(f, 0, 8, 30) }}>
        <Chibi slug="mika" expression="pleurs" size={230} />
      </div>
      <Pop f={f} at={OUCH} rot={-3} style={{ position: 'absolute', left: 0, right: 0, top: 500, display: 'flex', justifyContent: 'center' }}>
        <Pill bg={C.tomato} color="#ffffff" size={40}>Mika pioche 8 cartes !</Pill>
      </Pop>
      <Pop f={f} at={OUCH + 14} rot={2} style={{ position: 'absolute', left: 20, top: 760 }}>
        <Pill bg={C.surface} size={28}>+2 sur +2<br />+4 sur tout</Pill>
      </Pop>
      <Sfx name="whoosh" at={OUCH} volume={0.5} />
    </>
  )
}

// 4 — « Dernière carte ! »
const SHOUT = 58
const LATE = 104
const LastCard: MockScene = ({ f }) => (
  <>
    <div style={{ position: 'absolute', left: 60, top: 10, transform: `rotate(-6deg) scale(${sp(f, 2)})` }}>
      <Card c={{ color: 'soleil', v: '6' }} w={170} />
    </div>
    <div style={{ position: 'absolute', left: 250, top: 20 + bob(f, 0, f >= SHOUT ? 24 : 8, f >= SHOUT ? 14 : 28) }}>
      <Chibi slug="cycy" expression={f >= SHOUT ? 'joie' : 'reflexion'} size={240} />
    </div>
    <Pop f={f} at={SHOUT + 6} rot={4} style={{ position: 'absolute', left: 420, top: 0 }}>
      <Bubble size={36} bg={C.sun}>Dernière<br />carte !</Bubble>
    </Pop>
    <Pop f={f} at={10} cfg={SPRING.bouncy} style={{ position: 'absolute', left: 60, top: 300 }}>
      <Btn bg={C.tomato} color="#ffffff" size={52} w={TW - 120} h={150} pressed={f >= SHOUT && f < SHOUT + 8} style={{ borderRadius: 44, transform: f < SHOUT ? `scale(${1 + 0.04 * Math.sin(f / 4)})` : undefined }}>📣 Dernière carte !</Btn>
    </Pop>
    <Pop f={f} at={LATE} from={60} rot={-1.5} style={{ position: 'absolute', left: 40, top: 520 }}>
      <Panel bg="#ffd0da" radius={36} style={{ width: TW - 80, height: 300, padding: '26px 30px 0' }}>
        <div style={{ fontSize: 46, lineHeight: 1.1 }}>Tu as oublié de le dire ?</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 18 }}>
          <Avatar slug="kevin" expression="clin_oeil" size={120} />
          <div style={{ flex: 1, fontSize: 38, lineHeight: 1.15 }}>Un autre joueur te <span style={{ color: C.tomato }}>dénonce</span> :<br />tu pioches 2 cartes !</div>
        </div>
      </Panel>
    </Pop>
    <Finger f={f} taps={[{ at: SHOUT - 8, x: 470, y: 390 }]} />
    <Sfx name="tap" at={SHOUT} volume={0.8} />
    <Sfx name="success" at={SHOUT + 6} volume={0.5} />
    <Sfx name="whoosh" at={LATE} volume={0.45} />
  </>
)

export const pasDeBol: TutoSpec = {
  id: 'pas-de-bol',
  name: 'Pas de bol !',
  emoji: '🃏',
  color: '#FB8500',
  players: '2 à 9 joueurs',
  goal: 'Vide ta main avant les autres !',
  cast: ['cycy', 'dede', 'kevin', 'mika'],
  steps: [
    { text: 'Pose une carte de la même couleur ou du même symbole', seconds: 5.4, Mock: Matching },
    { text: 'Rien à poser ? Pioche !', seconds: 4.4, Mock: Drawing },
    { text: 'Les +2 et +4 se cumulent… aïe !', seconds: 5.8, Mock: Stacking },
    { text: 'Plus qu’une carte ? Touche « Dernière carte ! »', seconds: 5.6, Mock: LastCard },
  ],
  win: {
    text: 'Vide ta main pour être sauvé. Le dernier avec des cartes… a pas de bol !',
    winners: ['cycy', 'dede', 'kevin'],
  },
}

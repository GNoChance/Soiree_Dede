// Tuto « Le Tour des Potes » : plateau stylisé de 40 cases. Dédé achète le Château Falfas (case 8, 100 €),
// réunit le quartier bleu de Bayon (cases 6, 8, 9), construit (50 € la maison), puis Keke paie 550 € (hôtel).
import React from 'react'
import { C, sticker, type Slug } from '../../theme'
import { Avatar, Chibi, Finger, Outlined, Panel, Pill, Pop, SPRING, Sfx, TW, bob, clamp01, ramp, sp } from '../kit'
import { Btn, Fly } from '../parts'
import { Die } from './menteur'
import type { MockScene, TutoSpec } from '../types'

const BLUE = '#7DD3FC'
const GROUP_COLOR: Record<number, string> = {
  1: '#8B5A2B', 3: '#8B5A2B', 6: BLUE, 8: BLUE, 9: BLUE, 11: '#EC4899', 13: '#EC4899', 14: '#EC4899', 16: '#F97316', 18: '#F97316', 19: '#F97316',
  21: '#EF4444', 23: '#EF4444', 24: '#EF4444', 26: '#FACC15', 27: '#FACC15', 29: '#FACC15', 31: '#22C55E', 32: '#22C55E', 34: '#22C55E', 37: '#2563EB', 39: '#2563EB',
}
const ICON: Record<number, string> = { 0: '🏁', 10: '🚔', 20: '🍹', 30: '👮', 2: '🍻', 17: '🍻', 33: '🍻', 7: '❓', 22: '❓', 36: '❓', 4: '🥂', 38: '🥂', 5: '🏡', 15: '🏡', 25: '🏡', 35: '🏡', 12: '⛴️', 28: '🍷' }
const CS = 58
const BS = CS * 11
const BX = (TW - BS) / 2
/** Case i → colonne / ligne de la grille 11 × 11 (0 = Départ en bas à droite, sens horaire). */
const cellPos = (i: number) => {
  const k = ((i % 40) + 40) % 40
  if (k <= 10) return { c: 10 - k, r: 10 }
  if (k <= 20) return { c: 0, r: 20 - k }
  if (k <= 30) return { c: k - 20, r: 0 }
  return { c: 10, r: k - 30 }
}
const Pawn: React.FC<{ slug: Slug; at: number; size?: number }> = ({ slug, at, size = 70 }) => {
  const a = cellPos(Math.floor(at))
  const b = cellPos(Math.ceil(at))
  const p = at - Math.floor(at)
  return (
    <div style={{ position: 'absolute', left: (a.c + (b.c - a.c) * p) * CS + CS / 2 - size / 2, top: (a.r + (b.r - a.r) * p) * CS + CS / 2 - size / 2 - Math.sin(p * Math.PI) * 34 - 6, zIndex: 5 }}>
      <Avatar slug={slug} size={size} />
    </div>
  )
}
const Board: React.FC<{ f: number; top: number; owned?: number[]; hotel?: number[]; children?: React.ReactNode }> = ({ f, top, owned = [], hotel = [], children }) => {
  const i = sp(f, 0, SPRING.snappy)
  return (
    <div style={{ position: 'absolute', left: BX, top, width: BS, height: BS, transform: `scale(${0.7 + 0.3 * i})`, opacity: clamp01(i * 2) }}>
      <div style={{ position: 'absolute', inset: -10, borderRadius: 26, background: '#d6fbef', border: `5px solid ${C.ink}`, boxShadow: sticker(9), boxSizing: 'border-box' }} />
      {Array.from({ length: 40 }, (_, k) => {
        const { c, r } = cellPos(k)
        const col = GROUP_COLOR[k]
        return (
          <div key={k} style={{ position: 'absolute', left: c * CS, top: r * CS, width: CS, height: CS, boxSizing: 'border-box', border: `2px solid ${C.ink}`, background: owned.includes(k) ? '#ffe9bf' : C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, lineHeight: 1, overflow: 'hidden' }}>
            {col && <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 16, background: col, borderBottom: `2px solid ${C.ink}` }} />}
            {hotel.includes(k) ? <span style={{ marginTop: 12 }}>🏨</span> : ICON[k]}
          </div>
        )
      })}
      {children}
    </div>
  )
}
const Cash: React.FC<{ slug: Slug; amount: number; bump?: number; style?: React.CSSProperties }> = ({ slug, amount, bump = 0, style }) => (
  <Panel radius={26} shadow={5} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 20px 6px 8px', fontSize: 40, lineHeight: 1, transform: `scale(${1 + bump * 0.12})`, ...style }}>
    <Avatar slug={slug} size={66} />
    <div style={{ paddingTop: 6 }}>{amount.toLocaleString('fr-FR').replace(/\s/g, ' ')} €</div>
  </Panel>
)

// 1 — Les dés et le pion
const B_TOP = 30
const ROLL = 34
const Rolling: MockScene = ({ f }) => {
  const rolled = f >= ROLL
  const shake = !rolled && f > 8
  const steps = clamp01((f - ROLL - 14) / 64) * 8
  return (
    <>
      <Board f={f} top={B_TOP}>
        <Pawn slug="dede" at={steps} />
        <Pawn slug="kevin" at={3} size={54} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 150, display: 'flex', justifyContent: 'center', gap: 22 }}>
          {[3, 5].map((v, k) => (
            <div key={k} style={{ transform: `rotate(${shake ? Math.sin(f * 1.3 + k) * 40 : (k ? 8 : -8)}deg) translateY(${shake ? Math.abs(Math.sin(f / 2 + k)) * -30 : 0}px) scale(${rolled ? 0.8 + 0.2 * sp(f, ROLL, SPRING.pop) : 1})` }}>
              <Die v={rolled ? v : 1 + ((Math.floor(Math.max(0, f) / 3) + k * 2) % 6)} size={120} />
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 320, display: 'flex', justifyContent: 'center' }}>
          <Pop f={f} at={ROLL + 4} rot={-4}><Outlined size={84} color={C.sun}>8 cases !</Outlined></Pop>
        </div>
      </Board>
      <div style={{ position: 'absolute', left: 0, right: 0, top: B_TOP + BS + 40, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={ROLL + 50} rot={-2}><Pill bg={C.surface} size={34}>🏁 Passe par le Départ : +200 €</Pill></Pop>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: B_TOP + BS + 116, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={ROLL + 62} rot={2}><Pill bg={C.sun} size={30}>🎲 Un double ? Tu rejoues !</Pill></Pop>
      </div>
      {Array.from({ length: 5 }, (_, k) => <Sfx key={k} name="type" at={10 + k * 5} volume={0.8} />)}
      <Sfx name="pop" at={ROLL} volume={0.7} />
      {Array.from({ length: 8 }, (_, k) => <Sfx key={`h${k}`} name="tap" at={ROLL + 14 + k * 8 + 6} volume={0.6} />)}
    </>
  )
}

const Deed: React.FC<{ name: string; w?: number; price?: string; children?: React.ReactNode }> = ({ name, w = 420, price, children }) => (
  <Panel radius={w * 0.08} shadow={w > 300 ? 10 : 5} style={{ width: w, overflow: 'hidden', paddingBottom: w * 0.05 }}>
    <div style={{ height: w * 0.2, background: BLUE, borderBottom: `5px solid ${C.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: w * 0.075, lineHeight: 1, paddingTop: 4 }}>Bayon-sur-Gironde</div>
    <div style={{ textAlign: 'center', fontSize: w * 0.125, lineHeight: 1.05, padding: `${w * 0.05}px ${w * 0.04}px 0` }}>{name}</div>
    {price && <div style={{ textAlign: 'center', fontSize: w * 0.2, lineHeight: 1.1, color: C.tangerine }}>{price}</div>}
    {children}
  </Panel>
)

// 2 — Acheter un lieu libre
const BUY = 60
const Buying: MockScene = ({ f }) => {
  const bought = f >= BUY + 14
  return (
    <>
      <Cash slug="dede" amount={bought ? 1400 : 1500} bump={clamp01(1 - Math.abs(f - BUY - 18) / 6)} style={{ position: 'absolute', left: 40, top: 0 }} />
      <Pop f={f} at={2} from={80} rot={-2} style={{ position: 'absolute', left: (TW - 420) / 2, top: 110 }}>
        <Deed name="Château Falfas" price="100 €">
          <div style={{ textAlign: 'center', fontSize: 30, lineHeight: 1.3, color: C.muted }}>Loyer : 6 € · avec hôtel : 550 €</div>
        </Deed>
      </Pop>
      {bought && (
        <div style={{ position: 'absolute', left: 390, top: 400, transform: `scale(${3 - 2 * Math.min(1, sp(f, BUY + 14, SPRING.pop))}) rotate(-12deg)`, opacity: clamp01(sp(f, BUY + 14) * 2), zIndex: 6 }}>
          <Pill bg={C.mint} size={50} style={{ borderWidth: 6 }}>🔑 À Dédé !</Pill>
        </div>
      )}
      <Pop f={f} at={14} style={{ position: 'absolute', left: 60, top: 560 }}>
        <Btn bg={C.mint} size={60} w={380} h={130} pressed={f >= BUY && f < BUY + 8}>Acheter</Btn>
      </Pop>
      <Pop f={f} at={18} style={{ position: 'absolute', left: 470, top: 560 }}>
        <Btn bg={C.surface} size={44} w={190} h={130} style={{ opacity: 0.7 }}>Passer</Btn>
      </Pop>
      {[0, 1, 2].map((k) => <Fly key={k} f={f} at={BUY + 4 + k * 4} len={16} from={[170, 60]} to={[620, 60]} arc={40} size={60}>💶</Fly>)}
      <Pop f={f} at={BUY + 6} style={{ position: 'absolute', left: 560, top: 6 }}><div style={{ fontSize: 80, lineHeight: 1 }}>🏦</div></Pop>
      <div style={{ position: 'absolute', left: 250, top: 700 + (1 - sp(f, 20)) * 300 + bob(f, 0, bought ? 24 : 8, bought ? 14 : 26) }}>
        <Chibi slug="dede" expression={bought ? 'joie' : 'reflexion'} size={190} />
      </div>
      <Finger f={f} taps={[{ at: BUY - 8, x: 300, y: 640 }]} />
      <Sfx name="tap" at={BUY} volume={0.8} />
      <Sfx name="swoosh-up" at={BUY + 6} volume={0.5} />
      <Sfx name="success" at={BUY + 16} volume={0.5} />
    </>
  )
}

// 3 — Quartier complet : maisons puis hôtel
const QUARTIER = ['Route de la Corniche', 'Château Falfas', 'Église Notre-Dame']
const HOUSE_AT = [40, 58, 76, 94]
const HOTEL_AT = 122
const Building: MockScene = ({ f }) => {
  const n = HOUSE_AT.filter((at) => f >= at).length
  const hotel = f >= HOTEL_AT
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center' }}>
        <Pop f={f} at={22} rot={-2}><Pill bg={BLUE} size={38}>✅ Tout le quartier bleu est à toi</Pill></Pop>
      </div>
      {QUARTIER.map((name, k) => (
        <Pop key={name} f={f} at={2 + k * 6} from={80} rot={(k - 1) * 2} style={{ position: 'absolute', left: 22 + k * 228, top: 100 + (k === 1 ? 0 : 20) }}>
          <Deed name={name} w={220}>
            <div style={{ height: 150, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '8px 16px 0', fontSize: hotel ? 100 : 50, lineHeight: 1 }}>
              {hotel
                ? <span style={{ transform: `scale(${sp(f, HOTEL_AT + k * 3, SPRING.pop)})`, display: 'inline-block' }}>🏨</span>
                : HOUSE_AT.slice(0, n).map((at, i) => <span key={i} style={{ transform: `scale(${sp(f, at + k * 3, SPRING.pop)})`, display: 'inline-block' }}>🏠</span>)}
            </div>
          </Deed>
        </Pop>
      ))}
      <Pop f={f} at={46} rot={-2} style={{ position: 'absolute', left: 60, top: 560 }}>
        <Pill bg={C.surface} size={36}>🏠 50 € la maison</Pill>
      </Pop>
      <Pop f={f} at={HOTEL_AT + 6} rot={2} style={{ position: 'absolute', left: 200, top: 650 }}>
        <Pill bg={C.sun} size={36}>4 maisons… puis l’hôtel 🏨</Pill>
      </Pop>
      <div style={{ position: 'absolute', left: 30, top: 660 + (1 - sp(f, 30)) * 300 + bob(f, 0, hotel ? 24 : 8, hotel ? 14 : 26) }}>
        <Chibi slug="dede" expression={hotel ? 'cool' : 'joie'} size={200} />
      </div>
      {HOUSE_AT.map((at, k) => <Sfx key={k} name="pop" at={at + 8} volume={0.55} />)}
      <Sfx name="success" at={HOTEL_AT + 4} volume={0.55} />
    </>
  )
}

// 4 — Le loyer
const LAND = 50
const PAY = 70
const Rent: MockScene = ({ f }) => {
  const paid = f >= PAY + 22
  const at = 3 + clamp01((f - 10) / 40) * 5
  return (
    <>
      <Board f={f} top={B_TOP} owned={[6, 8, 9]} hotel={[6, 8, 9]}>
        <Pawn slug="kevin" at={at} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 110, display: 'flex', justifyContent: 'center', gap: 60 }}>
          <div style={{ transform: `translateY(${bob(f, 0, paid ? 24 : 8, paid ? 14 : 26)}px)` }}><Chibi slug="dede" expression={f >= LAND ? 'joie' : 'cool'} size={190} /></div>
          <div style={{ transform: `translateY(${bob(f, 12, 6, 30)}px)` }}><Chibi slug="kevin" expression={paid ? 'pleurs' : f >= LAND ? 'surprise' : 'joie'} size={190} /></div>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 316, display: 'flex', justifyContent: 'center' }}>
          <Pop f={f} at={LAND + 4} rot={-4}><Outlined size={78} color={C.tomato}>Loyer : 550 € !</Outlined></Pop>
        </div>
        {[0, 1, 2, 3].map((k) => <Fly key={k} f={f} at={PAY + k * 5} len={16} from={[440, 200]} to={[200, 200]} arc={70} size={60}>💶</Fly>)}
      </Board>
      <Cash slug="dede" amount={paid ? 1650 : 1100} bump={clamp01(1 - Math.abs(f - PAY - 24) / 6)} style={{ position: 'absolute', left: 40, top: B_TOP + BS + 40 }} />
      <Cash slug="kevin" amount={paid ? 730 : 1280} style={{ position: 'absolute', left: 390, top: B_TOP + BS + 40, background: paid ? '#ffd0da' : C.surface }} />
      <Sfx name="tap" at={LAND} volume={0.8} />
      <Sfx name="whoosh" at={LAND + 4} volume={0.5} />
      {[0, 1, 2, 3].map((k) => <Sfx key={k} name="pop" at={PAY + 16 + k * 5} volume={0.5} />)}
    </>
  )
}

export const tourDesPotes: TutoSpec = {
  id: 'tour-des-potes',
  name: 'Le Tour des Potes',
  emoji: '🏙️',
  color: '#10B981',
  players: '2 à 9 joueurs',
  goal: 'Deviens le plus riche de la bande !',
  cast: ['dede', 'kevin', 'cycy', 'mika'],
  steps: [
    { text: 'Lance les dés et avance sur le plateau', seconds: 5, Mock: Rolling },
    { text: 'Tu t’arrêtes sur un lieu libre ? Achète-le !', seconds: 4.8, Mock: Buying },
    { text: 'Réunis un quartier pour construire maisons puis hôtel', seconds: 5.6, Mock: Building },
    { text: 'Les autres tombent chez toi ? Ils paient le loyer !', seconds: 5, Mock: Rent },
  ],
  win: {
    text: 'À la fin, la plus grosse fortune gagne !',
    sub: 'Fortune = argent + lieux + bâtiments. Et gare au violon !',
    winners: ['dede'],
  },
}

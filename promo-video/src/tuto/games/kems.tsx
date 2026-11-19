// Tuto « Kems » : Rouges (Keke et Dédé, tenue Cow-boy) contre Bleus (Manon et Cycy, tenue par défaut).
// Cartes d'un jeu de 32 (7 → As) : toutes les cartes montrées existent à 4 joueurs.
import React from 'react'
import { C, DISPLAY, type Slug } from '../../theme'
import { Chibi, ConfettiBurst, Finger, Outlined, Panel, Pill, Pop, Sfx, bob, easeInOut, lerp, ramp, wiggle } from '../kit'
import { Fly, Phone } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const RED = '#ef476f'
const BLUE = '#3a86ff'
const RED_SOFT = '#ffd6df'
const BLUE_SOFT = '#d6e6ff'
const INK_RED = '#d62839'
const OUTFITS: Partial<Record<Slug, string>> = { kevin: 'cowboy', dede: 'cowboy' }

const SUITS: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }

/** Carte (« 9S », « KD », « 10C »…) posée en (x, y), largeur w ; `flip` 0 → 1 : dos → face. */
const KCard: React.FC<{ card: string; x: number; y: number; w: number; glow?: boolean; ring?: boolean; back?: boolean; sx?: number; dy?: number; z?: number; op?: number }> = ({
  card, x, y, w, glow, ring, back, sx = 1, dy = 0, z = 1, op = 1,
}) => {
  const suit = card.slice(-1)
  const rank = card.slice(0, -1)
  const color = suit === 'H' || suit === 'D' ? INK_RED : C.ink
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y + dy, width: w, height: w * 1.4, boxSizing: 'border-box', borderRadius: w * 0.14, border: `${w * 0.04 + 1}px solid ${C.ink}`,
        background: back ? 'repeating-linear-gradient(45deg, #ef476f 0 12px, #ffb703 12px 24px)' : '#ffffff', color, overflow: 'hidden', zIndex: z, opacity: op,
        boxShadow: ring ? '0 0 0 6px #ffb703' : glow ? '0 0 0 6px #06d6a0, 0 0 26px 8px #06d6a0aa' : `4px 4px 0 0 ${C.ink}`,
        transform: `scaleX(${sx})`, fontFamily: DISPLAY, fontWeight: 800,
      }}
    >
      {!back && (
        <>
          <div style={{ position: 'absolute', left: '9%', top: '3%', display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 0.95, fontSize: w * 0.33 }}>
            {rank}
            <span style={{ fontSize: w * 0.25 }}>{SUITS[suit]}</span>
          </div>
          <div style={{ position: 'absolute', right: '9%', bottom: '4%', lineHeight: 1, fontSize: w * 0.58 }}>{SUITS[suit]}</div>
        </>
      )}
    </div>
  )
}
/** Retournement p : 0 (dos) → 1 (face). */
const flipOf = (p: number) => ({ back: p < 0.5, sx: Math.max(0.02, Math.abs(1 - 2 * p)) })

/** Bouton à appui long : jauge qui se remplit (p 0 → 1). */
const HoldBtn: React.FC<{ p: number; bg: string; color?: string; w: number; h: number; size: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  p, bg, color = '#ffffff', w, h, size, style, children,
}) => (
  <Panel bg={bg} radius={32} shadow={p > 0 ? 2 : 8} style={{ width: w, height: h, position: 'relative', overflow: 'hidden', transform: p > 0 ? 'translate(5px, 5px)' : undefined, ...style }}>
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p * 100}%`, background: 'rgba(255,255,255,0.4)' }} />
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color, fontSize: size, lineHeight: 1, paddingTop: 6 }}>{children}</div>
  </Panel>
)

/** Disque d'équipe + chibi. */
const Seat: React.FC<{ f: number; at: number; slug: Slug; team: 'red' | 'blue'; x: number; y: number; size: number; expr?: string }> = ({ f, at, slug, team, x, y, size, expr = 'joie' }) => (
  <Pop f={f} at={at} from={80} style={{ position: 'absolute', left: x, top: y, width: size, height: size }}>
    <div style={{ width: size, height: size, borderRadius: '50%', boxSizing: 'border-box', border: `7px solid ${team === 'red' ? RED : BLUE}`, background: team === 'red' ? RED_SOFT : BLUE_SOFT, boxShadow: `5px 5px 0 0 ${C.ink}`, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}>
      <Chibi slug={slug} expression={expr} size={size * 0.95} outfit={OUTFITS[slug]} style={{ transform: `translateY(${bob(f, x, 6, 30)}px)` }} />
    </div>
  </Pop>
)

const TeamTag: React.FC<{ score: number; style?: React.CSSProperties }> = ({ score, style }) => (
  <Panel bg={RED_SOFT} radius={999} shadow={5} style={{ padding: '10px 28px 4px', fontSize: 46, lineHeight: 1.1, whiteSpace: 'nowrap', ...style }}>🔴 Rouges {score}</Panel>
)

// ---------------------------------------------------------------------------
// 1 — Équipes de 2 face à face, signe secret
// ---------------------------------------------------------------------------
const Teams: MockScene = ({ f }) => {
  const table = 1 - easeInOut(ramp(f, 66, 78))
  const phoneIn = f >= 80
  const ready = f >= 142
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, opacity: table, transform: `scale(${0.6 + 0.4 * table})`, transformOrigin: '50% 40%', display: table > 0.01 ? 'block' : 'none' }}>
        <Pop f={f} at={0} style={{ position: 'absolute', left: 130, top: 150, width: 460, height: 400 }}>
          <Panel bg="#bdf0d5" radius={120} shadow={8} style={{ width: 460, height: 400 }} />
        </Pop>
        {/* flèche rouge verticale */}
        <Pop f={f} at={26} style={{ position: 'absolute', left: 346, top: 190, width: 28, height: 320 }}>
          <div style={{ position: 'absolute', left: 6, top: 30, width: 16, height: 260, background: RED, border: `4px solid ${C.ink}`, boxSizing: 'border-box', borderRadius: 8 }} />
          <div style={{ position: 'absolute', left: -9, top: -10, fontSize: 56, color: RED, lineHeight: 1, WebkitTextStroke: `3px ${C.ink}`, paintOrder: 'stroke fill' }}>▲</div>
          <div style={{ position: 'absolute', left: -9, top: 270, fontSize: 56, color: RED, lineHeight: 1, WebkitTextStroke: `3px ${C.ink}`, paintOrder: 'stroke fill' }}>▼</div>
        </Pop>
        {/* flèche bleue horizontale */}
        <Pop f={f} at={34} style={{ position: 'absolute', left: 150, top: 326, width: 420, height: 28 }}>
          <div style={{ position: 'absolute', left: 50, top: 6, width: 320, height: 16, background: BLUE, border: `4px solid ${C.ink}`, boxSizing: 'border-box', borderRadius: 8 }} />
          <div style={{ position: 'absolute', left: -8, top: -12, fontSize: 56, color: BLUE, lineHeight: 1, WebkitTextStroke: `3px ${C.ink}`, paintOrder: 'stroke fill' }}>◀</div>
          <div style={{ position: 'absolute', left: 372, top: -12, fontSize: 56, color: BLUE, lineHeight: 1, WebkitTextStroke: `3px ${C.ink}`, paintOrder: 'stroke fill' }}>▶</div>
        </Pop>
        <Seat f={f} at={6} slug="dede" team="red" x={260} y={0} size={200} />
        <Seat f={f} at={12} slug="kevin" team="red" x={260} y={530} size={200} />
        <Seat f={f} at={18} slug="manon" team="blue" x={0} y={250} size={200} />
        <Seat f={f} at={22} slug="cycy" team="blue" x={520} y={250} size={200} />
        <Pop f={f} at={40} rot={-3} style={{ position: 'absolute', left: 20, top: 20 }}><Pill bg={RED_SOFT} size={34}>🔴 Rouges</Pill></Pop>
        <Pop f={f} at={44} rot={3} style={{ position: 'absolute', left: 450, top: 20 }}><Pill bg={BLUE_SOFT} size={34}>🔵 Bleus</Pill></Pop>
        <Pop f={f} at={48} style={{ position: 'absolute', left: 285, top: 740 }}><Pill bg={C.surface} size={32}>Face à face !</Pill></Pop>
      </div>
      {phoneIn && (
        <Pop f={f} at={80} from={120} style={{ position: 'absolute', left: 100, top: 40 }}>
          <Phone w={520} h={700}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 18, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 90, height: 90, borderRadius: '50%', border: `4px solid ${C.ink}`, background: RED_SOFT, overflow: 'hidden', boxSizing: 'border-box' }}>
                <Chibi slug="kevin" expression="joie" size={84} outfit="cowboy" />
              </div>
              <span style={{ fontSize: 50 }}>🤝</span>
              <div style={{ width: 90, height: 90, borderRadius: '50%', border: `4px solid ${C.ink}`, background: RED_SOFT, overflow: 'hidden', boxSizing: 'border-box' }}>
                <Chibi slug="dede" expression="clin_oeil" size={84} outfit="cowboy" />
              </div>
            </div>
            <div style={{ position: 'absolute', left: 20, right: 20, top: 122, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1.1, color: C.ink }}>🤫 Choisis un signe secret avec Dédé</div>
            {['Faire un clin d’œil', 'Se gratter le nez', 'Hausser un sourcil'].map((t, i) => (
              <Pop key={t} f={f} at={96 + i * 6} style={{ position: 'absolute', left: 30, right: 30, top: 214 + i * 68 }}>
                <Panel bg="#ffffff" radius={22} shadow={4} style={{ height: 54, fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 4, border: `4px solid ${C.ink}` }}>💡 {t}</Panel>
              </Pop>
            ))}
            <div style={{ position: 'absolute', left: 27, top: 470 }}>
              <Panel bg={ready ? C.surface : C.sun} radius={30} shadow={f >= 140 && f < 150 ? 2 : 8} style={{ width: 420, height: 100, fontSize: ready ? 34 : 50, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 6, opacity: ready ? 0.7 : 1 }}>
                {ready ? 'En attente…' : 'Prêt !'}
              </Panel>
            </div>
          </Phone>
        </Pop>
      )}
      {phoneIn && f >= 100 && (
        <Pop f={f} at={100} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 790, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.mint} size={36}>🤫 Le signe se fait en vrai !</Pill>
        </Pop>
      )}
      {phoneIn && <Finger f={f} taps={[{ at: 140, x: 360, y: 583 }]} />}
      <Sfx name="pop" at={8} volume={0.45} />
      <Sfx name="pop" at={14} volume={0.45} />
      <Sfx name="pop" at={20} volume={0.45} />
      <Sfx name="whoosh" at={80} volume={0.35} />
      <Sfx name="tap" at={140} volume={0.5} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 2 — Échange avec le centre, tous en même temps, balayage
// ---------------------------------------------------------------------------
const CW = 104
const SLOT = (i: number) => 26 + i * 118
const PX = 105 // origine de l'écran du téléphone (x)
const PY = 45 // idem (y)

const Swap: MockScene = ({ f }) => {
  const CY = 80
  const HY = 330
  const m = easeInOut(ramp(f, 52, 68))
  const flipA = ramp(f, 66, 82) // A♠ → 8♦ (Manon)
  const out = easeInOut(ramp(f, 128, 144))
  const into = easeInOut(ramp(f, 140, 158))
  const votes = f < 108 ? 0 : f < 114 ? 1 : f < 118 ? 2 : f < 122 ? 3 : 4
  const sweepP = ramp(f, 108, 124)
  const newCards = ['10H', 'JS', 'KC', '7D']
  return (
    <>
      <Pop f={f} at={0} from={100} style={{ position: 'absolute', left: 80, top: 20 }}>
        <Phone w={560} h={780}>
          <div style={{ position: 'absolute', left: 26, top: 24, fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, color: C.muted }}>Centre</div>
          <div style={{ position: 'absolute', left: 26, top: 278, fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, color: C.muted }}>Ma main</div>
          {f < 140 ? (
            <>
              <KCard card="7H" x={SLOT(0)} y={CY} w={CW} dy={-out * 50} op={1 - out} />
              <KCard card="10C" x={SLOT(2)} y={CY} w={CW} dy={-out * 50} op={1 - out} />
              <KCard card={flipA < 0.5 ? 'AS' : '8D'} x={SLOT(3)} y={CY} w={CW} sx={flipOf(flipA).sx} dy={-out * 50} op={1 - out} />
              {/* 9♠ (main) ↔ K♦ (centre) */}
              <KCard card="KD" x={lerp(SLOT(1), SLOT(0), m)} y={lerp(CY, HY, m)} w={CW} ring={f >= 50 && m < 1} z={m > 0 && m < 1 ? 4 : 2} />
              <KCard card="9S" x={lerp(SLOT(0), SLOT(1), m)} y={lerp(HY, CY, m) - (m > 0 ? 0 : 14 * ramp(f, 34, 42))} w={CW} ring={f >= 34 && m < 1} dy={m >= 1 ? -out * 50 : 0} op={m >= 1 ? 1 - out : 1} z={3} />
            </>
          ) : (
            <>
              {newCards.map((c, i) => <KCard key={c} card={c} x={SLOT(i)} y={CY} w={CW} dy={(1 - into) * 50} op={into} />)}
              <KCard card="KD" x={SLOT(0)} y={HY} w={CW} />
            </>
          )}
          {[['KS', 1], ['KH', 2], ['8C', 3]].map(([c, i]) => (
            <KCard key={c as string} card={c as string} x={SLOT(i as number)} y={HY} w={CW} />
          ))}
          {/* Suivantes */}
          <div style={{ position: 'absolute', left: 26, top: 540 }}>
            <Panel bg={sweepP > 0 && f < 130 ? C.sun : '#ffe4a3'} radius={28} shadow={f >= 108 && f < 118 ? 2 : 7} style={{ width: 458, height: 110, fontSize: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 6 }}>
              <span>🧹 Suivantes</span>
              <span style={{ fontSize: 34, color: C.muted }}>{votes} sur 4</span>
            </Panel>
          </div>
        </Phone>
      </Pop>
      {/* Manon prend le A♠ en même temps */}
      {f >= 62 && f < 100 && (
        <Pop f={f} at={62} from={-60} style={{ position: 'absolute', left: PX + SLOT(3) + 52 - 55, top: PY + CY - 100, zIndex: 20 }}>
          <div style={{ width: 110, height: 110, borderRadius: '50%', border: `5px solid ${C.ink}`, background: BLUE_SOFT, overflow: 'hidden', boxSizing: 'border-box', boxShadow: `4px 4px 0 0 ${C.ink}`, transform: `rotate(${wiggle(f, 0, 6, 20)}deg)` }}>
            <Chibi slug="manon" expression="joie" size={104} />
          </div>
        </Pop>
      )}
      {f >= 66 && f < 124 && (
        <Pop f={f} at={66} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 812, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.sun} size={36}>⚡ Tous en même temps !</Pill>
        </Pop>
      )}
      {f >= 126 && (
        <Pop f={f} at={126} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 812, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.mint} size={36}>🧹 Rien de bon ? Suivantes !</Pill>
        </Pop>
      )}
      <Finger
        f={f}
        taps={[
          { at: 34, x: PX + SLOT(0) + 52, y: PY + HY + 73 },
          { at: 50, x: PX + SLOT(1) + 52, y: PY + CY + 73 },
          { at: 108, x: 360, y: PY + 540 + 55 },
        ]}
      />
      <Sfx name="tap" at={34} volume={0.5} />
      <Sfx name="tap" at={50} volume={0.5} />
      <Sfx name="whoosh" at={54} volume={0.4} />
      <Sfx name="pop" at={68} volume={0.5} />
      <Sfx name="tap" at={108} volume={0.5} />
      <Sfx name="swoosh-up" at={128} volume={0.45} />
      <Sfx name="whoosh" at={142} volume={0.4} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 3 — Carré : signe, puis KEMS maintenu par le partenaire
// ---------------------------------------------------------------------------
const Square: MockScene = ({ f }) => {
  const CY = 60
  const HY = 282
  const m = easeInOut(ramp(f, 30, 44))
  const glow = f >= 46
  const phoneOut = easeInOut(ramp(f, 62, 74))
  const hold = ramp(f, 100, 124)
  const over = f >= 126
  const chibiK = f < 74 ? 'cool' : 'clin_oeil'
  const chibiD = f < 92 ? 'reflexion' : 'surprise'
  return (
    <>
      {phoneOut < 1 && (
        <div style={{ position: 'absolute', left: 80, top: 20, opacity: 1 - phoneOut, transform: `translateY(${-phoneOut * 100}px) scale(${1 - phoneOut * 0.3})` }}>
          <Pop f={f} at={0} from={100}>
            <Phone w={560} h={600}>
              <div style={{ position: 'absolute', left: 26, top: 18, fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, color: C.muted }}>Centre</div>
              <div style={{ position: 'absolute', left: 26, top: 236, fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, color: C.muted }}>Ma main</div>
              {[['10H', 0], ['JS', 1], ['7D', 3]].map(([c, i]) => (
                <KCard key={c as string} card={c as string} x={SLOT(i as number)} y={CY} w={CW} />
              ))}
              {['KD', 'KS', 'KH'].map((c, i) => (
                <KCard key={c} card={c} x={SLOT(i)} y={HY} w={CW} glow={glow} />
              ))}
              {/* 8♣ (main) ↔ K♣ (centre) */}
              <KCard card="KC" x={lerp(SLOT(2), SLOT(3), m)} y={lerp(CY, HY, m)} w={CW} glow={glow && m >= 1} ring={f >= 28 && m < 1} z={m > 0 && m < 1 ? 4 : 2} />
              <KCard card="8C" x={lerp(SLOT(3), SLOT(2), m)} y={lerp(HY, CY, m) - (m > 0 ? 0 : 12 * ramp(f, 14, 22))} w={CW} ring={f >= 14 && m < 1} z={3} />
            </Phone>
          </Pop>
        </div>
      )}
      {f >= 48 && f < 80 && (
        <Pop f={f} at={48} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 650, display: 'flex', justifyContent: 'center' }}>
          <Pill bg={C.mint} size={36}>🃏 Carré ! Fais ton signe 🤫</Pill>
        </Pop>
      )}
      {/* le signe */}
      {f >= 66 && (
        <>
          <Pop f={f} at={66} from={120} style={{ position: 'absolute', left: 10, top: 20 }}>
            <Chibi slug="kevin" expression={chibiK} size={260} outfit="cowboy" style={{ transform: `translateY(${bob(f, 0, 8, 30)}px)` }} />
          </Pop>
          <Pop f={f} at={70} from={120} style={{ position: 'absolute', left: 450, top: 20 }}>
            <Chibi slug="dede" expression={chibiD} size={260} outfit="cowboy" style={{ transform: `translateY(${bob(f, 12, f >= 92 ? 12 : 6, 30)}px)` }} />
          </Pop>
          {f >= 76 && (
            <div style={{ position: 'absolute', left: 250, top: 150, width: 230, height: 0, borderTop: `8px dotted ${C.ink}`, opacity: ramp(f, 76, 84) }} />
          )}
          <Fly f={f} at={80} len={18} from={[300, 150]} to={[440, 150]} arc={50} size={72}>😉</Fly>
        </>
      )}
      {f >= 84 && f < 126 && (
        <>
          <Pop f={f} at={84} from={150} style={{ position: 'absolute', left: 150, top: 300 }}>
            <Phone w={420} h={460}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 22, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 32, color: C.ink }}>🤫 Un signe de Keke ?</div>
              <div style={{ position: 'absolute', left: 22, top: 100 }}>
                <HoldBtn p={hold} bg={RED} w={338} h={220} size={86}>KEMS !</HoldBtn>
              </div>
            </Phone>
          </Pop>
          {f >= 90 && (
            <Pop f={f} at={90} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 790, display: 'flex', justifyContent: 'center' }}>
              <Pill bg={C.sun} size={36}>✋ Maintiens le bouton !</Pill>
            </Pop>
          )}
          <Finger f={f} taps={[{ at: 100, x: 150 + 19 + 22 + 169, y: 300 + 19 + 100 + 110 }, { at: 122, x: 150 + 19 + 22 + 169, y: 300 + 19 + 100 + 110 }]} />
        </>
      )}
      {over && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <Pop f={f} at={126} from={60} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
            <Panel bg={RED} radius={40} style={{ position: 'absolute', inset: 0 }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 50, display: 'flex', justifyContent: 'center' }}>
                <Outlined size={150} color="#ffffff">KEMS !</Outlined>
              </div>
              {['KD', 'KS', 'KH', 'KC'].map((c, i) => (
                <KCard key={c} card={c} x={52 + i * 150} y={290} w={130} {...flipOf(ramp(f, 128 + i * 3, 136 + i * 3))} glow />
              ))}
              <Pop f={f} at={142} style={{ position: 'absolute', left: 190, top: 520 }}><TeamTag score={f >= 154 ? 1 : 0} /></Pop>
              <div style={{ position: 'absolute', left: 20, top: 640, width: 230 }}><Chibi slug="kevin" expression="joie" size={230} outfit="cowboy" style={{ transform: `translateY(${bob(f, 0, 12, 24)}px)` }} /></div>
              <div style={{ position: 'absolute', left: 470, top: 640, width: 230 }}><Chibi slug="dede" expression="joie" size={230} outfit="cowboy" style={{ transform: `translateY(${bob(f, 10, 12, 24)}px)` }} /></div>
              <Fly f={f} at={146} len={14} from={[360, 420]} to={[470, 560]} arc={60} size={90}><Outlined size={80} color={C.sun}>+1</Outlined></Fly>
            </Panel>
          </Pop>
          <ConfettiBurst f={f} at={130} x={360} y={440} n={30} seed="kems3" />
        </div>
      )}
      <Sfx name="tap" at={14} volume={0.5} />
      <Sfx name="tap" at={28} volume={0.5} />
      <Sfx name="success" at={46} volume={0.45} />
      <Sfx name="whoosh" at={66} volume={0.35} />
      <Sfx name="pop" at={80} volume={0.5} />
      <Sfx name="tap" at={100} volume={0.5} />
      <Sfx name="jingle" at={126} volume={0.5} />
      <Sfx name="success" at={130} volume={0.6} />
      <Sfx name="pop" at={150} volume={0.5} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 4 — CONTRE-KEMS : repérer le signe de l'adversaire
// ---------------------------------------------------------------------------
const Counter: MockScene = ({ f }) => {
  const hold = ramp(f, 66, 92)
  const cyHappy = f < 70 ? 'bisou' : 'pleurs'
  const maExpr = f < 96 ? 'reflexion' : 'boude'
  const keExpr = f < 44 ? 'reflexion' : 'surprise'
  return (
    <>
      <Pop f={f} at={0} from={100} style={{ position: 'absolute', left: 20, top: 20 }}>
        <div style={{ width: 230, height: 230, borderRadius: '50%', boxSizing: 'border-box', border: `7px solid ${BLUE}`, background: BLUE_SOFT, boxShadow: `5px 5px 0 0 ${C.ink}`, overflow: 'hidden', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <Chibi slug="manon" expression="reflexion" size={220} />
        </div>
      </Pop>
      <Pop f={f} at={4} from={100} style={{ position: 'absolute', left: 470, top: 20 }}>
        <div style={{ width: 230, height: 230, borderRadius: '50%', boxSizing: 'border-box', border: `7px solid ${BLUE}`, background: BLUE_SOFT, boxShadow: `5px 5px 0 0 ${C.ink}`, overflow: 'hidden', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <Chibi slug="cycy" expression="bisou" size={220} style={{ transform: `translateY(${bob(f, 0, 8, 24)}px)` }} />
        </div>
      </Pop>
      {f >= 14 && <div style={{ position: 'absolute', left: 250, top: 130, width: 220, height: 0, borderTop: `8px dotted ${C.ink}`, opacity: ramp(f, 14, 22) }} />}
      <Fly f={f} at={20} len={18} from={[440, 130]} to={[290, 130]} arc={50} size={72}>😘</Fly>
      {/* Keke guette */}
      <Pop f={f} at={10} from={160} style={{ position: 'absolute', left: 0, top: 420 }}>
        <Chibi slug="kevin" expression={keExpr} size={300} outfit="cowboy" style={{ transform: `translateY(${bob(f, 0, 8, 30)}px)` }} />
      </Pop>
      <Fly f={f} at={46} len={16} from={[230, 500]} to={[570, 240]} arc={120} size={100} stay>🔎</Fly>
      {f < 100 && (
        <Pop f={f} at={50} from={150} style={{ position: 'absolute', left: 320, top: 380 }}>
          <Phone w={380} h={470}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 22, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, color: C.ink }}>👀 Tu as vu leur signe ?</div>
            <div style={{ position: 'absolute', left: 22, top: 110 }}>
              <HoldBtn p={hold} bg={C.ink} w={296} h={200} size={50}>CONTRE-<br />KEMS !</HoldBtn>
            </div>
          </Phone>
        </Pop>
      )}
      <Finger f={f} taps={[{ at: 66, x: 320 + 17 + 22 + 148, y: 380 + 17 + 110 + 100 }, { at: 88, x: 320 + 17 + 22 + 148, y: 380 + 17 + 110 + 100 }]} />
      {f >= 96 && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <Pop f={f} at={96} from={60} style={{ position: 'absolute', inset: 0 }}>
            <Panel bg="#3a3358" radius={40} style={{ position: 'absolute', inset: 0 }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 40, display: 'flex', justifyContent: 'center' }}>
                <Outlined size={92} color="#ffffff">CONTRE-KEMS<br />réussi !</Outlined>
              </div>
              {['QS', 'QH', 'QD', 'QC'].map((c, i) => (
                <KCard key={c} card={c} x={52 + i * 150} y={290} w={130} {...flipOf(ramp(f, 104 + i * 4, 114 + i * 4))} glow />
              ))}
              <Pop f={f} at={120} style={{ position: 'absolute', left: 190, top: 510 }}><TeamTag score={f >= 136 ? 1 : 0} /></Pop>
              <div style={{ position: 'absolute', left: 60, top: 600, width: 230 }}><Chibi slug="cycy" expression={cyHappy} size={230} style={{ transform: `translateY(${bob(f, 0, 6, 30)}px)` }} /></div>
              <div style={{ position: 'absolute', left: 430, top: 600, width: 230 }}><Chibi slug="manon" expression={maExpr} size={230} style={{ transform: `translateY(${bob(f, 10, 6, 30)}px)` }} /></div>
              <Fly f={f} at={124} len={14} from={[360, 400]} to={[470, 540]} arc={60} size={90}><Outlined size={80} color={C.sun}>+1</Outlined></Fly>
            </Panel>
          </Pop>
          <ConfettiBurst f={f} at={102} x={360} y={440} n={24} seed="kems4" />
        </div>
      )}
      {f >= 142 && (
        <Pop f={f} at={142} rot={-2} style={{ position: 'absolute', left: 0, right: 0, top: 800, display: 'flex', justifyContent: 'center', zIndex: 70 }}>
          <Pill bg={C.sun} size={36}>❌ Erreur : +1 aux autres !</Pill>
        </Pop>
      )}
      <Sfx name="pop" at={20} volume={0.45} />
      <Sfx name="swoosh-up" at={46} volume={0.4} />
      <Sfx name="tap" at={66} volume={0.5} />
      <Sfx name="jingle" at={96} volume={0.5} />
      <Sfx name="success" at={102} volume={0.6} />
      <Sfx name="pop" at={124} volume={0.5} />
      <Sfx name="pop" at={142} volume={0.4} />
    </>
  )
}

export const kems: TutoSpec = {
  id: 'kems',
  name: 'Kems',
  emoji: '🤠',
  color: '#ffb703',
  players: '4 à 9 joueurs',
  goal: 'Réunis quatre cartes identiques… et préviens ton coéquipier en secret !',
  cast: ['kevin', 'dede', 'manon', 'cycy'],
  outfits: OUTFITS,
  steps: [
    { text: 'En équipes de 2, face à face : choisissez un signe secret', seconds: 5.2, Mock: Teams },
    { text: 'Touche ta carte puis une du centre : elles s’échangent', seconds: 5.6, Mock: Swap },
    { text: 'Un carré ? Fais ton signe : ton coéquipier maintient KEMS !', seconds: 5.6, Mock: Square },
    { text: 'Tu repères leur signe ? Maintiens CONTRE-KEMS !', seconds: 5.6, Mock: Counter },
  ],
  win: {
    text: 'La première équipe à 5 points gagne !',
    sub: 'De 2 à 4 équipes de 2. En 3, 5 ou 7 points, au choix de l’hôte.',
    winners: ['kevin', 'dede'],
  },
}

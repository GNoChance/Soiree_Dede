// Tuto « Nom de Code » : Rouges (Dédé espion, Keke, Manon, Mika) contre Bleus (Cycy espionne, Marius, Cécile).
// Les deux espions portent la tenue Hacker, tout le monde le reste en tenue par défaut.
import React from 'react'
import { C, DISPLAY, type Slug } from '../../theme'
import { Chibi, ConfettiBurst, Finger, Outlined, Panel, Pill, Pop, Sfx, TW, bob, clamp01, easeInOut, ramp, sp, wiggle } from '../kit'
import { Btn, Phone } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const RED = '#ef476f'
const BLUE = '#3a86ff'
const RED_SOFT = '#ffd6df'
const BLUE_SOFT = '#d6e6ff'
const NEUTRAL_SOFT = '#f6efe0'
const NEUTRAL = '#eadfc8'
const BOMB_SOFT = '#4a4458'
const OUTFITS: Partial<Record<Slug, string>> = { dede: 'hacker', cycy: 'hacker' }

type Cell = 'red' | 'blue' | 'neutral' | 'bomb'
const WORDS = [
  'CHAT', 'PIZZA', 'LUNE', 'PIANO', 'PIRATE',
  'FUSÉE', 'LION', 'CLÉ', 'VOLCAN', 'TARTE',
  'ROBOT', 'VÉLO', 'REQUIN', 'ROI', 'NEIGE',
  'PLAGE', 'ÉPÉE', 'CITRON', 'HIBOU', 'TRAIN',
  'LAMPE', 'MICRO', 'GÂTEAU', 'PHARE', 'GOLF',
]
const KEY: Cell[] = (() => {
  const k: Cell[] = WORDS.map(() => 'neutral')
  for (const i of [0, 3, 6, 9, 11, 12, 16, 20, 24]) k[i] = 'red'
  for (const i of [1, 4, 7, 10, 14, 19, 21, 22]) k[i] = 'blue'
  k[8] = 'bomb'
  return k
})()
const CHAT = 0
const VOLCAN = 8
const HIBOU = 18

type Reveal = { idx: number; at: number; color: Cell }
type GridGeo = { cw: number; ch: number; gap: number; font: number }
const BIG: GridGeo = { cw: 128, ch: 100, gap: 8, font: 28 }
const gridW = (g: GridGeo) => 5 * g.cw + 4 * g.gap
const cellXY = (g: GridGeo, i: number) => ({ x: (i % 5) * (g.cw + g.gap), y: Math.floor(i / 5) * (g.ch + g.gap) })

/** Grille 5 × 5. `tinted` = vue de l'espion (toutes les couleurs) ; `reveals` = cartes retournées ; `flash` = cartes qui clignotent. */
const Grid: React.FC<{ f: number; geo?: GridGeo; tinted?: boolean; reveals?: Reveal[]; flash?: number[]; flashAt?: number; topText?: boolean; appear?: number; style?: React.CSSProperties }> = ({
  f, geo = BIG, tinted, reveals = [], flash = [], flashAt = 0, topText, appear = 0, style,
}) => {
  const blink = f >= flashAt && Math.floor((f - flashAt) / 6) % 2 === 0
  return (
    <div style={{ position: 'relative', width: gridW(geo), height: 5 * geo.ch + 4 * geo.gap, ...style }}>
      {WORDS.map((w, i) => {
        const { x, y } = cellXY(geo, i)
        const rv = reveals.find((r) => r.idx === i)
        const p = rv ? easeInOut(ramp(f, rv.at, rv.at + 10)) : 0
        const shown = p > 0.5
        let bg = '#ffffff'
        let color: string = C.ink
        if (shown && rv) {
          if (rv.color === 'red') { bg = RED; color = '#ffffff' } else if (rv.color === 'blue') { bg = BLUE; color = '#ffffff' } else if (rv.color === 'neutral') bg = NEUTRAL; else { bg = C.ink; color = '#ffffff' }
        } else if (tinted) {
          const c = KEY[i]
          if (c === 'red') bg = RED_SOFT; else if (c === 'blue') bg = BLUE_SOFT; else if (c === 'neutral') bg = NEUTRAL_SOFT; else { bg = BOMB_SOFT; color = '#ffffff' }
        }
        const flashing = flash.includes(i) && blink && !shown
        const pop = clamp01(sp(f, appear + (i % 5) * 1.5 + Math.floor(i / 5) * 2))
        return (
          <div
            key={w}
            style={{
              position: 'absolute', left: x, top: y, width: geo.cw, height: geo.ch, boxSizing: 'border-box', background: bg, color,
              border: `${geo.ch > 80 ? 5 : 4}px solid ${flashing ? RED : C.ink}`, borderRadius: geo.ch * 0.22, boxShadow: flashing ? `0 0 0 6px ${RED}` : `3px 3px 0 0 ${C.ink}`,
              fontFamily: DISPLAY, fontWeight: 800, fontSize: geo.font, lineHeight: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: topText ? 'flex-start' : 'center', paddingTop: topText ? geo.ch * 0.2 : 4, gap: 2,
              transform: `scale(${Math.max(0, pop)}) scaleX(${Math.max(0.02, Math.abs(1 - 2 * p))})`, opacity: clamp01(pop * 3),
            }}
          >
            {geo.ch > 80 && ((shown && rv?.color === 'bomb') || (!shown && tinted && KEY[i] === 'bomb')) && <span style={{ fontSize: geo.font * 1.1 }}>💣</span>}
            {w}
          </div>
        )
      })}
    </div>
  )
}

/** Tête d'un joueur posée sur une carte (par-dessus la moitié basse). */
const Head: React.FC<{ f: number; at: number; slug: Slug; idx: number; dx?: number; expr?: string; size?: number; gx: number; gy: number; geo?: GridGeo }> = ({
  f, at, slug, idx, dx = 0, expr = 'reflexion', size = 92, gx, gy, geo = BIG,
}) => {
  const { x, y } = cellXY(geo, idx)
  const s = sp(f, at)
  if (f < at) return null
  return (
    <div style={{ position: 'absolute', left: gx + x + (geo.cw - size) / 2 + dx, top: gy + y + geo.ch * 0.42 - (1 - s) * 140, zIndex: 8, transform: `rotate(${wiggle(f, at, 5, 30)}deg)` }}>
      <Chibi slug={slug} expression={expr} size={size} outfit={OUTFITS[slug]} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1 — Deux équipes, un espion chacune, puis la grille vue par l'espion
// ---------------------------------------------------------------------------
type TeamDef = { name: string; bg: string; col: string; spy: Slug; mates: Slug[]; mateSize: number }
const TEAMS: TeamDef[] = [
  { name: '🔴 Rouges', bg: RED_SOFT, col: RED, spy: 'dede', mates: ['kevin', 'manon', 'mika'], mateSize: 100 },
  { name: '🔵 Bleus', bg: BLUE_SOFT, col: BLUE, spy: 'cycy', mates: ['marius', 'cecile'], mateSize: 118 },
]
const Teams: MockScene = ({ f }) => {
  const out = easeInOut(ramp(f, 80, 92))
  const phoneAt = 90
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `translateY(${-out * 120}px)` }}>
        {TEAMS.map((t, k) => (
          <Pop key={t.name} f={f} at={2 + k * 8} from={60} rot={k ? 2 : -2} style={{ position: 'absolute', left: k ? 372 : 18, top: 30 }}>
            <Panel bg={t.bg} radius={40} style={{ width: 330, height: 640, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 22 }}>
              <Pill bg={t.col} color="#ffffff" size={38}>{t.name}</Pill>
              <div style={{ marginTop: 14, transform: `translateY(${bob(f, k * 14, 14, 24)}px) rotate(${wiggle(f, k * 9, 3)}deg)` }}>
                <Chibi slug={t.spy} expression="reflexion" size={230} outfit={OUTFITS[t.spy]} />
              </div>
              <Pop f={f} at={30 + k * 6} rot={-3}><Pill bg={C.sun} size={30}>🕵️ Espion</Pill></Pop>
              <div style={{ display: 'flex', marginTop: 26 }}>
                {t.mates.map((slug, i) => (
                  <div key={slug} style={{ marginLeft: i ? -t.mateSize * 0.12 : 0, transform: `translateY(${bob(f, k * 10 + i * 9, 12, 22)}px)` }}>
                    <Chibi slug={slug} expression="joie" size={t.mateSize} />
                  </div>
                ))}
              </div>
            </Panel>
          </Pop>
        ))}
        <div style={{ position: 'absolute', left: TW / 2 - 70, top: 270, transform: `scale(${sp(f, 18)}) rotate(-8deg)`, zIndex: 3 }}>
          <Outlined size={100} color={C.sun}>VS</Outlined>
        </div>
      </div>
      {f >= phoneAt - 4 && (
        <>
          <Pop f={f} at={phoneAt} from={160} rot={-1} style={{ position: 'absolute', left: 20, top: 10 }}>
            <Phone w={680} h={600}>
              <Grid f={f} geo={{ cw: 116, ch: 92, gap: 6, font: 24 }} tinted appear={phoneAt + 2} style={{ position: 'absolute', left: 11, top: 17 }} />
            </Phone>
          </Pop>
          <Pop f={f} at={phoneAt + 18} rot={4} style={{ position: 'absolute', right: 24, top: -6, zIndex: 10 }}>
            <Pill bg={C.sun} size={28}>🕵️ Vue de l’espion</Pill>
          </Pop>
          <div style={{ position: 'absolute', left: 6, top: 628 + (1 - sp(f, phoneAt + 6)) * 300 + bob(f, 0, 12, 24) }}>
            <Chibi slug="dede" expression={f >= phoneAt + 40 ? 'clin_oeil' : 'reflexion'} size={250} outfit="hacker" />
          </div>
          <Pop f={f} at={phoneAt + 40} rot={-2} style={{ position: 'absolute', left: 240, top: 690 }}>
            <Panel bg={C.surface} radius={30} style={{ padding: '14px 24px 8px', fontSize: 32, lineHeight: 1.12, width: 420 }}>
              🤫 Les autres ne voient<br />pas les couleurs
            </Panel>
          </Pop>
        </>
      )}
      <Sfx name="whoosh" at={2} volume={0.4} />
      <Sfx name="pop" at={22} volume={0.6} />
      <Sfx name="pop" at={34} volume={0.5} />
      <Sfx name="swoosh-up" at={phoneAt} volume={0.4} />
      <Sfx name="pop" at={phoneAt + 40} volume={0.6} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 2 — L'espion donne un indice : un mot et un nombre
// ---------------------------------------------------------------------------
const MINI: GridGeo = { cw: 96, ch: 56, gap: 5, font: 19 }
const CLUE = 'ANIMAL'
const Clue: MockScene = ({ f }) => {
  const typed = Math.max(0, Math.min(CLUE.length, Math.floor((f - 66) / 4)))
  const pick = f >= 100
  const sent = f >= 124
  const PX = 60
  const IN = 27
  return (
    <>
      <Pop f={f} at={0} from={120} rot={-1} style={{ position: 'absolute', left: PX, top: 0 }}>
        <Phone w={600} h={690}>
          <Grid f={f} geo={MINI} tinted flash={[0, 6, 12]} flashAt={16} appear={2} style={{ position: 'absolute', left: 23, top: 16 }} />
          <div style={{ position: 'absolute', left: 23, top: 338, width: 500, height: 70, boxSizing: 'border-box', background: C.surface, border: `5px solid ${C.ink}`, borderRadius: 20, fontFamily: DISPLAY, fontWeight: 800, fontSize: 40, letterSpacing: 4, display: 'flex', alignItems: 'center', padding: '0 20px', color: C.ink }}>
            {typed ? CLUE.slice(0, typed) : <span style={{ color: C.muted, letterSpacing: 0, fontSize: 30 }}>Ton indice…</span>}
            {typed > 0 && typed < CLUE.length && <span style={{ opacity: Math.floor(f / 8) % 2 }}>|</span>}
          </div>
          <div style={{ position: 'absolute', left: 23, top: 420, display: 'flex', gap: 12 }}>
            {[1, 2, 3, 4, 5].map((n) => {
              const on = pick && n === 3
              return (
                <Btn key={n} bg={on ? C.sun : C.sunk} size={44} w={90} h={70} pressed={on} style={{ borderRadius: 20, padding: '4px 0 0', transform: on ? `translate(3px, 3px) scale(${1 + 0.12 * Math.sin(ramp(f, 100, 110) * Math.PI)})` : undefined }}>{n}</Btn>
              )
            })}
          </div>
          <div style={{ position: 'absolute', left: 23, top: 502, width: 500 }}>
            <Btn bg={sent ? C.mint : C.tomato} color="#ffffff" size={38} w={500} h={70} pressed={sent} style={{ borderRadius: 20, padding: '4px 0 0' }}>{sent ? '✅ Envoyé !' : 'Envoyer'}</Btn>
          </div>
        </Phone>
      </Pop>
      <Finger f={f} taps={[
        { at: 100, x: PX + IN + 23 + 2 * 102 + 45, y: IN + 420 + 35 },
        { at: 124, x: PX + IN + 23 + 250, y: IN + 502 + 35 },
      ]} />
      <div style={{ position: 'absolute', left: 8, top: 700 + (1 - sp(f, 4)) * 300 + bob(f, 0, sent ? 24 : 10, sent ? 12 : 26) }}>
        <Chibi slug="dede" expression={sent ? 'joie' : 'reflexion'} size={190} outfit="hacker" />
      </div>
      <Pop f={f} at={104} rot={-2} style={{ position: 'absolute', left: 210, top: 752 }}>
        <Panel bg={C.sun} radius={30} style={{ padding: '12px 26px 6px', fontSize: 36, lineHeight: 1.1 }}>3 = trois mots à trouver</Panel>
      </Pop>
      <Sfx name="pop" at={4} volume={0.5} />
      {CLUE.split('').map((_, i) => <Sfx key={i} name="type" at={66 + i * 4} volume={0.5} />)}
      <Sfx name="tap" at={100} volume={0.6} />
      <Sfx name="pop" at={106} volume={0.6} />
      <Sfx name="tap" at={124} volume={0.6} />
      <Sfx name="success" at={128} volume={0.5} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 3 — Les têtes se posent sur un mot : la majorité dévoile
// ---------------------------------------------------------------------------
const GX = 24
const GY = 150
const Guess: MockScene = ({ f }) => {
  const ok = f >= 104
  return (
    <>
      <Pop f={f} at={0} rot={-2} style={{ position: 'absolute', left: 24, top: 0 }}>
        <Pill bg={RED} color="#ffffff" size={36}>🔎 ANIMAL · 3</Pill>
      </Pop>
      {f >= 66 && (
        <Pop f={f} at={66} rot={3} style={{ position: 'absolute', right: 24, top: 0 }}>
          <Pill bg={C.surface} size={34}>🗳️ 2 sur 3</Pill>
        </Pop>
      )}
      <Grid f={f} appear={2} topText reveals={[{ idx: CHAT, at: 104, color: 'red' }]} style={{ position: 'absolute', left: GX, top: GY }} />
      <Head f={f} at={34} slug="kevin" idx={CHAT} dx={-26} gx={GX} gy={GY} />
      <Head f={f} at={62} slug="manon" idx={CHAT} dx={26} gx={GX} gy={GY} />
      <div style={{ position: 'absolute', left: 14, top: 700 + (1 - sp(f, 6)) * 300 + bob(f, 0, ok ? 30 : 6, ok ? 12 : 30) }}>
        <Chibi slug="dede" expression={ok ? 'joie' : 'clin_oeil'} size={190} outfit="hacker" />
      </div>
      {ok && (
        <Pop f={f} at={112} rot={-2} style={{ position: 'absolute', left: 200, top: 750 }}>
          <Panel bg={C.mint} radius={30} style={{ padding: '12px 22px 6px', fontSize: 30, lineHeight: 1.1, whiteSpace: 'nowrap' }}>✅ Bon mot : vous continuez !</Panel>
        </Pop>
      )}
      <ConfettiBurst f={f} at={108} x={GX + 64} y={GY + 60} n={26} seed="ndc3" />
      <Sfx name="whoosh" at={34} volume={0.35} />
      <Sfx name="pop" at={40} volume={0.5} />
      <Sfx name="pop" at={68} volume={0.6} />
      <Sfx name="swoosh-up" at={104} volume={0.4} />
      <Sfx name="success" at={108} volume={0.6} />
    </>
  )
}

// ---------------------------------------------------------------------------
// 4 — Neutre : le tour passe. Bombe : l'équipe est éliminée
// ---------------------------------------------------------------------------
const BOOM = 96
const Bomb: MockScene = ({ f }) => {
  const neutral = f >= 34 && f < 70
  const boom = f >= BOOM
  const sinceBoom = f - BOOM
  const shake = boom && sinceBoom < 22 ? Math.sin(sinceBoom * 2.4) * (14 - sinceBoom * 0.6) : 0
  const bluePhase = f >= 74
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `translate(${shake}px, ${shake * 0.5}px)` }}>
      <div style={{ position: 'absolute', left: 24, top: 0 }}>
        <Pill bg={bluePhase ? BLUE : RED} color="#ffffff" size={34}>{bluePhase ? '🔵 Tour des Bleus' : '🔴 Tour des Rouges'}</Pill>
      </div>
      <Grid f={f} appear={0} topText
        reveals={[{ idx: CHAT, at: -30, color: 'red' }, { idx: HIBOU, at: 34, color: 'neutral' }, { idx: VOLCAN, at: BOOM, color: 'bomb' }]}
        style={{ position: 'absolute', left: GX, top: 90 }} />
      {f < 74 && <Head f={f} at={12} slug="kevin" idx={HIBOU} dx={-24} gx={GX} gy={90} expr={f >= 34 ? 'boude' : 'reflexion'} />}
      {f < 74 && <Head f={f} at={16} slug="manon" idx={HIBOU} dx={26} gx={GX} gy={90} expr={f >= 34 ? 'boude' : 'reflexion'} />}
      {bluePhase && !boom && <Head f={f} at={78} slug="marius" idx={VOLCAN} dx={-24} gx={GX} gy={90} />}
      {neutral && (
        <Pop f={f} at={38} rot={-2} style={{ position: 'absolute', left: 120, top: 665 }}>
          <Pill bg={C.surface} size={36}>😬 Neutre : aux Bleus !</Pill>
        </Pop>
      )}
      {f < 74 && (
        <div style={{ position: 'absolute', left: 20, top: 690 + (1 - sp(f, 4)) * 300 + bob(f, 0, f >= 34 ? 4 : 10, 28) }}>
          <Chibi slug="kevin" expression={f >= 34 ? 'boude' : 'reflexion'} size={190} />
        </div>
      )}
      {bluePhase && (
        <>
          {([['marius', 20, 'surprise'], ['cecile', 240, 'surprise'], ['cycy', 460, 'pleurs']] as [Slug, number, string][]).map(([slug, x, ex], k) => (
            <div key={slug} style={{ position: 'absolute', left: x, top: 690 + (1 - sp(f, 76 + k * 3)) * 300 + bob(f, k * 7, boom ? 4 : 14, 26) + (boom && k === 2 ? 6 : 0) }}>
              <Chibi slug={slug} expression={boom ? ex : 'reflexion'} size={200} outfit={OUTFITS[slug]} />
            </div>
          ))}
        </>
      )}
      {boom && (
        <>
          <div style={{ position: 'absolute', left: GX + cellXY(BIG, VOLCAN).x - 40, top: 90 + cellXY(BIG, VOLCAN).y - 60, fontSize: 230, lineHeight: 1, opacity: 1 - ramp(f, BOOM + 6, BOOM + 30), transform: `scale(${0.4 + ramp(f, BOOM, BOOM + 10) * 1.3})`, zIndex: 12 }}>💥</div>
          <Pop f={f} at={BOOM + 6} rot={-6} style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center', zIndex: 13 }}>
            <Outlined size={92} color={C.tomato}>💣 Boum !</Outlined>
          </Pop>
        </>
      )}
      <Sfx name="whoosh" at={12} volume={0.35} />
      <Sfx name="swoosh-up" at={34} volume={0.4} />
      <Sfx name="tap" at={40} volume={0.5} />
      <Sfx name="whoosh" at={78} volume={0.35} />
      <Sfx name="jingle" at={BOOM} volume={0.5} />
      <Sfx name="pop" at={BOOM + 2} volume={0.8} />
    </div>
  )
}

export const nomDeCode: TutoSpec = {
  id: 'nom-de-code',
  name: 'Nom de Code',
  emoji: '🔐',
  color: '#5EE6A8',
  players: '4 à 9 joueurs',
  goal: 'Fais deviner tous tes mots à ton équipe… sans toucher la bombe !',
  cast: ['dede', 'kevin', 'manon', 'cycy', 'marius'],
  outfits: OUTFITS,
  steps: [
    { text: 'En équipes : seul l’espion voit quels mots sont les vôtres', seconds: 5.2, Mock: Teams },
    { text: 'L’espion donne un indice : UN seul mot et un nombre', seconds: 5.6, Mock: Clue },
    { text: 'Pose ta tête sur un mot : la majorité de l’équipe dévoile', seconds: 5.6, Mock: Guess },
    { text: 'Raté ? Le tour passe. La bombe 💣 ? Ton équipe est éliminée !', seconds: 5.2, Mock: Bomb },
  ],
  win: {
    text: 'La première équipe qui trouve tous ses mots gagne !',
    sub: 'De 2 à 4 équipes. Sans chrono, ou avec, au choix de l’hôte.',
    winners: ['dede', 'kevin', 'manon', 'mika'],
  },
}

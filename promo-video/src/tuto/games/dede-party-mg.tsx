// Clips « échauffement » des 6 mini-jeux de Dédé Party : 6 s, muets, en boucle (632 × 422, 30 FPS). Ils passent pendant
// l'annonce du mini-jeu, au téléphone et à la télé (src/games/dede-party/MgClip.tsx). Même vocabulaire que la revue des
// mini-jeux du tuto (dede-party.tsx, dont on reprend les briques) : un doigt fait le geste, le résultat tombe
// (« +10 🪙 », le gain du 1er), une seule ligne de texte. Image 0 = état de départ, et les 9 dernières images y
// reviennent en fondu : la boucle est propre.
// Rendu : npm run render:mg → public/tutos/dede-party/mg-<id>.mp4.
import React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, DISPLAY, sticker, type Slug } from '../../theme'
import { Avatar, ConfettiBurst, Finger, Panel, Pill, Pop, SPRING, nb, ramp, sp, wiggle, type Tap } from '../kit'
import { BH, BTN, BW, Emo, OUTFITS, Tag } from './dede-party'

export const MG_W = BW
export const MG_H = BH
export const MG_FRAMES = 180
const FADE = 9
type Scene = React.FC<{ g: number }>

const Stage: React.FC<{ bg: string; children: React.ReactNode }> = ({ bg, children }) => (
  <div style={{ position: 'absolute', inset: 0, background: bg, overflow: 'hidden', isolation: 'isolate' }}>{children}</div>
)
/** La ligne de texte du clip, en bas. */
const Caption: React.FC<{ bg: string; children: React.ReactNode }> = ({ bg, children }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: 362, display: 'flex', justifyContent: 'center', zIndex: 60 }}>
    <Pill bg={bg} size={26}>{children}</Pill>
  </div>
)
/** Le résultat : « +10 🪙 » (gain du 1er) qui surgit avec quelques confettis. */
const Gain: React.FC<{ g: number; at: number; x?: number; y: number }> = ({ g, at, x = BW / 2, y }) => (
  <>
    <ConfettiBurst f={g} at={at} x={x} y={y} n={14} seed="mg" />
    <Pop f={g} at={at} rot={-4} style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, zIndex: 45 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-50%, -50%)' }}>
        <Pill bg={C.sun} size={56} style={{ boxShadow: sticker(7), border: `5px solid ${C.ink}` }}>+10 🪙</Pill>
      </div>
    </Pop>
  </>
)

// --- Questions pour un Dédé : deux questions éclair, on tape la bonne réponse ---
const QUIZ = [
  { q: 'Capitale de l’Italie ?', a: ['Milan', 'Rome', 'Naples', 'Venise'], ok: 1, from: 0, tap: 46 },
  { q: 'Pattes d’une araignée ?', a: ['4', '6', '8', '10'], ok: 2, from: 76, tap: 112 },
]
const qXY = (i: number): [number, number] => [36 + (i % 2) * 290, 150 + Math.floor(i / 2) * 90]
const Q_TAPS: Tap[] = QUIZ.map((q) => ({ at: q.tap, x: qXY(q.ok)[0] + 234, y: qXY(q.ok)[1] + 60 }))
const MgQuiz: Scene = ({ g }) => {
  const k = g >= QUIZ[1].from ? 1 : 0
  const cur = QUIZ[k]
  const hit = g >= cur.tap + 2
  return (
    <Stage bg="#DFF4FF">
      <div style={{ position: 'absolute', left: 36, top: 10 }}><Pill bg={C.surface} size={22}>Question {k + 1} / 3</Pill></div>
      <div style={{ position: 'absolute', left: 262, top: 22, width: 334, height: 20, boxSizing: 'border-box', border: `4px solid ${C.ink}`, borderRadius: 10, background: C.sunk, overflow: 'hidden' }}>
        <div style={{ width: `${100 - (Math.min(g, cur.tap) - cur.from) * 0.9}%`, height: '100%', background: C.mint }} />
      </div>
      <div style={{ position: 'absolute', left: 0, top: 0, width: BW, height: BH, transformOrigin: '316px 190px', transform: `scale(${k ? 0.88 + 0.12 * sp(g, cur.from, SPRING.snappy) : 1})` }}>
        <Panel radius={22} shadow={5} style={{ ...BTN, left: 36, top: 62, width: 560, height: 72, fontSize: 36, paddingTop: 4 }}>{nb(cur.q)}</Panel>
        {cur.a.map((t, i) => {
          const on = hit && i === cur.ok
          return <Panel key={i} bg={on ? C.mint : C.surface} radius={20} shadow={on ? 2 : 5} style={{ ...BTN, left: qXY(i)[0], top: qXY(i)[1], width: 270, height: 76, fontSize: 36, paddingTop: 4 }}>{on ? '✅ ' : ''}{t}</Panel>
        })}
      </div>
      <Gain g={g} at={126} y={236} />
      <Finger f={g} taps={Q_TAPS} />
      <Caption bg="#4CC9F0">👆 Tape la bonne réponse, vite !</Caption>
    </Stage>
  )
}

// --- Au pif : on tape un nombre au clavier, puis « Valider » ---
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫']
const kXY = (k: number): [number, number] => [344 + (k % 3) * 92, 96 + Math.floor(k / 3) * 64]
const TYPED = [{ at: 28, k: 0 }, { at: 44, k: 4 }, { at: 60, k: 10 }, { at: 74, k: 10 }]
const SHOWN = ['', '1', '15', '150', '1 500']
const P_OK = 96
const P_TAPS: Tap[] = [...TYPED.map((t) => ({ at: t.at, x: kXY(t.k)[0] + 46, y: kXY(t.k)[1] + 34 })), { at: P_OK, x: 276, y: 262 }]
const MgPif: Scene = ({ g }) => {
  const n = TYPED.filter((t) => g >= t.at).length
  const sent = g >= P_OK + 2
  return (
    <Stage bg="#FFE9D2">
      <Panel radius={22} shadow={5} style={{ ...BTN, left: 20, top: 14, width: 592, height: 66, fontSize: 30, paddingTop: 4 }}>{nb('Combien de marches à la tour Eiffel ?')}</Panel>
      <Panel bg={sent ? C.mint : C.surface} radius={22} shadow={5} style={{ ...BTN, left: 20, top: 100, width: 300, height: 84, justifyContent: n ? 'flex-end' : 'flex-start', gap: 5, padding: '6px 18px 0', fontSize: n ? 54 : 26, lineHeight: 1, color: n ? C.ink : C.muted }}>
        {n ? SHOWN[n] : 'Ton estimation'}
        {n > 0 && !sent && <span style={{ width: 4, height: 48, marginBottom: 6, background: C.ink, opacity: Math.floor(g / 8) % 2 ? 0 : 1 }} />}
      </Panel>
      <Panel bg={sent ? C.mint : n === 4 ? C.sun : C.sunk} radius={22} shadow={g >= P_OK && g < P_OK + 6 ? 2 : 5} style={{ ...BTN, left: 20, top: 204, width: 300, height: 74, fontSize: 36, paddingTop: 4, color: n === 4 ? C.ink : C.muted }}>
        {sent ? '✅ Envoyé !' : '✅ Valider'}
      </Panel>
      {KEYS.map((key, k) => {
        const down = TYPED.some((t) => t.k === k && g >= t.at && g < t.at + 5)
        return <Panel key={key} bg={down ? C.sunk : C.surface} radius={14} shadow={down ? 1 : 4} style={{ ...BTN, left: kXY(k)[0], top: kXY(k)[1], width: 84, height: 56, fontSize: 34, paddingTop: 4 }}>{key}</Panel>
      })}
      <Tag f={g} from={108} p={[170, 320]} bg={C.mint}>✅ C’était 1 665</Tag>
      <Gain g={g} at={120} x={478} y={222} />
      <Finger f={g} taps={P_TAPS} />
      <Caption bg="#FFB570">🔢 Tape un nombre : le plus proche gagne !</Caption>
    </Stage>
  )
}

// --- Comme tout le monde : on choisit un joueur, on vote, la majorité se dessine ---
const MAJ: { slug: Slug; name: string; votes: number[] }[] = [
  { slug: 'kevin', name: 'Keke', votes: [] },
  { slug: 'dede', name: 'Dédé', votes: [90] },
  { slug: 'mika', name: 'Mika', votes: [70, 84, 96] },
  { slug: 'manon', name: 'Manon', votes: [] },
]
const M_PICK = 38
const M_VOTE = 68
const M_WIN = 104
const MgMajo: Scene = ({ g }) => {
  const picked = g >= M_PICK + 2
  const voted = g >= M_VOTE + 2
  return (
    <Stage bg="#FFE1E8">
      <Panel radius={22} shadow={5} style={{ ...BTN, left: 36, top: 14, width: 560, height: 66, fontSize: 34, paddingTop: 4 }}>{nb('Qui est le plus gourmand ?')}</Panel>
      {MAJ.map((v, i) => {
        const n = v.votes.filter((t) => g >= t).length
        const on = i === 2 && picked
        const bump = Math.max(0, ...v.votes.map((t) => 1 - Math.abs(g - t - 3) / 4))
        return (
          <Panel key={v.slug} bg={on ? C.sun : C.surface} radius={22} shadow={5} style={{ position: 'absolute', left: 30 + i * 146, top: 100, width: 134, height: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, border: `4px solid ${C.ink}`, transform: `scale(${1 + 0.1 * bump})`, zIndex: n ? 2 : 1 }}>
            <Avatar slug={v.slug} expression={i === 2 && g >= M_WIN ? 'surprise' : 'joie'} size={86} outfit={OUTFITS[v.slug]} />
            <div style={{ fontSize: 27, lineHeight: 1 }}>{v.name}</div>
            {n > 0 && (
              <div style={{ position: 'absolute', right: -12, top: -16 }}>
                <Pill bg={C.surface} size={22} style={{ boxShadow: sticker(3), border: `3px solid ${C.ink}` }}>🫵 {n}</Pill>
              </div>
            )}
          </Panel>
        )
      })}
      <Panel bg={voted ? C.mint : picked ? C.sun : C.sunk} radius={22} shadow={g >= M_VOTE && g < M_VOTE + 6 ? 2 : 5} style={{ ...BTN, left: 126, top: 268, width: 380, height: 72, fontSize: 34, paddingTop: 4, color: picked ? C.ink : C.muted }}>
        {voted ? '✅ A voté !' : picked ? 'Je vote Mika !' : 'Choisis quelqu’un'}
      </Panel>
      <Gain g={g} at={112} y={302} />
      <Finger f={g} taps={[{ at: M_PICK, x: 392, y: 192 }, { at: M_VOTE, x: 456, y: 324 }]} />
      <Caption bg="#FF8FA3">🫵 Vote comme la majorité !</Caption>
    </Stage>
  )
}

// --- Le Buzzer : le doigt attend au-dessus de l'écran rouge, et tape dès qu'il passe au vert ---
const B_GREEN = 64
const B_TAP = 73
const MgBuzz: Scene = ({ g }) => {
  const green = g >= B_GREEN
  // Le doigt arrive tôt, reste en l'air pendant le rouge, puis tape (frame 71 de son horloge = B_TAP).
  const ff = g < 68 ? Math.min(g + 30, 66) : g - 2
  return (
    <Stage bg={green ? C.mint : C.tomato}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: green ? 36 : 84, textAlign: 'center', fontSize: green ? 96 : 60, lineHeight: 1.05, color: green ? C.ink : '#ffffff', transform: `scale(${green ? 1 + 0.1 * Math.sin(ramp(g, B_GREEN, B_GREEN + 8) * Math.PI) : 1})` }}>
        {green ? '⚡ TAPE !' : <>✋ Attends<br />le vert…</>}
      </div>
      <Pop f={g} at={B_TAP + 2} from={40} style={{ position: 'absolute', left: 166, top: 150 }}>
        <Panel radius={26} shadow={6} style={{ width: 300, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 58, lineHeight: 1, paddingTop: 8 }}>0,287 s</Panel>
      </Pop>
      <Gain g={g} at={92} y={302} />
      <Finger f={ff} taps={[{ at: 71, x: 316, y: 262 }]} />
      <Caption bg={C.surface}>🟢 Dès que c’est vert : tape !</Caption>
    </Stage>
  )
}

// --- Pluie d'étoiles : on tape les étoiles, on laisse tomber les tomates ---
const RAIN: { e: string; x: number; v: number; d: number; hit?: number }[] = [
  { e: '⭐', x: 110, v: 5, d: 4, hit: 38 },
  { e: '🍅', x: 250, v: 4.6, d: 10 },
  { e: '⭐', x: 420, v: 5.4, d: 30, hit: 66 },
  { e: '⭐', x: 540, v: 4.4, d: 20, hit: 96 },
  { e: '🍅', x: 330, v: 5.2, d: 70 },
  { e: '⭐', x: 180, v: 4.8, d: 62, hit: 122 },
  { e: '⭐', x: 470, v: 5, d: 104 },
  { e: '⭐', x: 70, v: 5, d: 118 },
]
const rainY = (d: { v: number; d: number }, g: number) => -40 + (g - d.d) * d.v
const CAUGHT: Tap[] = RAIN.flatMap((d) => (d.hit === undefined ? [] : [{ at: d.hit, x: d.x, y: rainY(d, d.hit) }]))
const MgStars: Scene = ({ g }) => (
  <Stage bg="#2A2458">
    {RAIN.map((d, i) => {
      const gone = d.hit !== undefined && g >= d.hit
      const pop = gone ? ramp(g, d.hit!, d.hit! + 5) : 0
      if (g < d.d || pop >= 1) return null
      return <Emo key={i} p={[d.x, rainY(d, gone ? d.hit! : g)]} size={62 * (1 + pop * 0.8)} rot={g * 3 + i * 40}><span style={{ opacity: 1 - pop }}>{d.e}</span></Emo>
    })}
    {CAUGHT.map((h) => <Tag key={h.at} f={g} from={h.at + 2} to={h.at + 16} p={[h.x + (h.x > 480 ? -70 : 70), h.y - 24]} bg={C.sun}>+1</Tag>)}
    <div style={{ position: 'absolute', right: 14, top: 12, zIndex: 9 }}><Pill bg={C.surface} size={30}>⭐ {CAUGHT.filter((h) => g >= h.at).length}</Pill></div>
    <Gain g={g} at={140} y={196} />
    <Finger f={g} taps={CAUGHT} />
    <Caption bg="#B79CFF">⭐ Tape les étoiles, pas les tomates 🍅</Caption>
  </Stage>
)

// --- Top chrono : on lance, le chrono se cache après 3 s, on l'arrête pile à 7,00 s (temps accéléré dans le clip) ---
const C_GO = 22
const C_STOP = 112
const MgChrono: Scene = ({ g }) => {
  const t = g < C_GO ? 0 : ((Math.min(g, C_STOP) - C_GO) / (C_STOP - C_GO)) * 7.02
  const started = g >= C_GO + 2
  const stopped = g >= C_STOP
  const hidden = !stopped && t >= 3
  return (
    <Stage bg="#DFF9EE">
      <div style={{ position: 'absolute', left: 0, right: 0, top: 12, display: 'flex', justifyContent: 'center' }}><Pill bg={C.sun} size={28}>🎯 Objectif : 7,00 s</Pill></div>
      <Panel bg={stopped ? C.sun : C.surface} radius={28} shadow={7} style={{ ...BTN, left: 106, top: 78, width: 420, height: 108, fontSize: 78, lineHeight: 1, paddingTop: 10, fontVariantNumeric: 'tabular-nums', transform: `rotate(${hidden ? wiggle(g, 0, 2, 12) : 0}deg) scale(${1 + 0.1 * Math.sin(ramp(g, C_STOP, C_STOP + 8) * Math.PI)})` }}>
        {hidden ? '❓,❓❓ s' : `${t.toFixed(2).replace('.', ',')} s`}
      </Panel>
      <Panel bg={started ? C.tomato : C.sun} radius={26} shadow={(g >= C_GO && g < C_GO + 6) || (g >= C_STOP && g < C_STOP + 6) ? 2 : 6} style={{ ...BTN, left: 126, top: 206, width: 380, height: 80, fontSize: started ? 46 : 34, color: started ? '#ffffff' : C.ink, paddingTop: 6 }}>
        {started ? '✋ STOP !' : '▶ Lancer le chrono'}
      </Panel>
      <Gain g={g} at={124} y={252} />
      <Finger f={g} taps={[{ at: C_GO, x: 462, y: 270 }, { at: C_STOP, x: 462, y: 270 }]} />
      <Caption bg="#06D6A0">✋ Stoppe pile à 7,00 s… même caché 🙈</Caption>
    </Stage>
  )
}

/** Les ids sont ceux de `MgKind` (src/games/dede-party/types.ts) : ils nomment les fichiers mg-<id>.mp4. */
export const MG_CLIPS: { id: string; Scene: Scene }[] = [
  { id: 'quiz', Scene: MgQuiz },
  { id: 'pif', Scene: MgPif },
  { id: 'majorite', Scene: MgMajo },
  { id: 'buzzer', Scene: MgBuzz },
  { id: 'etoiles', Scene: MgStars },
  { id: 'chrono', Scene: MgChrono },
]

export const MgClip: React.FC<{ id: string }> = ({ id }) => {
  const f = useCurrentFrame()
  const clip = MG_CLIPS.find((c) => c.id === id)
  if (!clip) throw new Error(`Clip de mini-jeu inconnu : ${id}`)
  const back = ramp(f, MG_FRAMES - FADE, MG_FRAMES)
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', fontFamily: DISPLAY, fontWeight: 800, color: C.ink }}>
      <clip.Scene g={f} />
      {back > 0 && <div style={{ position: 'absolute', inset: 0, opacity: back }}><clip.Scene g={0} /></div>}
    </div>
  )
}

/** Planche de contrôle (dev) : une ligne par clip, 4 instants (frame, +45, +90, +135). `npx remotion still src/index.ts MgSheet out/mg-sheet.png --frame=30` */
export const MG_SHEET_COLS = [0, 45, 90, 135]
export const MgSheet: React.FC = () => {
  const f = useCurrentFrame()
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.ink, fontFamily: DISPLAY, fontWeight: 800, color: C.ink }}>
      {MG_CLIPS.map((c, i) => MG_SHEET_COLS.map((dt, j) => (
        <div key={`${c.id}-${j}`} style={{ position: 'absolute', left: j * MG_W, top: i * MG_H, width: MG_W, height: MG_H, overflow: 'hidden' }}><c.Scene g={f + dt} /></div>
      )))}
    </div>
  )
}

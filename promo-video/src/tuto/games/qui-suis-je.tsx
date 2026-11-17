// Tuto « Qui suis-je ? » : téléphone sur le front, on incline vers le bas (trouvé) ou vers le haut (passer).
import React from 'react'
import { C, type Slug } from '../../theme'
import { Bubble, Chibi, ConfettiBurst, Outlined, Pill, Pop, Sfx, TW, bob, easeInOut, ramp, sp, wiggle } from '../kit'
import { Phone, TimerBar } from '../parts'
import type { MockScene, TutoSpec } from '../types'

const Screen: React.FC<{ word: string; sub?: string; bg?: string; size?: number }> = ({ word, sub, bg = C.surface, size = 60 }) => (
  <div style={{ position: 'absolute', inset: 0, background: bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', color: C.ink }}>
    <Outlined size={size} color={C.ink} stroke={0} style={{ WebkitTextStroke: '0', textShadow: 'none', letterSpacing: 0 }}>{word}</Outlined>
    {sub && <Outlined size={size * 0.42} color={C.muted} stroke={0} style={{ WebkitTextStroke: '0', textShadow: 'none', letterSpacing: 0 }}>{sub}</Outlined>}
  </div>
)

/** Le devineur, téléphone collé au front. */
const Guesser: React.FC<{ f: number; top: number; word: string; expr?: string; at?: number; size?: number }> = ({ f, top, word, expr = 'reflexion', at = 0, size = 400 }) => {
  const on = easeInOut(ramp(f, at + 10, at + 26))
  return (
    <div style={{ position: 'absolute', left: (TW - size) / 2, top: top + (1 - sp(f, at)) * 500 + bob(f, 0, 8, 28), width: size, height: size }}>
      <Chibi slug="kevin" expression={expr} size={size} />
      <div style={{ position: 'absolute', left: size * 0.16, top: size * -0.02 - (1 - on) * 240, opacity: on, transform: `rotate(${-4 + (1 - on) * -20 + wiggle(f, 0, 1.5)}deg)` }}>
        <Phone w={size * 0.68} h={size * 0.34}><Screen word={word} size={size * 0.12} /></Phone>
      </div>
    </div>
  )
}

// 1 — Le téléphone sur le front
const Forehead: MockScene = ({ f }) => (
  <>
    <Guesser f={f} top={110} word="ASTÉRIX" at={4} size={430} />
    <Pop f={f} at={40} rot={-3} style={{ position: 'absolute', left: 60, top: 0 }}>
      <Pill bg={C.sun} size={40}>🙈 Lui ne voit pas la carte…</Pill>
    </Pop>
    {(['cycy', 'dede', 'mika'] as const).map((slug, k) => (
      <div key={slug} style={{ position: 'absolute', left: 60 + k * 205, top: 610 + (k % 2) * 20 + (1 - sp(f, 50 + k * 5)) * 400 + bob(f, k * 9, 20, 16), transform: `rotate(${wiggle(f, k * 8, 4)}deg)` }}>
        <Chibi slug={slug} expression="joie" size={190} />
      </div>
    ))}
    <Pop f={f} at={72} rot={3} style={{ position: 'absolute', left: 250, top: 790 }}>
      <Pill bg={C.surface} size={36}>…mais les autres, si !</Pill>
    </Pop>
    <Sfx name="whoosh" at={14} volume={0.45} />
    <Sfx name="pop" at={48} volume={0.5} />
    <Sfx name="pop" at={78} volume={0.5} />
  </>
)

// 2 — Les autres font deviner
const CLUES: { slug: Slug; text: string; at: number; left: boolean }[] = [
  { slug: 'cycy', text: 'C’est un Gaulois !', at: 16, left: true },
  { slug: 'dede', text: 'Petit, avec une moustache', at: 52, left: false },
  { slug: 'mika', text: 'Il adore la potion !', at: 88, left: true },
]
const Clues: MockScene = ({ f }) => (
  <>
    <Guesser f={f} top={500} word="ASTÉRIX" at={-99} size={340} expr={f > 118 ? 'surprise' : 'reflexion'} />
    {CLUES.map((c, k) => {
      const talking = f >= c.at && f < c.at + 34
      return (
        <React.Fragment key={c.slug}>
          <div style={{ position: 'absolute', [c.left ? 'left' : 'right']: 24, top: 0 + k * 168 + bob(f, k * 9, talking ? 16 : 5, talking ? 12 : 30), opacity: sp(f, k * 3) }}>
            <Chibi slug={c.slug} expression={talking ? 'joie' : 'clin_oeil'} size={160} />
          </div>
          <Pop f={f} at={c.at} rot={c.left ? -2 : 2} style={{ position: 'absolute', [c.left ? 'left' : 'right']: 186, top: k * 168 + 34 }}>
            <Bubble tail={c.left ? 'left' : 'right'} size={36}>{c.text}</Bubble>
          </Pop>
          <Sfx name="pop" at={c.at + 8} volume={0.55} />
        </React.Fragment>
      )
    })}
    <Pop f={f} at={124} rot={-6} style={{ position: 'absolute', left: 30, top: 600 }}>
      <Outlined size={64} color={C.sun}>Astérix ?!</Outlined>
    </Pop>
    <Pop f={f} at={30} rot={3} style={{ position: 'absolute', left: 470, top: 700 }}>
      <Pill bg={C.surface} size={30}>🗣️ À l’oral,<br />mimes permis</Pill>
    </Pop>
  </>
)

/** Gros téléphone qui bascule (rotation 3D) puis change d'écran. */
const Tilt: React.FC<{ f: number; dir: 1 | -1; word: string; next: string; okBg: string; okText: string; at: number }> = ({ f, dir, word, next, okBg, okText, at }) => {
  const t = easeInOut(ramp(f, at, at + 14)) * (1 - easeInOut(ramp(f, at + 44, at + 58)))
  const flash = f >= at + 10 && f < at + 50
  const after = f >= at + 50
  return (
    <div style={{ position: 'absolute', left: (TW - 600) / 2, top: 170, perspective: 900 }}>
      <div style={{ transform: `rotateX(${dir * -58 * t}deg) translateY(${dir * 50 * t}px) scale(${sp(f, 0)})`, transformOrigin: '50% 50%' }}>
        <Phone w={600} h={310}>
          <Screen word={flash ? okText : after ? next : word} sub={flash ? undefined : 'Dessin animé'} bg={flash ? okBg : C.surface} size={flash ? 84 : 76} />
        </Phone>
      </div>
    </div>
  )
}
const Arrow: React.FC<{ f: number; at: number; down: boolean; color: string }> = ({ f, at, down, color }) => (
  <Pop f={f} at={at - 16} style={{ position: 'absolute', left: TW / 2 - 60, top: down ? 500 : 20 }}>
    <div style={{ transform: `translateY(${(down ? 1 : -1) * Math.abs(Math.sin(f / 6)) * 18}px)` }}>
      <Outlined size={130} color={color}>{down ? '⬇' : '⬆'}</Outlined>
    </div>
  </Pop>
)
const Hud: React.FC<{ f: number; dur: number; score: number; from: number }> = ({ f, dur, score, from }) => (
  <div style={{ position: 'absolute', left: 40, right: 40, top: 690, display: 'flex', alignItems: 'center', gap: 16 }}>
    <div style={{ fontSize: 40, lineHeight: 1 }}>⏱️</div>
    <TimerBar p={from + ramp(f, 0, dur) * 0.25} width={360} />
    <Pill bg={C.sun} size={40}>🃏 {score}</Pill>
  </div>
)

// 3 — Trouvé : on incline vers le bas
const AT = 50
const Found: MockScene = ({ f, dur }) => (
  <>
    <Tilt f={f} dir={1} word="ASTÉRIX" next="PIKACHU" okBg={C.mint} okText="✅ Trouvé !" at={AT} />
    <Arrow f={f} at={AT} down color={C.mint} />
    <Hud f={f} dur={dur} score={f >= AT + 12 ? 3 : 2} from={0.3} />
    <Pop f={f} at={AT + 16} rot={-3} style={{ position: 'absolute', left: 0, right: 0, top: 780, display: 'flex', justifyContent: 'center' }}>
      <Pill bg={C.mint} size={38}>+1 carte, et on enchaîne !</Pill>
    </Pop>
    <ConfettiBurst f={f} at={AT + 10} y={320} seed="qsj" n={24} />
    <Sfx name="whoosh" at={AT} volume={0.45} />
    <Sfx name="success" at={AT + 10} volume={0.55} />
  </>
)

// 4 — On sèche : on incline vers le haut
const Skip: MockScene = ({ f, dur }) => (
  <>
    <Tilt f={f} dir={-1} word="PIKACHU" next="OBÉLIX" okBg={C.tangerine} okText="⏭️ Passé" at={AT} />
    <Arrow f={f} at={AT} down={false} color={C.tangerine} />
    <Hud f={f} dur={dur} score={3} from={0.6} />
    <Pop f={f} at={AT + 16} rot={2} style={{ position: 'absolute', left: 0, right: 0, top: 780, display: 'flex', justifyContent: 'center' }}>
      <Pill bg={C.surface} size={38}>Pas de point, carte suivante</Pill>
    </Pop>
    <Sfx name="whoosh" at={AT} volume={0.45} />
    <Sfx name="tap" at={AT + 10} volume={0.9} />
  </>
)

export const quiSuisJe: TutoSpec = {
  id: 'qui-suis-je',
  name: 'Qui suis-je ?',
  emoji: '🙈',
  color: '#FF8FA3',
  players: '2 à 9 joueurs',
  goal: 'Devine la carte collée sur ton front !',
  cast: ['kevin', 'cycy', 'dede', 'mika'],
  steps: [
    { text: 'Pose ton téléphone sur ton front, écran vers les autres', seconds: 5, Mock: Forehead },
    { text: 'Les autres te font deviner à l’oral', seconds: 5.6, Mock: Clues },
    { text: 'Trouvé ? Incline le téléphone vers le bas', seconds: 4.8, Mock: Found },
    { text: 'Tu sèches ? Incline vers le haut pour passer', seconds: 4.8, Mock: Skip },
  ],
  win: {
    text: 'Chacun son tour : un maximum de cartes avant la fin du chrono !',
    sub: 'Les boutons « Trouvé » et « Passer » marchent aussi.',
    winners: ['kevin'],
  },
}

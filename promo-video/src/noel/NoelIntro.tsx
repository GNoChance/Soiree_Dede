// Vidéo d'annonce « Noël chez Dédé » v2 (composition `NoelIntro`) : 45 s, 720×1280, 30 FPS, musique à 120 à la noire.
// Assemblage : le chibi de Kéké qui parle → présage → rafale → glaçon → l'éclat de Noël (12,0 s) → 5 temps « pub ».
// Textes et repères : script.ts · prise, givre, glaçon : take.tsx · scènes : scenes.tsx · effets : fx.tsx.
import React from 'react'
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Audio } from '@remotion/media'
import { Garland, N, WIPE_FRAMES, WipeFlake, WipeLayer, wipeClip, sec, type WipeKind } from './fx'
import { Noel } from './scenes'
import { Hotte, Missions } from './scenes-b'
import { GrandeHotte, Pass, Rdv } from './scenes-c'
import { Sfx } from './sfx'
import { MUSIC_SILENCES, MUSIC_START_S, MUSIC_VOLUME, T } from './script'
import { F_CRACKS, F_CUT, F_GLACON, F_NOEL, F_PRESAGE, IceScene, TakeLayer, TypeSounds } from './take'

export const NOEL_FRAMES = sec(T.end) // 1350
export const NOEL_INTRO_FRAMES = NOEL_FRAMES

/** Débuts des scènes (images) : 12,0 / 16,0 / 21,0 / 26,5 / 32,5 / 39,5 s. */
const S = { noel: sec(T.noel), missions: sec(T.missions), hotte: sec(T.hotte), pass: sec(T.pass), grande: sec(T.grandeHotte), rdv: sec(T.rdv) }
const OVER = WIPE_FRAMES + 8 // l'ancienne scène reste visible sous la transition « flocon »

/** `isolation` : les z-index d'une scène ne passent jamais au-dessus des transitions « flocon » suivantes. */
const Local: React.FC<{ C: React.FC<{ f: number }> }> = ({ C }) => (
  <AbsoluteFill style={{ isolation: 'isolate' }}>
    <C f={useCurrentFrame()} />
  </AbsoluteFill>
)

/** Volume de la musique : 0 dans les « silences d'un temps » (l'image d'avant à 40 % pour éviter le clic). */
const musicVolume = (frame: number) => {
  const abs = frame + sec(MUSIC_START_S)
  for (const [a, b] of MUSIC_SILENCES) {
    if (abs >= sec(a) && abs < sec(b)) return 0
    if (abs === sec(a) - 1) return MUSIC_VOLUME * 0.4
  }
  return MUSIC_VOLUME
}

type Wipe = { kind: WipeKind; ox?: number; oy?: number }
/** Une scène : Sequence de `from` à `to` (images absolues), frames locales dans le composant ; `wipe` : zone révélée par la transition d'entrée. */
const Scene: React.FC<{ from: number; to: number; name: string; C: React.FC<{ f: number }>; wipe?: Wipe; F: number }> = ({ from, to, name, C, wipe, F }) => (
  <Sequence from={from} durationInFrames={Math.min(to, NOEL_FRAMES) - from} name={name}>
    <AbsoluteFill style={{ clipPath: wipe ? wipeClip(F - from, wipe.kind, wipe.ox, wipe.oy) : undefined }}>
      <Local C={C} />
    </AbsoluteFill>
  </Sequence>
)

export const NoelIntro: React.FC = () => {
  const F = useCurrentFrame()
  return (
    <AbsoluteFill style={{ background: '#0b0a14' }}>
      <TakeLayer f={F} />
      <IceScene f={F} />
      <Scene F={F} from={S.noel} to={S.missions + OVER} name="noel" C={Noel} />
      <WipeLayer f={F - S.missions} kind="grow" bg={N.red} ox={360} oy={700} />
      <Scene F={F} from={S.missions} to={S.hotte + OVER} name="missions" C={Missions} wipe={{ kind: 'grow', ox: 360, oy: 700 }} />
      <WipeLayer f={F - S.hotte} kind="sweep" bg={N.green} oy={640} />
      <Scene F={F} from={S.hotte} to={S.pass + OVER} name="hotte" C={Hotte} wipe={{ kind: 'sweep', oy: 640 }} />
      <WipeLayer f={F - S.pass} kind="grow" bg={N.red} ox={60} oy={1240} />
      <Scene F={F} from={S.pass} to={S.grande + OVER} name="pass" C={Pass} wipe={{ kind: 'grow', ox: 60, oy: 1240 }} />
      <WipeLayer f={F - S.grande} kind="drop" bg={N.green} ox={360} oy={0} />
      <Scene F={F} from={S.grande} to={S.rdv + OVER} name="grandeHotte" C={GrandeHotte} wipe={{ kind: 'drop', ox: 360, oy: 0 }} />
      <WipeLayer f={F - S.rdv} kind="sweep" bg={N.red} oy={560} />
      <Scene F={F} from={S.rdv} to={NOEL_FRAMES} name="rdv" C={Rdv} wipe={{ kind: 'sweep', oy: 560 }} />
      <WipeFlake f={F - S.missions} kind="grow" ox={360} oy={700} />
      <WipeFlake f={F - S.hotte} kind="sweep" oy={640} />
      <WipeFlake f={F - S.pass} kind="grow" ox={60} oy={1240} />
      <WipeFlake f={F - S.grande} kind="drop" ox={360} oy={0} />
      <WipeFlake f={F - S.rdv} kind="sweep" oy={560} />
      <Garland f={F} at={F_NOEL + 2} lightFrom={F_NOEL + 14} every={4} />

      {/* Sons du début : machine à écrire du chibi, vent qui monte, rafale, glaçon. */}
      <TypeSounds />
      <Sfx name="wind-rise" at={F_PRESAGE} volume={0.5} />
      <Sfx name="whoosh" at={F_PRESAGE + 4} volume={0.3} />
      <Sfx name="gust" at={F_CUT} volume={0.8} />
      <Sfx name="boom" at={F_CUT} volume={0.4} />
      <Sfx name="stamp" at={F_GLACON} volume={0.45} />
      <Sfx name="hum" at={F_GLACON + 4} volume={0.45} />
      <Sfx name="crack1" at={F_CRACKS[0]} volume={0.6} />
      <Sfx name="crack2" at={F_CRACKS[1]} volume={0.75} />
      <Sfx name="crack3" at={F_CRACKS[2]} volume={0.95} />

      {MUSIC_VOLUME > 0 && (
        <Sequence from={sec(MUSIC_START_S)} layout="none">
          <Audio src={staticFile('sfx/noel-music.mp3')} volume={musicVolume} />
        </Sequence>
      )}
    </AbsoluteFill>
  )
}

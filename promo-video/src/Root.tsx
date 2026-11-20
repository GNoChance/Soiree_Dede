import { Composition } from 'remotion'
import { Promo } from './Promo'
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './timeline'
import { TFPS, TH, TW } from './tuto/kit'
import { MG_CLIPS, MG_FRAMES, MG_H, MG_SHEET_COLS, MG_W, MgClip, MgSheet } from './tuto/games/dede-party-mg'
import { TUTOS } from './tuto/registry'
import { Sheet } from './tuto/Sheet'
import { Tuto, tutoDuration } from './tuto/Tuto'

export const RemotionRoot = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
    {/* Vidéos « Comment on joue ? » : une composition par jeu (720×1280, 30 FPS). */}
    {TUTOS.map((spec) => (
      <Composition key={spec.id} id={`Tuto-${spec.id}`} component={Tuto} defaultProps={{ id: spec.id }} durationInFrames={tutoDuration(spec)} fps={TFPS} width={TW} height={TH} />
    ))}
    {/* Clips « échauffement » des mini-jeux de Dédé Party (632×422, 6 s, en boucle) : npm run render:mg. */}
    {MG_CLIPS.map((c) => (
      <Composition key={c.id} id={`Mg-${c.id}`} component={MgClip} defaultProps={{ id: c.id }} durationInFrames={MG_FRAMES} fps={TFPS} width={MG_W} height={MG_H} />
    ))}
    <Composition id="MgSheet" component={MgSheet} durationInFrames={46} fps={TFPS} width={MG_W * MG_SHEET_COLS.length} height={MG_H * MG_CLIPS.length} />
    {/* Planches de contrôle (dev) : étapes côte à côte, frame = % d'avancement. */}
    {TUTOS.map((spec) => (
      <Composition key={spec.id} id={`Sheet-${spec.id}`} component={Sheet} defaultProps={{ id: spec.id }} durationInFrames={101} fps={TFPS} width={TW * spec.steps.length} height={TH} />
    ))}
  </>
)

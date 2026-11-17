import { Composition } from 'remotion'
import { Promo } from './Promo'
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './timeline'
import { TFPS, TH, TW } from './tuto/kit'
import { TUTOS } from './tuto/registry'
import { Tuto, tutoDuration } from './tuto/Tuto'

export const RemotionRoot = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
    {/* Vidéos « Comment on joue ? » : une composition par jeu (720×1280, 30 FPS). */}
    {TUTOS.map((spec) => (
      <Composition key={spec.id} id={`Tuto-${spec.id}`} component={Tuto} defaultProps={{ id: spec.id }} durationInFrames={tutoDuration(spec)} fps={TFPS} width={TW} height={TH} />
    ))}
  </>
)

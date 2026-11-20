/** Thèmes du plateau 3D, un par plateau. */
import type { MapId } from '../../board'
import { campingTheme } from './camping'
import { grandTheme } from './grand'
import { kermesseTheme } from './kermesse'
import { merTheme } from './mer'
import { skiTheme } from './ski'
import type { ThemeDef } from './types'

export const THEMES: Record<MapId, ThemeDef> = {
  grand: grandTheme,
  mer: merTheme,
  kermesse: kermesseTheme,
  camping: campingTheme,
  ski: skiTheme,
}

import { fx, playSound, vibrate } from '@/lib/feedback'

/** Bruitages de Kems (synthèse Web Audio de l'app : voir src/lib/feedback.ts). */
export const kemsFx = {
  /** Carte posée sur la table. */
  swap: () => fx.slap(),
  /** « Trop tard ! » : la carte n'est plus là. */
  taken: () => fx.fail(),
  /** Le centre est balayé : nouvelles cartes. */
  sweep: () => {
    playSound('shuffle')
    vibrate(8)
  },
  /** Un carré dans la main. */
  square: () => {
    playSound('bell')
    vibrate([20, 40, 20])
  },
  /** KEMS ! / CONTRE-KEMS ! réussi. */
  shout: () => fx.fanfare(),
  /** Appel raté. */
  miss: () => fx.fail(),
  /** Manche blanche. */
  blank: () => playSound('skip'),
  /** Début de la manche. */
  deal: () => fx.deal(),
}

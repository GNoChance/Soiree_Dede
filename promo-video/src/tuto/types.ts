import type React from 'react'
import type { Slug } from '../theme'

/** Maquette animée d'une étape : dessine dans une zone de 720 × 880 px. `f` = frame locale de l'étape. */
export type MockScene = React.FC<{ f: number; dur: number }>

export interface TutoStep {
  /** Texte à l'écran (court, 2 lignes max). */
  text: string
  /** Durée de l'étape en secondes. */
  seconds: number
  /** Maquette simplifiée de l'écran du jeu. */
  Mock: MockScene
}

/** Scène plein cadre sur-mesure insérée entre les étapes et la victoire (optionnelle). */
export interface TutoExtra {
  seconds: number
  Scene: MockScene
}

export interface TutoSpec {
  /** Identifiant du jeu (= dossier src/games/<id>) → composition `Tuto-<id>`. */
  id: string
  name: string
  emoji: string
  /** Couleur du jeu (definition.color). */
  color: string
  /** Ex. « 2 à 9 joueurs ». */
  players: string
  /** But du jeu en une phrase. */
  goal: string
  /** Chibis présents à l'écran titre / final (3 à 5). */
  cast: Slug[]
  steps: TutoStep[]
  extra?: TutoExtra
  win: {
    text: string
    /** Petite ligne complémentaire. */
    sub?: string
    winners: Slug[]
  }
}

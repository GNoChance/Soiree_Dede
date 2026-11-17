// Liste des tutos disponibles : chaque entrée devient la composition `Tuto-<id>`.
// Ajouter un jeu = un fichier games/<id>.tsx qui exporte un TutoSpec, puis l'ajouter ici.
import { dessineDevine } from './games/dessine-devine'
import { morpion } from './games/morpion'
import { undercover } from './games/undercover'
import type { TutoSpec } from './types'

export const TUTOS: TutoSpec[] = [morpion, undercover, dessineDevine]

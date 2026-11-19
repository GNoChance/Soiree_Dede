/**
 * Cadre des mini-jeux : un fichier par mini-jeu, même interface (MgPlayProps / MgTvProps).
 * Ajouter un mini-jeu = un fichier ici + une branche dans _dp_open_mg / _dp_check_submit /
 * _dp_close_mg (supabase/games/dede-party.sql).
 */
import type { MgKind } from '../types'
import { BuzzerPlay, BuzzerTv } from './buzzer'
import { ChronoPlay, ChronoTv } from './chrono'
import type { MiniGameDef } from './common'
import { EtoilesPlay, EtoilesTv } from './etoiles'
import { MajoritePlay, MajoriteTv } from './majorite'
import { PifPlay, PifTv } from './pif'
import { QuizPlay, QuizTv } from './quiz'

export const MINIGAMES: Record<MgKind, MiniGameDef> = {
  quiz: { name: 'Questions pour un Dédé', emoji: '❓', color: '#4CC9F0', rule: '3 questions éclair : tape la bonne réponse, vite !', Play: QuizPlay, Tv: QuizTv },
  pif: { name: 'Au pif', emoji: '🎯', color: '#FFB570', rule: 'Une question chiffrée : le plus proche gagne !', Play: PifPlay, Tv: PifTv },
  majorite: { name: 'Comme tout le monde', emoji: '🫵', color: '#FF8FA3', rule: 'Vote pour un joueur : ceux qui votent comme la majorité gagnent !', Play: MajoritePlay, Tv: MajoriteTv },
  buzzer: { name: 'Le Buzzer', emoji: '🚨', color: '#EF476F', rule: 'Quand l’écran passe au vert, tape le plus vite possible !', Play: BuzzerPlay, Tv: BuzzerTv },
  etoiles: { name: 'Pluie d’étoiles', emoji: '🌠', color: '#8B5CF6', rule: 'Tape les étoiles qui tombent, évite les tomates !', Play: EtoilesPlay, Tv: EtoilesTv },
  chrono: { name: 'Top chrono', emoji: '⏱️', color: '#06D6A0', rule: 'Arrête le chrono pile à 7,00 s… il disparaît après 3 s !', Play: ChronoPlay, Tv: ChronoTv },
}

export const MG_ORDER: MgKind[] = ['quiz', 'pif', 'majorite', 'buzzer', 'etoiles', 'chrono']

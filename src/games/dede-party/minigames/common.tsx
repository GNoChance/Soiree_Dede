import { useEffect, useState, type ComponentType } from 'react'
import { serverNow } from '@/features/soiree/useServerClock'
import type { Get } from '../Parts'
import type { DedePartyState, DpMg } from '../types'

/** Ce que reçoit l'écran téléphone d'un mini-jeu (même interface pour les 6). */
export interface MgPlayProps {
  mg: DpMg
  meId: string
  players: string[]
  get: Get
  /** Envoi unique de mon résultat (le serveur ignore les doublons). */
  submit: (payload: Record<string, unknown>) => Promise<boolean>
  submitted: boolean
}

/** Vue télé d'un mini-jeu en cours (lecture seule). */
export interface MgTvProps {
  s: DedePartyState
  mg: DpMg
  get: Get
}

export interface MiniGameDef {
  name: string
  emoji: string
  color: string
  /** Une phrase de règle. */
  rule: string
  Play: ComponentType<MgPlayProps>
  /** Vue télé spécifique (sinon : règle + qui a répondu). */
  Tv?: ComponentType<MgTvProps>
}

/** Horloge serveur rafraîchie toutes les `ms` millisecondes. */
export function useServerNow(ms = 100, on = true) {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => setNow(serverNow()), ms)
    return () => clearInterval(id)
  }, [ms, on])
  return now
}

/** « 7,04 s » */
export const fmtSec = (ms: number, digits = 2) => `${(ms / 1000).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} s`

export const startedAt = (mg: DpMg) => (mg.started_at ? new Date(mg.started_at).getTime() : serverNow())

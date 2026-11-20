import { useCallback, useEffect, useRef, useState } from 'react'
import { toastError } from '@/features/soiree/errors'
import type { BaseGameState, GameActionPayload } from '@/games/types'
import { soloAct, soloStart, type SoloX } from './engine'
import type { BotMood, SoloGameModule } from './games'

export type SoloOutcome = 'win' | 'loss' | 'draw'

interface Args {
  mod: SoloGameModule
  gameId: string
  meId: string
  botId: string
  level: number
  /** Qui commence (❌ / Blancs / premier tir). */
  first: string
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/**
 * Partie locale joueur contre bot : state du mini-socle (engine.ts), `act` local pour le
 * plateau du vrai jeu, tour du bot (réflexion 0,6 à 1,5 s, bulle 💭), humeur du bot.
 * Aucun appel réseau : rien ne peut compter côté serveur.
 */
export function useSoloMatch({ mod, gameId, meId, botId, level, first }: Args) {
  // Une partie par montage : le parent remonte le composant (key) pour « Rejouer ».
  const [x, setX] = useState<SoloX>(() => soloStart(mod.local, { a: meId, b: botId, first, options: mod.options }) as SoloX)
  const xRef = useRef(x)
  const [mood, setMood] = useState<BotMood>(null)
  const moodTimer = useRef(0)

  const commit = useCallback(
    (next: SoloX, by: string) => {
      const prev = xRef.current
      xRef.current = next
      setX(next)
      if (prev.state.board && next.state.board && next.state.phase !== 'setup') {
        const m = mod.reaction(prev.state.board, next.state.board, by, botId)
        if (m) {
          setMood(m)
          window.clearTimeout(moodTimer.current)
          moodTimer.current = window.setTimeout(() => setMood(null), 1800)
        }
      }
    },
    [mod, botId],
  )
  useEffect(() => () => window.clearTimeout(moodTimer.current), [])

  /** `act` du joueur, au format attendu par les plateaux (state ou null si refusé). */
  const act = useCallback(
    async (action: GameActionPayload): Promise<BaseGameState | null> => {
      try {
        const next = soloAct(mod.local, xRef.current, meId, action)
        commit(next, meId)
        return next.state as unknown as BaseGameState
      } catch (e) {
        toastError(e)
        return null
      }
    },
    [mod, meId, commit],
  )

  // Tour du bot.
  const s = x.state
  const botTurn = s.phase === 'playing' && s.duel?.turn === botId
  const botSetup = s.phase === 'setup' && !!s.duel && !s.duel.ready.includes(botId)
  const turnKey = `${s.duel?.moves ?? 0}-${s.duel?.turn ?? ''}-${s.phase}`
  useEffect(() => {
    if (!botTurn && !botSetup) return
    let alive = true
    void (async () => {
      if (botSetup) {
        await sleep(900)
        if (!alive) return
        try {
          commit(soloAct(mod.local, xRef.current, botId, { type: 'ready' }), botId)
        } catch (e) {
          console.warn('[solo] bot ready', e)
        }
        return
      }
      const t0 = performance.now()
      const wait = 600 + Math.random() * 900
      for (let attempt = 0; attempt < 3 && alive; attempt++) {
        try {
          const move = await mod.chooseMove(xRef.current.state.board, botId, level)
          await sleep(Math.max(0, wait - (performance.now() - t0)))
          if (!alive) return
          commit(soloAct(mod.local, xRef.current, botId, { type: 'move', move }), botId)
          break
        } catch (e) {
          console.warn('[solo] coup du bot refusé', gameId, e)
        }
      }
    })()
    return () => {
      alive = false
    }
    // turnKey : un nouveau tour du bot (y compris rejouer après un touché) relance l'effet.
  }, [turnKey, botTurn, botSetup, mod, botId, level, gameId, commit])

  const outcome: SoloOutcome | null =
    s.phase === 'result' && s.duel ? (s.duel.winner === meId ? 'win' : s.duel.winner === botId ? 'loss' : 'draw') : null

  return { x, state: s, secret: x.secrets[meId] ?? null, act, thinking: botTurn, mood, outcome }
}

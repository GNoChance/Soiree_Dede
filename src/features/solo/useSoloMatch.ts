import { useCallback, useEffect, useRef, useState } from 'react'
import type { CharacterSlug } from '@/data/characters'
import { toastError } from '@/features/soiree/errors'
import type { BaseGameState, GameActionPayload } from '@/games/types'
import { soloAct, soloStart, type SoloAction, type SoloX } from './engine'
import type { BotMood, SoloGameModule } from './games'
import { newLogId, type SoloLog, type SoloOutcome } from './log'
import type { MemBase } from './memory'

export type { SoloOutcome } from './log'

interface Args {
  mod: SoloGameModule
  gameId: string
  meId: string
  botId: string
  level: number
  /** Qui commence (❌ / Blancs / premier tir). */
  first: string
  /** Perso du bot (journal). */
  perso: CharacterSlug
  /** 2b : mémoire du bot au début de la partie, et dose d'apprentissage (0 = jeu de l'étape 1). */
  mem: MemBase | null
  rate: number
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/**
 * Partie locale joueur contre bot : state du mini-socle (engine.ts), `act` local pour le
 * plateau du vrai jeu, tour du bot (réflexion 0,6 à 1,5 s, bulle 💭), humeur du bot.
 * Tient le journal de la partie (log.ts, mémoire vive seulement) et passe au bot les
 * indices de sa mémoire (`hints`). Aucun appel réseau : rien ne peut compter côté serveur.
 */
export function useSoloMatch({ mod, gameId, meId, botId, level, first, perso, mem, rate }: Args) {
  // Une partie par montage : le parent remonte le composant (key) pour « Rejouer ».
  const [init] = useState<SoloX>(() => soloStart(mod.local, { a: meId, b: botId, first, options: mod.options }) as SoloX)
  const [x, setX] = useState<SoloX>(init)
  const xRef = useRef(init)
  const [mood, setMood] = useState<BotMood>(null)
  const moodTimer = useRef(0)
  const learnedShown = useRef(false)
  // Journal de la partie : objet mutable créé une fois (jamais rendu tel quel).
  const [log] = useState<SoloLog>(() => {
    const x0 = init
    return {
      id: newLogId(),
      game: gameId,
      me: meId,
      bot: botId,
      first,
      perso,
      level,
      secret0: x0.secrets[meId] ?? null,
      setup: [],
      x0: x0.state.phase === 'playing' ? x0 : null,
      entries: [],
      outcome: null,
      ...(mem && mod.learner.logCtx ? { ctx: mod.learner.logCtx(mem, rate) } : {}),
    }
  })

  const showMood = useCallback((m: BotMood, ms = 1800) => {
    setMood(m)
    window.clearTimeout(moodTimer.current)
    moodTimer.current = window.setTimeout(() => setMood(null), ms)
  }, [])

  const commit = useCallback(
    (next: SoloX, by: string, action: SoloAction, learned?: string) => {
      const prev = xRef.current
      xRef.current = next
      setX(next)
      // Journal : préparation, puis coups de la phase playing.
      const side = by === meId ? 'me' : 'bot'
      if (prev.state.phase === 'setup') log.setup.push({ by: side, action })
      else if (prev.state.phase === 'playing') log.entries.push({ by: side, action, ...(learned ? { learned } : {}) })
      if (next.state.phase === 'playing' && !log.x0) log.x0 = next
      if (next.state.phase === 'result' && next.state.duel) {
        const w = next.state.duel.winner
        log.outcome = w === meId ? 'win' : w === botId ? 'loss' : 'draw'
      }
      if (learned && !learnedShown.current) {
        learnedShown.current = true
        showMood('appris', 2400)
        return
      }
      if (prev.state.board && next.state.board && next.state.phase !== 'setup') {
        const m = mod.reaction(prev.state.board, next.state.board, by, botId)
        if (m) showMood(m)
      }
    },
    [mod, botId, meId, showMood, log],
  )
  useEffect(() => () => window.clearTimeout(moodTimer.current), [])

  /** `act` du joueur, au format attendu par les plateaux (state ou null si refusé). */
  const act = useCallback(
    async (action: GameActionPayload): Promise<BaseGameState | null> => {
      try {
        const next = soloAct(mod.local, xRef.current, meId, action)
        commit(next, meId, action)
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
          // 2b : la flotte du bot évite les premiers tirs habituels du joueur (Bataille navale).
          const prep = mem && rate > 0 ? (mod.learner.botSetup?.(mem, rate, xRef.current.state.board, botId) ?? []) : []
          for (const a of prep) {
            try {
              commit(soloAct(mod.local, xRef.current, botId, a), botId, a)
            } catch (e) {
              console.warn('[solo] préparation du bot refusée', e)
            }
          }
          const ready: SoloAction = { type: 'ready' }
          commit(soloAct(mod.local, xRef.current, botId, ready), botId, ready)
        } catch (e) {
          console.warn('[solo] bot ready', e)
        }
        return
      }
      const t0 = performance.now()
      const wait = 600 + Math.random() * 900
      for (let attempt = 0; attempt < 3 && alive; attempt++) {
        try {
          const board = xRef.current.state.board
          const hints = mem && rate > 0 ? mod.learner.hintsFor(mem, rate, board, log) : undefined
          const choice = await mod.chooseMove(board, botId, level, attempt === 0 ? hints : undefined)
          await sleep(Math.max(0, wait - (performance.now() - t0)))
          if (!alive) return
          const action: SoloAction = { type: 'move', move: choice.move }
          commit(soloAct(mod.local, xRef.current, botId, action), botId, action, choice.learned)
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
  }, [turnKey, botTurn, botSetup, mod, botId, level, gameId, commit, mem, rate, log])

  const outcome: SoloOutcome | null =
    s.phase === 'result' && s.duel ? (s.duel.winner === meId ? 'win' : s.duel.winner === botId ? 'loss' : 'draw') : null

  return { x, state: s, secret: x.secrets[meId] ?? null, act, thinking: botTurn, mood, outcome, log }
}

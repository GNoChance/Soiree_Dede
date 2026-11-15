import { useCallback, useEffect, useMemo } from 'react'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import { playerOrPlaceholder } from '@/features/soiree/players'
import type { BaseGameState, GameActionPayload, PlayerInfo } from '@/games/types'
import { betsOpen, duelRole, opponentOf } from './logic'
import type { DuelAction, DuelState } from './types'

/**
 * Vue dérivée du state d'un jeu en duel pour l'utilisateur `meId`.
 * `left` = ms restantes avant `deadline` (horloge serveur), `betsLeft` = ms
 * restantes de la fenêtre de paris de 15 s (0 si fermée par le temps).
 */
export function useDuel<B = unknown, M = unknown>(state: BaseGameState, meId: string, players: Record<string, PlayerInfo>) {
  const s = state as unknown as DuelState<B, M>
  const duel = s.duel
  const role = duelRole(s, meId)
  const active = s.phase === 'transition' || s.phase === 'setup' || s.phase === 'playing' || s.phase === 'result'
  const left = useCountdown(active ? s.deadline : null)
  const betsLeft = useCountdown(duel && duel.game_no === 1 ? duel.bets_until : null, 500)
  const get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])
  // betsOpen dépend de l'heure : `left`/`betsLeft` changent régulièrement et forcent le recalcul.
  const open = useMemo(() => betsOpen(s, serverNow()), [s, left, betsLeft]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    s,
    session: s.session,
    duel,
    board: s.board,
    phase: s.phase,
    role,
    isDuelist: role === 'a' || role === 'b',
    isSpectator: role === 'spectator',
    isMyTurn: s.phase === 'playing' && !!duel && duel.turn === meId,
    opponent: duel && (role === 'a' || role === 'b') ? opponentOf(duel, meId) : null,
    myBet: duel?.bets[meId] ?? null,
    betsOpen: open,
    left,
    betsLeft,
    get,
  }
}

export type DuelView<B = unknown, M = unknown> = ReturnType<typeof useDuel<B, M>>

/**
 * Minuteurs : à l'échéance, un client prévient le serveur ({type:'tick'}).
 * D'abord le joueur au trait (playing) ou l'hôte (autres phases), puis les
 * autres en renfort ; répété toutes les ~5 s tant que la phase ne bouge pas.
 */
export function useDuelTicker(
  s: Pick<DuelState, 'phase' | 'deadline' | 'duel'>,
  act: (a: GameActionPayload) => Promise<unknown>,
  meId: string,
  isHost: boolean,
) {
  const turn = s.duel?.turn ?? null
  useEffect(() => {
    if (!s.deadline || !(s.phase === 'transition' || s.phase === 'setup' || s.phase === 'playing' || s.phase === 'result')) return
    const end = new Date(s.deadline).getTime()
    let timer = 0
    const fire = () => {
      void act({ type: 'tick' } satisfies DuelAction)
      timer = window.setTimeout(fire, 4000 + Math.random() * 2000)
    }
    const first = s.phase === 'playing' ? turn === meId : isHost
    const delay = Math.max(0, end - serverNow()) + (first ? 150 : 1500 + Math.random() * 2000)
    timer = window.setTimeout(fire, delay)
    return () => clearTimeout(timer)
  }, [s.deadline, s.phase, turn, meId, isHost, act])
}

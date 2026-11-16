/**
 * Écran de jeu « Le Tour des Potes » : plateau carré lisible sur téléphone,
 * panneau des joueurs, journal et barre d'actions collée en bas.
 * Contrat : ./types.ts — helpers : ./rules.ts — rendu du plateau : ./PlayBoard.tsx.
 */
import { useCallback, useEffect, useState } from 'react'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps } from '../types'
import Actions from './Actions'
import Assets from './Assets'
import { Board } from './PlayBoard'
import CellSheet from './CellSheet'
import Center from './Center'
import EventCard from './EventCard'
import { FormatBar, LogPanel, PlayersPanel } from './Panels'
import { tdpActions } from './rules'
import type { TdpAction, TdpState } from './types'
import { usePlayback } from './usePlayback'

export default function TourDesPotesPlay({ state, meId, players, isHost, act, pending }: GamePlayProps) {
  const s = state as unknown as TdpState
  const name = useCallback((id: string | null | undefined) => (id ? playerOrPlaceholder(players, id).nickname : '—'), [players])
  const active = ['roll', 'jail', 'buy', 'manage', 'debt'].includes(s.phase)
  const left = useCountdown(active ? s.deadline : null)
  const { shownPos, rolling, floats, dismissFloat, initialNo } = usePlayback(s)
  const [cell, setCell] = useState<number | null>(null)
  const [assets, setAssets] = useState(false)
  const [rollPending, setRollPending] = useState(false)

  const send = useCallback((a: TdpAction) => void act(a), [act])
  const onRoll = useCallback(() => {
    setRollPending(true)
    void act(tdpActions.roll()).finally(() => setRollPending(false))
  }, [act])

  // À l'échéance, n'importe quel client prévient le serveur (le joueur au trait d'abord).
  useEffect(() => {
    if (!active || !s.deadline) return
    const end = new Date(s.deadline).getTime()
    let timer = 0
    const fire = () => {
      void act(tdpActions.tick())
      timer = window.setTimeout(fire, 4000 + Math.random() * 2000)
    }
    timer = window.setTimeout(fire, Math.max(0, end - serverNow()) + (s.turn === meId ? 200 : 1500 + Math.random() * 2000))
    return () => clearTimeout(timer)
  }, [active, s.deadline, s.turn, meId, act])

  // Dette : on ouvre « Mes biens » pour vendre (une seule fois par dette).
  const inDebt = s.phase === 'debt' && s.turn === meId
  useEffect(() => {
    if (!inDebt) return
    const t = window.setTimeout(() => setAssets(true), 700)
    return () => clearTimeout(t)
  }, [inDebt, s.turn_no])

  return (
    <div className="flex flex-col gap-3 pb-2">
      <FormatBar s={s} />
      <PlayersPanel s={s} players={players} meId={meId} floats={floats} dismissFloat={dismissFloat} />
      <Board
        s={s}
        players={players}
        shownPos={shownPos}
        selected={cell}
        onCell={setCell}
        center={<Center s={s} players={players} meId={meId} name={name} rolling={rolling || (rollPending && s.turn === meId)} />}
      />
      <p className="-mt-1 text-center text-xs text-muted">Touche une case pour voir sa fiche.</p>
      <LogPanel s={s} name={name} />

      <Actions s={s} meId={meId} isHost={isHost} pending={pending} left={left} name={name} send={send} onRoll={onRoll} onAssets={() => setAssets(true)} />

      <CellSheet cell={cell} s={s} meId={meId} players={players} pending={pending} send={send} onClose={() => setCell(null)} />
      <Assets open={assets} onClose={() => setAssets(false)} s={s} meId={meId} pending={pending} send={send} onOpenCell={setCell} />
      <EventCard s={s} initialNo={initialNo} name={name} meId={meId} />
    </div>
  )
}

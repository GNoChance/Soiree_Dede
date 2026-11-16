/**
 * Écran de jeu « Le Tour des Potes » : plateau carré lisible sur téléphone,
 * panneau des joueurs, journal et barre d'actions collée en bas.
 * Contrat : ./types.ts — helpers : ./rules.ts — rendu du plateau : ./PlayBoard.tsx.
 */
import { Suspense, useCallback, useEffect, useState } from 'react'
import { Box } from 'lucide-react'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps } from '../types'
import Actions from './Actions'
import Assets from './Assets'
import Board3D from './Board3D'
import { Board } from './PlayBoard'
import CellSheet from './CellSheet'
import Center from './Center'
import EventCard from './EventCard'
import { FormatBar, LogPanel, PlayersPanel } from './Panels'
import RentScene from './RentScene'
import Wallet from './Wallet'
import { TDP_ACTIVE_PHASES, tdpActions } from './rules'
import type { TdpAction, TdpState } from './types'
import { DRAW_ANIM_MS, usePlayback } from './usePlayback'

const VIEW_KEY = 'tdp:view'
const readView3d = () => {
  try {
    return localStorage.getItem(VIEW_KEY) !== '2d'
  } catch {
    return true
  }
}

export default function TourDesPotesPlay({ state, meId, players, isHost, act, pending }: GamePlayProps) {
  const s = state as unknown as TdpState
  const name = useCallback((id: string | null | undefined) => (id ? playerOrPlaceholder(players, id).nickname : '—'), [players])
  const active = TDP_ACTIVE_PHASES.includes(s.phase)
  const left = useCountdown(active ? s.deadline : null)
  const [cardUp, setCardUp] = useState(false)
  const [pref3d, setPref3d] = useState(readView3d)
  const [glFailed, setGlFailed] = useState(false)
  const view3d = pref3d && !glFailed
  const { shownPos, rolling, floats, dismissFloat, initialNo, taxPot, taxFx, potFx, rent, dismissRent } = usePlayback(s, cardUp, view3d ? DRAW_ANIM_MS : 500)
  const setView = useCallback((v3: boolean) => {
    setPref3d(v3)
    try {
      localStorage.setItem(VIEW_KEY, v3 ? '3d' : '2d')
    } catch {
      /* préférence non mémorisée */
    }
  }, [])
  const onUnsupported = useCallback(() => setGlFailed(true), [])
  const [drawPending, setDrawPending] = useState(false)
  const onDraw = useCallback(() => {
    setDrawPending(true)
    void act(tdpActions.draw()).finally(() => setDrawPending(false))
  }, [act])
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
      {view3d ? (
        <Suspense fallback={null}>
          <Board3D
            s={s}
            players={players}
            meId={meId}
            name={name}
            shownPos={shownPos}
            selected={cell}
            onCell={setCell}
            onDraw={onDraw}
            drawPending={drawPending}
            cardShowing={cardUp}
            taxPot={taxPot}
            taxFx={taxFx}
            potFx={potFx}
            onTwoD={() => setView(false)}
            onUnsupported={onUnsupported}
          />
        </Suspense>
      ) : (
        <>
          <Board
            s={s}
            players={players}
            shownPos={shownPos}
            selected={cell}
            onCell={setCell}
            taxFx={taxFx}
            potFx={potFx}
            meId={meId}
            name={name}
            center={<Center s={s} players={players} meId={meId} name={name} rolling={rolling || (rollPending && s.turn === meId)} taxPot={taxPot} />}
          />
          {!glFailed && (
            <button type="button" onClick={() => setView(true)} className="mx-auto -mt-1 flex min-h-9 items-center gap-1.5 rounded-chip border-2 border-ink bg-surface px-3 font-display text-xs font-extrabold">
              <Box className="size-4" strokeWidth={3} /> Vue 3D
            </button>
          )}
        </>
      )}
      <Wallet s={s} meId={meId} name={name} />
      <p className="-mt-1 text-center text-xs text-muted">Touche une case pour voir sa fiche.</p>
      <LogPanel s={s} name={name} />

      <Actions s={s} meId={meId} isHost={isHost} pending={pending} left={left} name={name} send={send} onRoll={onRoll} onDraw={onDraw} onAssets={() => setAssets(true)} />

      <CellSheet cell={cell} s={s} meId={meId} players={players} pending={pending} send={send} onClose={() => setCell(null)} />
      <Assets open={assets} onClose={() => setAssets(false)} s={s} meId={meId} pending={pending} send={send} onOpenCell={setCell} />
      <EventCard s={s} initialNo={initialNo} name={name} meId={meId} cardDelay={view3d ? DRAW_ANIM_MS : 500} onActive={setCardUp} suppress={!!rent} />
      <RentScene rent={rent} players={players} meId={meId} name={name} onClose={dismissRent} />
    </div>
  )
}

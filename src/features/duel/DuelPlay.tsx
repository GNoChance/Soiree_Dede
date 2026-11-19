import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, Flag } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/features/soiree/components'
import { mood } from '@/features/soiree/players'
import { fx, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { GamePlayProps, PlayerInfo } from '@/games/types'
import { BetPanel } from './BetPanel'
import { DuelResultBanner } from './DuelResult'
import { DuelStage } from './DuelStage'
import { DuelTransition } from './DuelTransition'
import { TvButton } from '@/features/tv/TvButton'
import { DuelTv } from './DuelTv'
import { useDuelTv } from './tv'
import { SessionBoard } from './SessionBoard'
import { fmtTurnClock, pickSideColors } from './logic'
import { useDuel, useDuelTicker } from './useDuel'
import type { DuelAction, DuelBoardProps } from './types'

export interface DuelPlayProps<B, M> extends GamePlayProps {
  /** Plateau du jeu. */
  Board: ComponentType<DuelBoardProps<B, M>>
  /** Couleurs des duellistes (défaut : couleurs des persos, ou tomate/soleil si trop proches). */
  sideColors?: (a: PlayerInfo, b: PlayerInfo) => { a: string; b: string }
  /** Consigne affichée au joueur au trait (défaut : « À toi de jouer ! »). */
  myTurnHint?: ReactNode
  /** Consigne de la phase de préparation (setup). */
  setupHint?: ReactNode
}

/**
 * Écran de jeu générique d'un jeu en duel : assemble DuelStage, Plateau,
 * BetPanel, DuelTransition, DuelResultBanner, SessionBoard, le minuteur
 * (ticks) et les boutons de l'hôte. Un jeu en duel n'a qu'à fournir `Board`.
 * Sous DuelTvContext (route /soiree/:id/tele) : vue télé en lecture seule.
 */
export function DuelPlay<B, M>(props: DuelPlayProps<B, M>) {
  return useDuelTv() ? <DuelTv<B, M> {...props} /> : <DuelPlayScreen<B, M> {...props} />
}

function DuelPlayScreen<B, M>({ soireeId, state, secret, meId, isHost, players, act, pending, Board, sideColors, myTurnHint, setupHint }: DuelPlayProps<B, M>) {
  const reduce = useReducedMotion()
  const v = useDuel<B, M>(state, meId, players)
  const { s, duel, session, phase, get } = v
  const [confirmStop, setConfirmStop] = useState(false)
  const [showSession, setShowSession] = useState(false)

  const send = useCallback((a: DuelAction<M>) => act(a as unknown as Parameters<typeof act>[0]), [act])
  useDuelTicker(s, act, meId, isHost)

  const colors = useMemo(() => {
    if (!duel) return { a: '#EF476F', b: '#FFB703' }
    const pa = get(duel.a)
    const pb = get(duel.b)
    return sideColors ? sideColors(pa, pb) : pickSideColors(pa.color, pb.color)
  }, [duel, get, sideColors])

  /* ---- sons : c'est mon tour / compte à rebours ---- */
  const turnKey = duel ? `${duel.no}-${duel.game_no}-${duel.moves}-${duel.turn}` : ''
  const lastTurnKey = useRef(turnKey)
  useEffect(() => {
    if (turnKey === lastTurnKey.current) return
    lastTurnKey.current = turnKey
    if (v.isMyTurn) {
      fx.success()
      vibrate([20, 40, 20])
    }
  }, [turnKey, v.isMyTurn])
  const secLeft = Math.ceil(v.left / 1000)
  useEffect(() => {
    if ((v.isMyTurn || (phase === 'setup' && v.isDuelist)) && secLeft > 0 && secLeft <= 5) fx.tick()
  }, [v.isMyTurn, phase, v.isDuelist, secLeft])

  if (!duel) return null

  const onMove = (move: M) => void send({ type: 'move', move })
  const onReady = () => void send({ type: 'ready' })
  const onBet = (winner: string) => void send({ type: 'bet', winner })
  const onNext = () => void send({ type: 'next' })
  const turnPlayer = duel.turn ? get(duel.turn) : null

  const betPanel = (
    <BetPanel
      duel={duel}
      meId={meId}
      canBet={v.isSpectator}
      open={v.betsOpen}
      betsLeft={v.betsLeft}
      started={phase !== 'transition'}
      get={get}
      colors={colors}
      pending={pending}
      onBet={onBet}
    />
  )

  return (
    <div className="flex flex-col gap-3 pb-4">
      {phase === 'transition' ? (
        <DuelTransition duel={duel} session={session} meId={meId} get={get} colors={colors} left={v.left} isHost={isHost} pending={pending} onStart={onNext}>
          {betPanel}
        </DuelTransition>
      ) : (
        <>
          <DuelStage duel={duel} session={session} phase={phase} meId={meId} get={get} colors={colors} left={v.left} />

          {/* Consigne */}
          <AnimatePresence mode="wait">
            {phase === 'playing' && (
              <motion.div
                key={`${duel.turn}-${duel.moves}`}
                initial={{ y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-full border-[3px] border-ink px-3 py-1 text-center font-display text-lg font-extrabold',
                  v.isMyTurn ? 'bg-sun text-[#1f1b2e] shadow-sticker-sm' : 'bg-surface',
                )}
              >
                {v.isMyTurn ? (
                  <motion.span animate={reduce ? undefined : { scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1 }}>
                    {myTurnHint ?? 'À toi de jouer !'} <span className="tabular-nums">({fmtTurnClock(secLeft)})</span>
                  </motion.span>
                ) : turnPlayer ? (
                  <>
                    <Avatar slug={turnPlayer.slug} expression={mood(turnPlayer, 'think')} size={26} />
                    <span>{turnPlayer.nickname} réfléchit…</span>
                  </>
                ) : null}
              </motion.div>
            )}
            {phase === 'setup' && (
              <motion.div key="setup" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} className="text-center font-display text-lg font-extrabold">
                {v.isDuelist
                  ? duel.ready.includes(meId)
                    ? 'Prêt ! On attend l’adversaire…'
                    : (setupHint ?? 'Prépare-toi, puis valide !')
                  : 'Les duellistes se préparent…'}
              </motion.div>
            )}
          </AnimatePresence>

          {s.board != null && (
            <Board
              board={s.board}
              me={meId}
              isMyTurn={v.isMyTurn}
              onMove={onMove}
              onReady={onReady}
              pending={pending}
              duel={duel}
              phase={phase}
              spectator={!v.isDuelist}
              get={get}
              colors={colors}
              secret={secret}
            />
          )}

          <AnimatePresence>
            {phase === 'result' && (
              <DuelResultBanner
                key={`${duel.no}-${duel.game_no}`}
                duel={duel}
                session={session}
                meId={meId}
                get={get}
                colors={colors}
                left={v.left}
                isHost={isHost}
                pending={pending}
                onNext={onNext}
              />
            )}
          </AnimatePresence>

          {(phase === 'setup' || phase === 'playing') && (v.isSpectator ? v.betsOpen || !!v.myBet : Object.keys(duel.bets).length > 0) && betPanel}
          {!v.isDuelist && !v.isSpectator && <p className="text-center text-sm font-bold text-muted">Tu animes la session 🎤</p>}
        </>
      )}

      {/* Session (file / tableau / points) */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowSession((x) => !x)}
          className="flex items-center justify-center gap-1 text-sm font-extrabold text-muted"
          aria-expanded={showSession || phase === 'transition'}
        >
          {phase === 'transition' ? 'La session' : showSession ? 'Masquer la session' : 'Voir la session (file, tableau, points)'}
          {phase !== 'transition' && <ChevronDown className={cn('size-4 transition-transform', showSession && 'rotate-180')} />}
        </button>
        <AnimatePresence initial={false}>
          {(showSession || phase === 'transition') && (
            <motion.div key="session" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <SessionBoard state={s} get={get} meId={meId} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {(!v.isDuelist || isHost) && (
        <TvButton soireeId={soireeId} />
      )}

      {isHost && (
        <Button variant="ghost" size="sm" icon={<Flag className="size-4" />} onClick={() => setConfirmStop(true)}>
          Terminer la session maintenant
        </Button>
      )}
      <ConfirmModal
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title="Terminer la session ?"
        confirmLabel="Terminer"
        danger
        onConfirm={() => {
          setConfirmStop(false)
          void send({ type: 'stop' })
        }}
      >
        Le duel en cours ne compte pas. Le classement est figé sur les points actuels.
      </ConfirmModal>
    </div>
  )
}

export default DuelPlay

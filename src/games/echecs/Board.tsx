import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { ConfirmModal } from '@/features/soiree/components'
import { mood, pickExpression } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { useTv } from '@/features/tv/tv'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { DuelBoardProps } from '@/features/duel/types'
import { equippedOf } from '@/data/cadeaux'
import type { PieceTheme } from './Piece'
import { Aide } from './Aide'
import {
  END_LABELS,
  FILES,
  colOf,
  displayOrder,
  endLabel,
  fmtClock,
  isDarkSquare,
  isFlipped,
  isPromotion,
  kingIndex,
  material,
  otherSide,
  pieceAt,
  playerOfSide,
  rowOf,
  sideOfPiece,
  sideOfPlayer,
  slideDelta,
  sortCaptured,
  squareName,
  targetsOf,
} from './logic'
import { Piece } from './Piece'
import { PromotionPicker } from './PromotionPicker'
import { playMoveSound } from './sound'
import type { ChessBoard, ChessMove, ChessSide, Promo } from './types'

/** Cases : crème / turquoise (couleur du jeu), jamais blanc ou noir purs pour que les pièces ressortent. */
const LIGHT = '#f6e7c1'
const DARK = '#5fb3a6'
const FRAME = '#2a9d8f'

/* -------------------------------------------------------------------------- */
/* Bandeau d'un joueur : tête, pendule, pièces prises, avance de matériel       */
/* -------------------------------------------------------------------------- */

interface BarProps {
  board: ChessBoard
  side: ChessSide
  me: string
  get: DuelBoardProps<ChessBoard, ChessMove>['get']
  active: boolean
  clockMs: number | null
  ended: boolean
}

/** Thème des pièces de chaque camp (cadeau « Échecs en pain d’épice » équipé par le joueur de ce camp). */
function themesOf(board: ChessBoard, get: BarProps['get']): Record<'w' | 'b', PieceTheme | undefined> {
  const t = (side: 'w' | 'b') => (equippedOf(get(playerOfSide(board, side))?.equippedItems, 'chess')?.id === 'c_pain_epice' ? 'gingerbread' : undefined)
  return { w: t('w'), b: t('b') }
}

function PlayerBar({ board, side, me, get, active, clockMs, ended }: BarProps) {
  const reduce = useReducedMotion()
  const id = playerOfSide(board, side)
  const p = get(id)
  const caps = sortCaptured(board.captured[side] ?? '')
  const themes = themesOf(board, get)
  const lead = material(board.sq, side) - material(board.sq, otherSide(side))
  const won = ended && board.end?.winner === id
  const lost = ended && !!board.end?.winner && board.end.winner !== id
  const expr = won
    ? pickExpression(p, 'cool', 'pouces', 'joie')
    : lost
      ? mood(p, 'sad')
      : active && board.check
        ? mood(p, 'shocked')
        : lead >= 3
          ? mood(p, 'proud')
          : active
            ? mood(p, 'think')
            : p.equipped
  const low = clockMs != null && clockMs < 20000
  return (
    <div className={cn('flex items-center gap-2 rounded-2xl border-[3px] border-ink px-2 py-1', active ? 'bg-sun/90 text-[#1f1b2e] shadow-sticker-sm' : 'bg-surface')}>
      <Avatar slug={p.slug} expression={expr} tenue={p.equippedTenue} size={36} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex items-center gap-1 truncate font-display text-base font-extrabold">
          <span className="inline-block size-5 shrink-0">
            <Piece piece={side === 'w' ? 'K' : 'k'} flat theme={themes[side]} />
          </span>
          <span className="truncate">{id === me ? 'Toi' : p.nickname}</span>
        </span>
        <span className="flex min-h-[1.1rem] flex-wrap items-center gap-x-0.5">
          {caps.length > 0 && (
            <span className="flex flex-wrap items-center rounded-full bg-[#f6e7c1] py-px pr-1.5 pl-0.5" aria-label={`${caps.length} pièce(s) prise(s)`}>
              {caps.map((c, i) => (
                <span key={i} className="-mr-1 inline-block size-4">
                  <Piece piece={c} flat theme={themes[sideOfPiece(c)]} />
                </span>
              ))}
            </span>
          )}
          {lead > 0 && <span className="ml-1.5 text-xs font-extrabold tabular-nums">+{lead}</span>}
        </span>
      </div>
      {clockMs != null && (
        <motion.span
          className={cn(
            'rounded-xl border-[3px] border-ink px-2 py-0.5 font-display text-xl font-extrabold tabular-nums',
            active ? (low ? 'bg-tomato text-white' : 'bg-[#fff6e5] text-[#1f1b2e]') : 'bg-sunk text-muted',
          )}
          animate={active && low && !reduce ? { scale: [1, 1.08, 1] } : { scale: 1 }}
          transition={active && low ? { repeat: Infinity, duration: 0.8 } : undefined}
          aria-label={`Pendule : ${fmtClock(clockMs)}`}
        >
          {fmtClock(clockMs)}
        </motion.span>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Plateau                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Échiquier tactile : toucher une de ses pièces -> ses cases possibles
 * s'allument (point = case libre, anneau = prise) -> toucher la case.
 * Aucune règle côté client : seules les cases publiées par le serveur
 * (`board.moves`) sont proposées.
 */
export default function ChessBoardView({ board, me, isMyTurn, onMove, pending, phase, spectator, get }: DuelBoardProps<ChessBoard, ChessMove>) {
  const reduce = useReducedMotion()
  const tv = useTv()
  const [sel, setSel] = useState<number | null>(null)
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null)
  const [offerDraw, setOfferDraw] = useState(false)
  const [shake, setShake] = useState<{ i: number; n: number } | null>(null)
  const [confirmResign, setConfirmResign] = useState(false)
  const [help, setHelp] = useState(false)

  const flipped = isFlipped(board, me, spectator)
  const themes = themesOf(board, get)
  const mySide = spectator ? null : sideOfPlayer(board, me)
  const ended = !!board.end
  const interactive = isMyTurn && !pending && phase === 'playing' && !ended
  const targets = new Set(targetsOf(board, sel))
  const checkedKing = board.check || board.end?.reason === 'mate' ? kingIndex(board.sq, board.side) : -1
  const matedKing = board.end?.reason === 'mate' ? checkedKing : -1

  // La sélection n'a plus de sens quand la position change.
  const posKey = `${board.sq}-${board.side}-${phase}`
  const [lastPosKey, setLastPosKey] = useState(posKey)
  if (posKey !== lastPosKey) {
    setLastPosKey(posKey)
    setSel(null)
    setPromo(null)
  }

  // Pendules : celle du joueur au trait descend (heure serveur), l'autre est figée.
  const activeId = playerOfSide(board, board.side)
  const running = !!board.clock && phase === 'playing' && !ended
  const activeDeadline = running && board.clock ? new Date(new Date(board.turn_started_at).getTime() + (board.clock[activeId] ?? 0)).toISOString() : null
  const activeLeft = useCountdown(activeDeadline, 100)
  const clockOf = (side: ChessSide): number | null => {
    if (!board.clock) return null
    const id = playerOfSide(board, side)
    return running && id === activeId ? activeLeft : (board.clock[id] ?? 0)
  }

  // Son à chaque nouveau coup.
  const lastKey = board.last ? `${board.last.from}-${board.last.to}-${board.full}-${board.side}` : ''
  const lastKeyRef = useRef(lastKey)
  const capturedLen = board.captured.w.length + board.captured.b.length
  const capRef = useRef(capturedLen)
  useEffect(() => {
    if (lastKey && lastKey !== lastKeyRef.current) playMoveSound({ capture: capturedLen > capRef.current, check: board.check }, reduce ? 0 : 0.18)
    lastKeyRef.current = lastKey
    capRef.current = capturedLen
  }, [lastKey, capturedLen, board.check, reduce])

  const send = (from: number, to: number, p?: Promo) => {
    setSel(null)
    setPromo(null)
    const move: ChessMove = { from, to, ...(p ? { promo: p } : {}), ...(offerDraw ? { offer_draw: true } : {}) }
    setOfferDraw(false)
    onMove(move)
  }

  const onSquare = (i: number) => {
    if (!interactive) return
    if (sel !== null && targets.has(i)) {
      if (isPromotion(board.sq, sel, i)) {
        fx.pop()
        setPromo({ from: sel, to: i })
      } else {
        send(sel, i)
      }
      return
    }
    const p = pieceAt(board.sq, i)
    if (p && sideOfPiece(p) === board.side && i !== sel) {
      if (targetsOf(board, i).length) {
        fx.tick()
        setSel(i)
      } else {
        fx.fail()
        setShake((s) => ({ i, n: (s?.n ?? 0) + 1 }))
        setSel(null)
      }
      return
    }
    setSel(null)
  }

  const order = displayOrder(flipped)
  const topSide: ChessSide = flipped ? 'w' : 'b'
  const bottomSide = otherSide(topSide)
  const opponent = mySide ? playerOfSide(board, otherSide(mySide)) : null
  const offerFromOpp = !!opponent && board.draw_offer === opponent
  const showControls = !spectator && !tv && phase === 'playing' && !ended

  return (
    <div className="mx-auto flex w-full max-w-[26rem] flex-col gap-2 select-none">
      <PlayerBar board={board} side={topSide} me={me} get={get} active={!ended && phase === 'playing' && board.side === topSide} clockMs={clockOf(topSide)} ended={ended} />

      <div className="relative rounded-[1.4rem] border-[4px] border-ink p-[2.2%] shadow-sticker-lg" style={{ background: FRAME }}>
        <div className="grid grid-cols-8 overflow-hidden rounded-[0.8rem] border-[3px] border-ink">
          {order.map((i, k) => {
            const p = pieceAt(board.sq, i)
            const dark = isDarkSquare(i)
            const isLast = !!board.last && (board.last.from === i || board.last.to === i)
            const isSel = sel === i
            const isTarget = targets.has(i)
            const leftCol = k % 8 === 0
            const bottomRow = k >= 56
            const lift = isSel && !reduce
            const slide = board.last && board.last.to === i && !reduce ? slideDelta(board.last.from, i, flipped) : null
            const canPick = interactive && !!p && sideOfPiece(p) === board.side
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSquare(i)}
                disabled={!interactive}
                aria-label={`${squareName(i)}${p ? ` : ${p}` : ''}${isTarget ? ' (possible)' : ''}`}
                className={cn('relative aspect-square', interactive ? (canPick || isTarget ? 'cursor-pointer' : 'cursor-default') : 'cursor-default')}
                style={{ background: dark ? DARK : LIGHT }}
              >
                {isLast && <span className="absolute inset-0 bg-[#ffb703]/55" aria-hidden />}
                {i === checkedKing && (
                  <motion.span
                    className="absolute inset-0"
                    style={{ background: 'radial-gradient(circle, rgba(239,71,111,.95) 0%, rgba(239,71,111,.6) 45%, rgba(239,71,111,0) 80%)' }}
                    animate={reduce || matedKing === i ? undefined : { opacity: [1, 0.55, 1] }}
                    transition={{ repeat: Infinity, duration: 0.9 }}
                    aria-hidden
                  />
                )}
                {isSel && <span className="absolute inset-0 bg-[#ffb703]/70 ring-4 ring-[#ffb703] ring-inset" aria-hidden />}
                {leftCol && (
                  <span className="pointer-events-none absolute top-0.5 left-1 text-[10px] leading-none font-extrabold" style={{ color: dark ? LIGHT : FRAME }}>
                    {8 - rowOf(i)}
                  </span>
                )}
                {bottomRow && (
                  <span className="pointer-events-none absolute right-1 bottom-0.5 text-[10px] leading-none font-extrabold" style={{ color: dark ? LIGHT : FRAME }}>
                    {FILES[colOf(i)]}
                  </span>
                )}
                {p && (
                  <motion.span
                    key={slide ? lastKey : `${i}-${p}`}
                    className="absolute inset-[6%] z-10"
                    initial={slide ? { x: `${slide.dx * 112}%`, y: `${slide.dy * 112}%` } : false}
                    animate={
                      shake?.i === i
                        ? { x: [0, -6, 6, -4, 4, 0], y: 0, scale: 1, rotate: 0 }
                        : { x: 0, y: lift ? '-10%' : 0, scale: lift ? 1.14 : 1, rotate: matedKing === i ? 90 : 0 }
                    }
                    transition={shake?.i === i ? { duration: 0.35 } : { type: 'spring', stiffness: 420, damping: 30 }}
                    onAnimationComplete={() => {
                      if (shake?.i === i) setShake(null)
                    }}
                  >
                    <Piece piece={p} theme={themes[sideOfPiece(p)]} />
                  </motion.span>
                )}
                {isTarget &&
                  (p || (board.ep === i && pieceAt(board.sq, sel ?? -1)?.toLowerCase() === 'p') ? (
                    <span className="pointer-events-none absolute inset-[4%] z-20 rounded-full border-[5px] border-[#1f1b2e]/45" aria-hidden />
                  ) : (
                    <span className="pointer-events-none absolute inset-[35%] z-20 rounded-full bg-[#1f1b2e]/40" aria-hidden />
                  ))}
              </button>
            )
          })}
        </div>

        {/* « Échec ! » */}
        <AnimatePresence>
          {board.check && !ended && (
            <motion.div
              key={`check-${board.full}-${board.side}`}
              className="pointer-events-none absolute inset-x-0 top-[40%] z-30 flex justify-center"
              initial={{ scale: 0.3, opacity: 0, rotate: -10 }}
              animate={{ scale: [0.3, 1.2, 1], opacity: [0, 1, 1, 0], rotate: -6 }}
              transition={{ duration: 1.6, times: [0, 0.25, 0.8, 1] }}
            >
              <span className="rounded-2xl border-[4px] border-ink bg-tomato px-4 py-1 font-display text-3xl font-extrabold text-white shadow-sticker">Échec !</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {promo && interactive && (
            <PromotionPicker
              side={board.side}
              onPick={(p) => send(promo.from, promo.to, p)}
              onCancel={() => {
                setPromo(null)
                setSel(null)
              }}
            />
          )}
        </AnimatePresence>
      </div>

      <PlayerBar board={board} side={bottomSide} me={me} get={get} active={!ended && phase === 'playing' && board.side === bottomSide} clockMs={clockOf(bottomSide)} ended={ended} />

      {/* Fin de manche : la raison en clair */}
      {board.end && (
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={cn('sticker flex items-center justify-center gap-2 px-3 py-2 text-center font-display text-xl font-extrabold', board.end.winner ? 'bg-sun text-[#1f1b2e]' : 'bg-sky text-[#1f1b2e]')}
        >
          <span className="text-2xl">{END_LABELS[board.end.reason].emoji}</span>
          <span>{endLabel(board.end)}</span>
        </motion.div>
      )}

      {/* Proposition de nul */}
      {phase === 'playing' && !ended && board.draw_offer && (
        <div className="sticker flex flex-col items-center gap-2 bg-mint p-2 text-center text-[#1f1b2e]">
          {offerFromOpp ? (
            <>
              <span className="font-display text-lg font-extrabold">🤝 {get(opponent!).nickname} propose nul</span>
              {isMyTurn ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      fx.pop()
                      onMove({ type: 'accept_draw' })
                    }}
                    className="rounded-full border-[3px] border-ink bg-surface px-4 py-1 font-display text-lg font-extrabold shadow-sticker-sm"
                  >
                    Accepter le nul
                  </button>
                  <span className="text-xs font-bold">… ou joue ton coup pour refuser.</span>
                </>
              ) : null}
            </>
          ) : board.draw_offer === me ? (
            <span className="font-display font-extrabold">🤝 Nul proposé : réponse à son prochain coup…</span>
          ) : (
            <span className="font-display font-extrabold">🤝 {get(board.draw_offer).nickname} propose nul</span>
          )}
        </div>
      )}

      {showControls && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={!isMyTurn || pending || offerFromOpp}
            onClick={() => {
              fx.pop()
              setOfferDraw((v) => !v)
            }}
            aria-pressed={offerDraw}
            className={cn(
              'rounded-full border-[3px] border-ink px-3 py-1 font-display font-extrabold disabled:opacity-40',
              offerDraw ? 'bg-mint text-[#1f1b2e] shadow-sticker-sm' : 'bg-surface',
            )}
          >
            🤝 {offerDraw ? 'Nul proposé avec ton coup' : 'Proposer nul'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmResign(true)}
            className="rounded-full border-[3px] border-ink bg-surface px-3 py-1 font-display font-extrabold"
          >
            🏳️ Abandonner
          </button>
        </div>
      )}
      {showControls && interactive && sel === null && board.full === 1 && board.side === 'w' && (
        <p className="text-center text-xs text-muted">Touche une de tes pièces : ses cases possibles s’allument.</p>
      )}

      {!tv && <Aide open={help} onToggle={() => setHelp((v) => !v)} />}

      <ConfirmModal
        open={confirmResign}
        onClose={() => setConfirmResign(false)}
        title="Abandonner la manche ?"
        confirmLabel="J’abandonne"
        danger
        onConfirm={() => {
          setConfirmResign(false)
          onMove({ type: 'resign' })
        }}
      >
        {opponent ? `${get(opponent).nickname} remporte la manche.` : 'Ton adversaire remporte la manche.'}
      </ConfirmModal>
    </div>
  )
}

/** Barre d'actions collée en bas : gros boutons selon la phase, minuteur, absent / passer le tour. */
import { Dices, Home, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { BOARD, JAIL_FINE } from './board'
import { eur } from './format'
import { PHASE_LABELS, cellsOf, tdpActions } from './rules'
import type { TdpAction, TdpState } from './types'

interface Props {
  s: TdpState
  meId: string
  isHost: boolean
  pending: boolean
  /** ms restantes avant l'échéance de la décision (0 si pas de minuteur). */
  left: number
  name: (id: string | null | undefined) => string
  send: (a: TdpAction) => void
  onRoll: () => void
  onAssets: () => void
}

export default function Actions({ s, meId, isHost, pending, left, name, send, onRoll, onAssets }: Props) {
  const active = ['roll', 'jail', 'buy', 'manage', 'debt'].includes(s.phase)
  if (!active) return null
  const myTurn = s.turn === meId
  const cash = s.cash[meId] ?? 0
  const iAmAway = s.away.includes(meId)
  const hasAssets = cellsOf(s, meId).length > 0
  const total = s.turn_seconds * 1000
  const frac = total > 0 ? Math.min(1, left / total) : 0
  const secs = Math.ceil(left / 1000)

  return (
    <div className="pb-safe sticky bottom-0 z-30 -mx-4 bg-linear-to-t from-paper via-paper to-paper/85 px-4 pt-3 pb-3">
      <div className="mx-auto flex max-w-md flex-col gap-2">
        {s.deadline && (
          <div className="flex items-center gap-2" aria-label={`Temps restant : ${secs} secondes`}>
            <div className="h-3 flex-1 overflow-hidden rounded-full border-2 border-ink bg-surface">
              <div
                className={cn('h-full rounded-full transition-[width] duration-300 ease-linear', frac < 0.25 ? 'bg-tomato' : frac < 0.5 ? 'bg-tangerine' : 'bg-mint')}
                style={{ width: `${frac * 100}%` }}
              />
            </div>
            <span className={cn('w-12 text-right font-display text-lg leading-none font-extrabold tabular-nums', frac < 0.25 && 'text-tomato')}>{secs} s</span>
          </div>
        )}

        {iAmAway && (
          <div className="flex items-center gap-2 rounded-card border-[3px] border-ink bg-sun p-2 text-[#1f1b2e]">
            <span className="min-w-0 flex-1 text-sm leading-tight font-bold">💤 Tu es marqué·e absent·e : tes tours sont joués automatiquement.</span>
            <Button size="sm" disabled={pending} onClick={() => send(tdpActions.back())}>
              Je suis là !
            </Button>
          </div>
        )}

        {!myTurn && (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-sm leading-tight font-bold">
              <span className="text-muted">Au tour de </span>
              {name(s.turn)}
              <span className="block text-xs font-semibold text-muted">{PHASE_LABELS[s.phase]}</span>
            </p>
            {isHost && (
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => send(tdpActions.skip())}>
                Passer le tour de {name(s.turn)}
              </Button>
            )}
          </div>
        )}

        {myTurn && s.phase === 'roll' && (
          <Button size="lg" fullWidth icon={<Dices className="size-6" />} disabled={pending} onClick={onRoll}>
            {s.doubles > 0 ? 'Double ! Relancer' : 'Lancer les dés'}
          </Button>
        )}

        {myTurn && s.phase === 'jail' && (
          <div className="flex flex-col gap-2">
            <p className="text-center text-sm font-bold">
              🚔 Au violon · essai {Math.min(3, (s.jail[meId] ?? 0) + 1)}/3
            </p>
            <Button size="lg" fullWidth icon={<Dices className="size-6" />} disabled={pending} onClick={onRoll}>
              Tenter le double
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" className="min-h-12" disabled={pending || cash < JAIL_FINE} onClick={() => send(tdpActions.payJail())}>
                Payer {eur(JAIL_FINE)}
              </Button>
              <Button size="sm" variant="secondary" className="min-h-12" icon={<Ticket className="size-4" />} disabled={pending || (s.jail_cards[meId]?.length ?? 0) === 0} onClick={() => send(tdpActions.useCard())}>
                Carte sortie
              </Button>
            </div>
          </div>
        )}

        {myTurn && s.phase === 'buy' && s.pending && (
          <div className="flex flex-col gap-2">
            <p className="text-center text-sm leading-tight font-bold">
              {BOARD[s.pending.cell].name} · {eur(s.pending.price)} · ton argent : {eur(cash)}
              {cash < s.pending.price && <span className="block text-tomato">Il te manque {eur(s.pending.price - cash)}.</span>}
            </p>
            <div className="grid grid-cols-[3fr_2fr] gap-2">
              <Button size="lg" className="min-h-14 px-3 text-xl" disabled={pending || cash < s.pending.price} onClick={() => send(tdpActions.buy())}>
                Acheter
              </Button>
              <Button size="lg" variant="secondary" className="min-h-14 px-3 text-xl" disabled={pending} onClick={() => send(tdpActions.pass())}>
                Passer
              </Button>
            </div>
          </div>
        )}

        {myTurn && s.phase === 'manage' && (
          <Button size="lg" fullWidth disabled={pending} onClick={() => send(tdpActions.endTurn())}>
            Finir le tour
          </Button>
        )}

        {myTurn && s.phase === 'debt' && (
          <Button size="lg" variant="danger" fullWidth icon={<Home className="size-6" />} onClick={onAssets}>
            Dette de {eur(-cash)} : vendre
          </Button>
        )}

        {myTurn && s.phase !== 'debt' && s.phase !== 'buy' && hasAssets && (
          <>
            <Button size="sm" variant="secondary" fullWidth icon={<Home className="size-4" />} onClick={onAssets}>
              Mes biens (construire / vendre)
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

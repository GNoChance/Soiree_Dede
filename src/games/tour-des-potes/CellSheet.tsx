/** Fiche d'une case (BottomSheet) : description, anecdote, loyers, propriétaire, construire / vendre. */
import { Hammer, Landmark } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/Modal'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '../types'
import { MiniFace } from './PlayBoard'
import { BOARD, GROUPS, POTES_RENTS, SERVICE_MULT, type BoardCell } from './board'
import { CELL_KIND_LABEL, CELL_RULE, cityName, eur, levelLabel, whyNotBuild, whyNotSell } from './format'
import { canBuild, canSell, cellsOf, levelOf, ownerOf, ownsGroup, rentFor, tdpActions } from './rules'
import type { TdpAction, TdpState } from './types'

interface Props {
  cell: number | null
  s: TdpState
  meId: string
  players: Record<string, PlayerInfo>
  pending: boolean
  send: (a: TdpAction) => void
  onClose: () => void
}

export default function CellSheet({ cell: index, s, meId, players, pending, send, onClose }: Props) {
  const c = index === null ? null : BOARD[index]
  return (
    <BottomSheet
      open={c !== null}
      onClose={onClose}
      title={c?.name}
      footer={c && index !== null ? <SheetFooter cell={c} s={s} meId={meId} pending={pending} send={send} /> : undefined}
    >
      {c && index !== null && <SheetBody cell={c} s={s} meId={meId} players={players} />}
    </BottomSheet>
  )
}

function SheetBody({ cell: c, s, meId, players }: { cell: BoardCell; s: TdpState; meId: string; players: Record<string, PlayerInfo> }) {
  const owner = ownerOf(s, c.i)
  const lvl = levelOf(s, c.i)
  const here = s.order.filter((id) => s.pos[id] === c.i && !s.bankrupt.includes(id))
  const ownerInfo = owner ? playerOrPlaceholder(players, owner) : null
  const potesOwned = owner && c.type === 'potes' ? cellsOf(s, owner).filter((i) => BOARD[i].type === 'potes').length : 0
  const servicesOwned = owner && c.type === 'service' ? cellsOf(s, owner).filter((i) => BOARD[i].type === 'service').length : 0
  const full = owner && c.group ? ownsGroup(s, owner, c.group) : false
  const group = c.type === 'quartier' && c.group && c.group in GROUPS ? GROUPS[c.group as keyof typeof GROUPS] : null

  return (
    <div className="flex flex-col gap-3 pb-1">
      <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
        <span
          className="inline-flex items-center gap-1.5 rounded-chip border-2 border-ink px-2.5 py-1 text-[#1f1b2e]"
          style={{ backgroundColor: c.color ?? 'var(--sunk)' }}
        >
          <span aria-hidden>{c.emoji ?? '📍'}</span>
          {CELL_KIND_LABEL[c.type]}
        </span>
        {cityName(c) && <span className="text-muted">{cityName(c)}</span>}
        {group && <span className="text-muted">· {group.label}</span>}
      </div>

      {c.description && <p className="leading-snug">{c.description}</p>}
      {c.anecdote && (
        <p className="rounded-card border-2 border-dashed border-ink/40 bg-sunk p-3 text-sm leading-snug italic">« {c.anecdote} »</p>
      )}
      {CELL_RULE[c.type] && <p className="leading-snug text-muted">{CELL_RULE[c.type]}</p>}
      {c.type === 'taxe' && <p className="font-display text-xl font-extrabold">Tu paies {eur(c.amount ?? 0)}.</p>}

      {c.price !== undefined && (
        <div className="flex flex-wrap gap-2 text-sm font-bold">
          <span className="rounded-chip border-2 border-ink bg-surface px-2.5 py-1">Prix {eur(c.price)}</span>
          {c.house !== undefined && <span className="rounded-chip border-2 border-ink bg-surface px-2.5 py-1">Maison {eur(c.house)}</span>}
        </div>
      )}

      {c.type === 'quartier' && c.rents && (
        <RentTable
          rows={c.rents.map((r, k) => ({
            label: k === 0 ? (full && lvl === 0 ? 'Terrain nu (quartier complet ×2)' : 'Terrain nu') : k === 5 ? 'Hôtel' : `${k} maison${k > 1 ? 's' : ''}`,
            value: k === 0 && full ? r * 2 : r,
            active: !!owner && lvl === k,
          }))}
        />
      )}
      {c.type === 'potes' && (
        <RentTable
          rows={POTES_RENTS.map((r, k) => ({
            label: `${k + 1} maison${k > 0 ? 's' : ''} des potes possédée${k > 0 ? 's' : ''}`,
            value: r,
            active: potesOwned === k + 1,
          }))}
        />
      )}
      {c.type === 'service' && (
        <RentTable
          rows={[
            { label: `1 service possédé : dés × ${SERVICE_MULT[0]}`, value: null, active: servicesOwned === 1 },
            { label: `2 services possédés : dés × ${SERVICE_MULT[1]}`, value: null, active: servicesOwned === 2 },
          ]}
        />
      )}

      {(c.type === 'quartier' || c.type === 'potes' || c.type === 'service') && (
        <div className="sticker-sm flex items-center gap-2 rounded-card border-2 bg-sunk p-2.5">
          {ownerInfo ? (
            <>
              <MiniFace player={ownerInfo} px={30} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate font-extrabold">{owner === meId ? 'Tu es propriétaire' : `Propriétaire : ${ownerInfo.nickname}`}</p>
                <p className="text-sm text-muted">
                  {c.type === 'quartier' ? levelLabel(lvl) : `Loyer actuel : ${eur(rentFor(s, c.i))}`}
                  {c.type === 'quartier' && ` · loyer ${eur(rentFor(s, c.i))}`}
                </p>
              </div>
            </>
          ) : (
            <>
              <Landmark className="size-6 shrink-0" />
              <p className="font-bold">À la banque : libre à l’achat.</p>
            </>
          )}
        </div>
      )}

      {here.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <span className="text-muted">Ici :</span>
          {here.map((id) => {
            const p = playerOrPlaceholder(players, id)
            return (
              <span key={id} className="inline-flex items-center gap-1">
                <MiniFace player={p} px={20} />
                {p.nickname}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RentTable({ rows }: { rows: { label: string; value: number | null; active: boolean }[] }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border-2 border-ink/80 text-sm">
      {rows.map((r) => (
        <div key={r.label} className={cn('flex items-center justify-between gap-2 px-3 py-1.5', r.active ? 'bg-sun font-extrabold text-[#1f1b2e]' : 'odd:bg-sunk')}>
          <span className="min-w-0">{r.label}</span>
          {r.value !== null && <span className="shrink-0 tabular-nums">{eur(r.value)}</span>}
        </div>
      ))}
    </div>
  )
}

function SheetFooter({ cell: c, s, meId, pending, send }: { cell: BoardCell; s: TdpState; meId: string; pending: boolean; send: (a: TdpAction) => void }) {
  if (c.type !== 'quartier' || ownerOf(s, c.i) !== meId) return null
  const lvl = levelOf(s, c.i)
  const build = canBuild(s, meId, c.i)
  const sell = canSell(s, meId, c.i)
  const hint = !build ? whyNotBuild(s, meId, c.i) : null
  const sellHint = !sell && lvl > 0 ? whyNotSell(s, meId, c.i) : null
  const refund = Math.floor((c.house ?? 0) / 2)
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" className="min-h-12" icon={<Hammer className="size-4" />} disabled={pending || !build} onClick={() => send(tdpActions.build(c.i))}>
          <span className="flex flex-col leading-tight"><span>{lvl === 4 ? 'Hôtel' : 'Construire'}</span><span className="text-sm">{eur(c.house ?? 0)}</span></span>
        </Button>
        <Button size="sm" className="min-h-12" variant="secondary" disabled={pending || !sell} onClick={() => send(tdpActions.sell(c.i))}>
          <span className="flex flex-col leading-tight"><span>Vendre</span><span className="text-sm">+{eur(refund)}</span></span>
        </Button>
      </div>
      {(hint || sellHint) && <p className="text-center text-sm text-muted">{hint ?? sellHint}</p>}
    </div>
  )
}

/** « Mes biens » : liste de mes lieux avec construire / vendre (utile surtout en phase de dette). */
import { BottomSheet } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { BOARD } from './board'
import { eur, levelLabel, whyNotBuild, whyNotSell } from './format'
import { canBuild, canSell, cellsOf, levelOf, rentFor, saleValue, tdpActions } from './rules'
import type { TdpAction, TdpState } from './types'

interface Props {
  open: boolean
  onClose: () => void
  s: TdpState
  meId: string
  pending: boolean
  send: (a: TdpAction) => void
  onOpenCell: (i: number) => void
}

export default function Assets({ open, onClose, s, meId, pending, send, onOpenCell }: Props) {
  const mine = cellsOf(s, meId)
  const cash = s.cash[meId] ?? 0
  const debt = s.phase === 'debt' && s.turn === meId
  return (
    <BottomSheet open={open} onClose={onClose} title="Mes biens">
      <div className="flex flex-col gap-3 pb-2">
        <p className={debt ? 'rounded-card border-2 border-ink bg-tomato p-3 font-extrabold text-white' : 'font-bold'}>
          {debt ? `Tu dois ${eur(-cash)} : vends des bâtiments jusqu’à repasser à 0 €.` : `Argent : ${eur(cash)}`}
        </p>
        {debt && <p className="text-sm text-muted">Tout vendre rapporterait {eur(saleValue(s, meId))}. Sinon, c’est la faillite.</p>}
        {mine.length === 0 && <p className="text-muted">Tu n’as encore aucun lieu. Achète-en en tombant sur une case libre !</p>}
        <ul className="flex flex-col gap-2">
          {mine.map((i) => {
            const c = BOARD[i]
            const lvl = levelOf(s, i)
            const isQ = c.type === 'quartier'
            const build = canBuild(s, meId, i)
            const sell = canSell(s, meId, i)
            const why = isQ && !build && !sell ? (lvl > 0 ? whyNotSell(s, meId, i) : whyNotBuild(s, meId, i)) : null
            return (
              <li key={i} className="flex flex-col gap-1.5 rounded-card border-2 border-ink/80 bg-sunk p-2">
                <div className="flex items-center gap-2">
                  <span className="size-4 shrink-0 rounded-full border-2 border-ink" style={{ backgroundColor: c.color ?? (c.type === 'potes' ? '#06d6a0' : '#4cc9f0') }} />
                  <button type="button" onClick={() => onOpenCell(i)} className="min-h-10 min-w-0 flex-1 text-left leading-tight">
                    <span className="line-clamp-2 block font-extrabold">{c.name}</span>
                    <span className="block text-xs text-muted">
                      {isQ ? `${levelLabel(lvl)} · ` : ''}loyer {eur(rentFor(s, i))}
                    </span>
                  </button>
                  {isQ && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" className="min-h-10 min-w-12 px-2" aria-label={`Construire sur ${c.name} (${c.house} €)`} disabled={pending || !build} onClick={() => send(tdpActions.build(i))}>
                        + {c.house}
                      </Button>
                      <Button size="sm" variant="secondary" className="min-h-10 min-w-12 px-2" aria-label={`Vendre un bâtiment sur ${c.name}`} disabled={pending || !sell} onClick={() => send(tdpActions.sell(i))}>
                        −
                      </Button>
                    </div>
                  )}
                </div>
                {why && <p className="pl-6 text-xs text-muted">{why}</p>}
              </li>
            )
          })}
        </ul>
      </div>
    </BottomSheet>
  )
}

import { useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { refreshProfile } from '@/lib/auth'
import { toastError } from '@/features/soiree/errors'
import { toast } from '@/store/toast'
import { getTrophy } from '@/data/trophees'
import { openAdventDay, useAdventState, type AdventState } from './api'
import { AdventCalendar } from './AdventCalendar'
import { AdventRewardModal, type AdventReward } from './AdventRewardModal'
import type { CaseStatus } from './layout'
import { usePlayersStore } from '@/features/soiree/players'

const pad = (n: number) => String(n).padStart(2, '0')
const dateOf = (year: number | undefined, d: number) => `${year}-12-${pad(d)}`

function statusFor(data: AdventState | null | undefined, d: number): CaseStatus {
  if (!data) return 'future'
  const date = dateOf(data.year, d)
  if (data.opened.includes(date)) return 'opened'
  if (data.done.includes(date)) return 'ready'
  if (date > data.today) return 'future'
  return date === data.today ? 'today' : 'missed'
}

/** Calendrier de l'Avent : 24 cases, une par jour du 1er au 24 décembre. */
export function AdventPage() {
  const navigate = useNavigate()
  const [version, setVersion] = useState(0)
  const { data, loading } = useAdventState(version)
  const [shown, setShown] = useState<AdventReward | null>(null)
  // Résultat du serveur, gardé jusqu'à la fin de l'animation d'ouverture de la porte.
  const pending = useRef<{ reward: AdventReward; trophy: boolean } | null>(null)

  const statuses = useMemo(() => Array.from({ length: 24 }, (_, i) => statusFor(data, i + 1)), [data])

  /** Appel serveur au tap (pendant que la porte tremble). En cas d'erreur : toast, et la porte se referme. */
  const openDay = async (d: number) => {
    try {
      const r = await openAdventDay(dateOf(data?.year, d))
      pending.current = { reward: { day: d, xp: r.xp, gifts: r.gifts ?? [] }, trophy: !!r.trophy }
      if (r.gifts?.length) void usePlayersStore.getState().load(true)
      setVersion((v) => v + 1)
      void refreshProfile().catch(() => undefined)
    } catch (e) {
      toastError(e)
      setVersion((v) => v + 1)
      throw e
    }
  }

  const revealed = (d: number) => {
    const p = pending.current
    pending.current = null
    setShown(p && p.reward.day === d ? p.reward : { day: d, xp: 0, gifts: [] })
    if (p?.trophy) toast.success(`Trophée « ${getTrophy('gen_esprit_noel')?.name ?? 'Esprit de Noël'} » : tu as débloqué la tenue Lutin ! 🧝`)
  }

  const tapStatic = (d: number, st: CaseStatus) => {
    if (st === 'opened') return setShown({ day: d, xp: 0, gifts: [] })
    if (st === 'future') return void toast('Pas touche ! Cette case s’ouvrira le jour J.')
    if (st === 'missed') return void toast('Trop tard : il fallait finir le défi ce jour-là. Pas de rattrapage !')
    if (st === 'today') return void toast('Finis le défi du jour pour ouvrir la case !')
  }

  const openedCount = data?.opened.length ?? 0
  const readyCount = data?.done.filter((x) => !data.opened.includes(x)).length ?? 0

  return (
    <div className="flex flex-col gap-4 pb-8">
      <button type="button" onClick={() => navigate(-1)} className="flex min-h-12 items-center gap-2 self-start font-extrabold">
        <ArrowLeft className="size-6" /> Retour
      </button>
      <h1 className="text-4xl">🎄 Calendrier de l’Avent</h1>
      <Card className="flex flex-col gap-1 text-[#1f1b2e]" accent="var(--color-mint)">
        <p className="font-extrabold">Termine le défi du jour pour ouvrir la case du jour : +25 XP et une surprise !</p>
        <p className="text-sm font-bold">
          {openedCount} case{openedCount > 1 ? 's' : ''} ouverte{openedCount > 1 ? 's' : ''} sur 24
          {readyCount > 0 && ` · ${readyCount} à ouvrir !`}
        </p>
      </Card>
      {loading && !data ? (
        <p className="text-center font-bold text-muted">Chargement…</p>
      ) : (
        <AdventCalendar statuses={statuses} onOpenDay={openDay} onRevealed={revealed} onTapStatic={tapStatic} />
      )}
      <Button variant="secondary" fullWidth onClick={() => navigate('/defi')}>
        Aller au défi du jour
      </Button>

      <AdventRewardModal shown={shown} onClose={() => setShown(null)} />
    </div>
  )
}

import { useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { adventDayItem } from '@/data/cadeaux'
import { toast } from '@/store/toast'
import { useSession } from '@/store/session'
import { AdventCalendar } from './AdventCalendar'
import { AdventRewardModal, type AdventReward } from './AdventRewardModal'
import type { CaseStatus } from './layout'

/** Données factices : nous sommes le 12 décembre, 6 cases ouvertes, 2 à ouvrir, 3 ratées. */
const initial = (): CaseStatus[] =>
  Array.from({ length: 24 }, (_, i): CaseStatus => {
    const d = i + 1
    if ([1, 2, 3, 5, 6, 9].includes(d)) return 'opened'
    if ([10, 11].includes(d)) return 'ready'
    if ([4, 7, 8].includes(d)) return 'missed'
    return d === 12 ? 'today' : 'future'
  })

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Contenu de l'aperçu (sans garde d'accès). Aucun appel serveur : tout est simulé en local. */
export function AdventPreview() {
  const navigate = useNavigate()
  const [statuses, setStatuses] = useState<CaseStatus[]>(initial)
  const [resetKey, setResetKey] = useState(0)
  const [shown, setShown] = useState<AdventReward | null>(null)
  const [fail, setFail] = useState(false)
  const pending = useRef<AdventReward | null>(null)

  const set = (day: number, st: CaseStatus) => setStatuses((s) => s.map((x, i) => (i === day - 1 ? st : x)))

  const openDay = async (day: number) => {
    await sleep(600) // la vraie ouverture appelle le serveur : on simule son délai
    if (fail) {
      toast('Erreur simulée : la porte se referme.')
      throw new Error('simulated')
    }
    const gift = adventDayItem(day)
    pending.current = { day, xp: 25, gifts: day % 2 === 1 && gift ? [gift.id] : [] }
    set(day, 'opened')
  }

  const revealed = (day: number) => {
    setShown(pending.current?.day === day ? pending.current : { day, xp: 25, gifts: [] })
    pending.current = null
  }

  const tapStatic = (day: number, st: CaseStatus) => {
    if (st === 'opened') return setShown({ day, xp: 0, gifts: [] })
    if (st === 'future') return void toast('Pas touche ! Cette case s’ouvrira le jour J.')
    if (st === 'missed') return void toast('Trop tard : il fallait finir le défi ce jour-là. Pas de rattrapage !')
    if (st === 'today') return void toast('Finis le défi du jour pour ouvrir la case !')
  }

  const openedCount = statuses.filter((s) => s === 'opened').length
  const readyCount = statuses.filter((s) => s === 'ready').length

  return (
    <div className="flex flex-col gap-4 pb-8">
      <button type="button" onClick={() => navigate(-1)} className="flex min-h-12 items-center gap-2 self-start font-extrabold">
        <ArrowLeft className="size-6" /> Retour
      </button>
      <p className="rounded-chip border-[3px] border-ink bg-sun px-3 py-2 text-center font-display font-extrabold text-[#1f1b2e]">
        Aperçu admin : rien n’est enregistré
      </p>
      <h1 className="text-4xl">🎄 Calendrier de l’Avent</h1>
      <Card className="flex flex-col gap-1 text-[#1f1b2e]" accent="var(--color-mint)">
        <p className="font-extrabold">Termine le défi du jour pour ouvrir la case du jour : +25 XP et une surprise !</p>
        <p className="text-sm font-bold">
          {openedCount} case{openedCount > 1 ? 's' : ''} ouverte{openedCount > 1 ? 's' : ''} sur 24
          {readyCount > 0 && ` · ${readyCount} à ouvrir !`}
        </p>
      </Card>
      <AdventCalendar key={resetKey} statuses={statuses} onOpenDay={openDay} onRevealed={revealed} onTapStatic={tapStatic} />
      <Button variant="secondary" fullWidth onClick={() => navigate('/defi')}>
        Aller au défi du jour
      </Button>

      <Card className="flex flex-col gap-2">
        <p className="font-display text-lg font-extrabold">Outils de démo</p>
        <Button
          fullWidth
          onClick={() => {
            setStatuses(initial())
            setResetKey((k) => k + 1)
          }}
        >
          Réinitialiser
        </Button>
        <Button variant="secondary" fullWidth onClick={() => set(24, 'ready')}>
          Rendre la 24 (double porte) prête
        </Button>
        <Button variant="secondary" fullWidth onClick={() => setStatuses((s) => s.map((x) => (x === 'opened' ? x : 'ready')))}>
          Toutes les cases fermées deviennent prêtes
        </Button>
        <Button variant="secondary" fullWidth onClick={() => setStatuses(Array<CaseStatus>(24).fill('opened'))}>
          Tout ouvrir (maison complète)
        </Button>
        <label className="flex min-h-12 items-center gap-3 font-extrabold">
          <input type="checkbox" className="size-6 accent-[var(--color-tomato)]" checked={fail} onChange={(e) => setFail(e.target.checked)} />
          Simuler une erreur serveur à l’ouverture
        </label>
      </Card>

      <AdventRewardModal shown={shown} onClose={() => setShown(null)} />
    </div>
  )
}

/** /avent-apercu : réservé à l'admin. */
export default function AdventPreviewPage() {
  const isAdmin = useSession((s) => !!(s.profile as { is_admin?: boolean } | null)?.is_admin)
  if (!isAdmin) return <Navigate to="/" replace />
  return <AdventPreview />
}

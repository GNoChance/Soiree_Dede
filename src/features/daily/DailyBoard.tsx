import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useSession } from '@/store/session'
import { cn } from '@/lib/cn'
import { useDailyRpc, type DailyBoard, type DailyRow, type DailyWeekBoard } from './api'

const MEDAL = ['🥇', '🥈', '🥉']

function Rows({ rows, week }: { rows: DailyRow[]; week: boolean }) {
  const me = useSession((s) => s.profile?.id)
  if (!rows.length) return <p className="py-6 text-center font-bold text-muted">Personne n’a encore joué. Sois le premier !</p>
  return (
    <ol className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.profile_id}
          className={cn('sticker flex items-center gap-3 bg-surface p-2 pr-3', r.profile_id === me && 'bg-sun/30')}
        >
          <span className="w-8 text-center text-xl font-extrabold">{r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span>
          <Avatar slug={r.slug} tenue={r.equipped_tenue} size={44} />
          <span className="min-w-0 flex-1 truncate text-lg font-extrabold">{r.nickname}</span>
          {r.streak > 1 && <span className="text-sm font-extrabold">🔥{r.streak}</span>}
          <span className="text-right text-lg font-extrabold">
            {r.score}
            {week && <span className="block text-xs font-bold text-muted">{r.days} j</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Classement du jour / de la semaine (lundi → dimanche). `version` force un rechargement. */
export function DailyBoardView({ version = 0 }: { version?: number }) {
  const [tab, setTab] = useState<'day' | 'week'>('day')
  const day = useDailyRpc<DailyBoard>('daily_board', version)
  const week = useDailyRpc<DailyWeekBoard>('daily_week_board', version)
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        ariaLabel="Période"
        value={tab}
        onChange={setTab}
        options={[{ value: 'day', label: 'Aujourd’hui' }, { value: 'week', label: 'Cette semaine' }]}
      />
      {tab === 'day' ? <Rows rows={day.data?.rows ?? []} week={false} /> : <Rows rows={week.data?.rows ?? []} week />}
    </div>
  )
}

import { Lock, Trophy } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { getTenue, TENUES } from '@/data/tenues'
import { GENERAL_TROPHIES, TROPHIES, trophiesOfTenue, type TrophyDef } from '@/data/trophees'

function Row({ t, got }: { t: TrophyDef; got: boolean }) {
  return (
    <li className={cn('flex items-start gap-2 rounded-chip border-2 border-ink px-2.5 py-1.5', got ? 'bg-sun text-[#1f1b2e]' : 'bg-sunk text-text')}>
      <span className="mt-0.5 shrink-0">{got ? <Trophy className="size-5" strokeWidth={2.5} /> : <Lock className="size-5 text-muted" strokeWidth={2.5} />}</span>
      <div className="min-w-0 flex-1">
        <p className="font-display leading-tight font-extrabold">{t.name}</p>
        <p className={cn('text-sm leading-snug font-bold', got ? 'text-[#1f1b2e]/75' : 'text-muted')}>
          {t.condition}
          {!got && !t.active && ' · bientôt disponible'}
        </p>
      </div>
    </li>
  )
}

function Group({ title, list, unlocked }: { title: string; list: TrophyDef[]; unlocked: Record<string, string> }) {
  const n = list.filter((t) => unlocked[t.id]).length
  return (
    <details className="group rounded-card border-[3px] border-ink bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 font-display text-lg font-extrabold">
        <span className="truncate">{title}</span>
        <Badge tone={n === list.length ? 'sun' : 'grape'}>
          {n}/{list.length}
        </Badge>
      </summary>
      <ul className="flex flex-col gap-1.5 px-2 pb-2">
        {list.map((t) => (
          <Row key={t.id} t={t} got={Boolean(unlocked[t.id])} />
        ))}
      </ul>
    </details>
  )
}

/** Trophées d'un joueur : obtenus / total, groupés par tenue (+ trophées généraux). */
export function TrophyBoard({ unlocked }: { unlocked: Record<string, string> }) {
  const total = TROPHIES.length
  const got = TROPHIES.filter((t) => unlocked[t.id]).length
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xl">
          <Trophy className="size-5" /> Trophées
        </h3>
        <Badge tone="sun">
          {got} / {total}
        </Badge>
      </div>
      <div className="flex flex-col gap-2">
        <Group title="🌟 Généraux" list={GENERAL_TROPHIES} unlocked={unlocked} />
        {TENUES.filter((t) => !t.default).map((t) => {
          const list = trophiesOfTenue(t.id)
          return list.length ? <Group key={t.id} title={`${getTenue(t.id)?.emoji ?? ''} ${t.label}`} list={list} unlocked={unlocked} /> : null
        })}
      </div>
    </Card>
  )
}

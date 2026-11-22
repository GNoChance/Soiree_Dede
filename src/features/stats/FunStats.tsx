import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { getGame } from '@/games/registry'
import { useFunStats } from './api'
import { buildFunCards } from './funCards'

const TONE = {
  sky: 'bg-sky',
  sun: 'bg-sun',
  mint: 'bg-mint',
  grape: 'bg-grape text-white',
  tomato: 'bg-tomato text-white',
  pink: 'bg-bubblegum',
} as const

/** Section « Stats fun » du profil : cartes sticker-book alimentées par fun_stats. */
export function FunStatsSection({ profileId, nickname }: { profileId: string; nickname: string }) {
  const { data, loading } = useFunStats(profileId)
  if (loading) return <Skeleton className="h-40 w-full" />
  if (!data) return null
  if (!data.enough)
    return (
      <Card className="flex flex-col gap-1 text-center">
        <h3 className="text-xl">🤪 Stats fun</h3>
        <p className="font-bold text-muted">
          Pas encore assez de parties ({data.games} sur {data.needed}). Continuez à jouer !
        </p>
      </Card>
    )
  const cards = buildFunCards(data, nickname, (id) => {
    const g = getGame(id)
    return g ? `${g.emoji} ${g.name}` : id
  })
  if (!cards.length)
    return <Card className="text-center font-bold text-muted">🤪 Stats fun : encore trop peu de parties par jeu ou par heure pour des révélations.</Card>
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-2xl">🤪 Stats fun</h3>
      {cards.map((c) => (
        <div key={c.id} className={`sticker flex items-center gap-3 rounded-card p-3 text-[#1f1b2e] ${TONE[c.tone]}`}>
          <span className="text-4xl" aria-hidden>
            {c.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold uppercase tracking-wide opacity-80">{c.title}</p>
            <p className="font-display text-3xl font-extrabold leading-none">{c.big}</p>
            <p className="mt-1 text-sm font-bold leading-snug">{c.text}</p>
          </div>
          {c.who && <Avatar slug={c.who.slug} tenue={c.who.equipped_tenue} size={52} />}
        </div>
      ))}
    </section>
  )
}

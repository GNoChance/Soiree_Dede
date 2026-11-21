import { useNavigate } from 'react-router'
import { Card } from '@/components/ui/Card'
import { isNoelSeason } from '@/features/noel/season'
import { useAdventState } from '@/features/advent/api'
import { useDailyToday } from './api'

/** Carte « Défi du jour » en haut du hub : à faire / fait (score + rang). */
export function DailyCard() {
  const navigate = useNavigate()
  const { data } = useDailyToday()
  const done = data?.status === 'done'
  const noel = isNoelSeason()
  const advent = useAdventState()
  const ready = advent.data ? advent.data.done.filter((x) => !advent.data!.opened.includes(x)).length : 0
  const card = (
    <Card onClick={() => navigate('/defi')} accent={done ? 'var(--color-mint)' : 'var(--color-sun)'} className="flex items-center gap-3 text-[#1f1b2e]">
      <span className="text-4xl">🗓️</span>
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-extrabold leading-tight">Défi du jour</h2>
        <p className="text-sm font-bold leading-snug">
          {!data && 'Un défi par jour, pour tout le monde !'}
          {data?.status === 'todo' && '6 manches, 2 minutes. À toi de jouer !'}
          {(data?.status === 'running' || data?.status === 'missed') && 'Défi commencé… à demain pour le prochain !'}
          {done && `Fait : ${data.score} pts · ${data.rank === 1 ? '1er' : `${data.rank}e`} sur ${data.players}`}
        </p>
      </div>
      {data && data.streak > 0 && <span className="rounded-chip border-2 border-ink bg-white px-2 py-1 text-sm font-extrabold">🔥 {data.streak}</span>}
      <span className="text-sm font-extrabold">{done ? 'Classement' : 'Jouer'}</span>
    </Card>
  )
  if (!noel) return card
  return (
    <div className="flex flex-col gap-2">
      {card}
      <Card onClick={() => navigate('/avent')} accent="var(--color-mint)" className="flex items-center gap-3 text-[#1f1b2e]">
        <span className="text-3xl">🎄</span>
        <span className="flex-1 text-lg font-extrabold leading-tight">Calendrier de l’Avent</span>
        {ready > 0 && <span className="rounded-chip border-2 border-ink bg-sun px-2 py-1 text-sm font-extrabold">🎁 {ready} à ouvrir</span>}
        <span className="text-sm font-extrabold">Ouvrir</span>
      </Card>
    </div>
  )
}

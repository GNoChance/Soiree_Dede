import { useNavigate } from 'react-router'
import { Card } from '@/components/ui/Card'
import { useDailyToday } from './api'

/** Carte « Défi du jour » en haut du hub : à faire / fait (score + rang). */
export function DailyCard() {
  const navigate = useNavigate()
  const { data } = useDailyToday()
  const done = data?.status === 'done'
  return (
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
}

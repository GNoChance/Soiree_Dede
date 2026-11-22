import { motion, useReducedMotion } from 'framer-motion'
import { Swords } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { getGame } from '@/games/registry'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { useMyChallenges } from './api'

/**
 * Carte du hub « Défis entre potes » : bandeau rouge quand on m'a défié (le plus ancien d'abord,
 * + compteur), rappel d'un défi accepté à jouer, sinon simple entrée vers /defis-potes.
 */
export function ChallengeHubCard() {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const { byId } = usePlayers()
  const { data } = useMyChallenges()
  const list = data?.challenges ?? []
  const received = list.filter((c) => c.status === 'pending' && c.role === 'received')
  const toPlay = list.filter((c) => c.status === 'accepted' && c.match_status !== 'finished')
  const go = () => navigate('/defis-potes')

  if (received.length) {
    const c = received[received.length - 1]
    const p = playerOrPlaceholder(byId, c.other_id)
    const g = getGame(c.game_id)
    return (
      <motion.div animate={reduce ? undefined : { rotate: [0, -1.5, 1.5, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>
        <Card onClick={go} accent="var(--color-tomato)" className="flex items-center gap-3 text-white" aria-label="Voir les défis reçus">
          <Avatar slug={p.slug} tenue={p.equippedTenue} expression={p.equipped} size={56} />
          <div className="min-w-0 flex-1">
            <p className="font-display text-xl leading-tight font-extrabold">
              ⚔️ {p.nickname} te défie {g ? `au ${g.emoji} ${g.name}` : ''} !
            </p>
            <p className="text-sm font-bold">
              {c.stake ? `Enjeu : ${c.stake} 🪙` : 'Pour la gloire'}
              {received.length > 1 ? ` · +${received.length - 1} autre${received.length > 2 ? 's' : ''} défi${received.length > 2 ? 's' : ''}` : ''}
            </p>
          </div>
          <span className="shrink-0 rounded-full border-[3px] border-ink bg-surface px-3 py-1 font-extrabold text-text">Répondre</span>
        </Card>
      </motion.div>
    )
  }
  if (toPlay.length) {
    const c = toPlay[0]
    const g = getGame(c.game_id)
    return (
      <Card onClick={go} accent="var(--color-sky)" className="flex items-center gap-3 text-[#1f1b2e]">
        <Swords className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-tight font-extrabold">
            Défi à jouer contre {playerOrPlaceholder(byId, c.other_id).nickname} {g ? g.emoji : ''}
          </p>
          <p className="text-sm font-bold">{c.stake ? `Pot : ${2 * c.stake} 🪙` : 'Pour la gloire'}</p>
        </div>
        <span className="text-sm font-extrabold">Jouer</span>
      </Card>
    )
  }
  return (
    <Card onClick={go} className="flex items-center gap-3">
      <Swords className="size-7 text-tomato" />
      <div className="min-w-0 flex-1">
        <span className="text-xl font-extrabold">Défis entre potes</span>
        <p className="text-sm leading-snug text-muted">Défie un pote en duel et mise des pièces 🪙</p>
      </div>
      <span className="text-sm font-bold text-muted">Voir</span>
    </Card>
  )
}

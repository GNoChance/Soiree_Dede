import { motion } from 'framer-motion'
import { History, Trophy } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useState } from 'react'
import { GAMES } from '@/games/registry'
import type { GameDefinition } from '@/games/types'
import { GameInfoModal } from '@/features/tutos/GameInfoModal'
import { DailyCard } from '@/features/daily/DailyCard'
import { SoireeLauncher } from '@/features/soiree/SoireeLauncher'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { XpBar } from '@/components/ui/XpBar'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { useSession } from '@/store/session'
import { xpProgress } from '@/lib/xp'

export function HubPage() {
  const navigate = useNavigate()
  const profile = useSession((s) => s.profile)
  const stats = useSession((s) => s.stats)
  const level = profile ? xpProgress(profile.xp).level : 1
  const [infoGame, setInfoGame] = useState<GameDefinition | null>(null)

  return (
    <StaggerList className="flex flex-col gap-4">
      {profile && (
        <StaggerItem>
          <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <motion.button type="button" aria-label="Voir mon profil" onClick={() => navigate(`/profil/${profile.id}`)} key={profile.equipped_expression} initial={{ scale: 0.6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 12 }}>
                <Avatar slug={profile.slug} expression={profile.equipped_expression} tenue={profile.equipped_tenue} size={72} />
              </motion.button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-muted">Salut,</p>
                <h1 className="truncate text-3xl">{profile.nickname} !</h1>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge tone="grape">Niveau {level}</Badge>
                  <Badge tone="sun">
                    <Trophy className="size-3.5" />
                    <AnimatedNumber value={stats?.wins ?? 0} /> victoire{(stats?.wins ?? 0) > 1 ? 's' : ''}
                  </Badge>
                </div>
              </div>
            </div>
            <XpBar xp={profile.xp} />
          </Card>
        </StaggerItem>
      )}
      <StaggerItem>
        <DailyCard />
      </StaggerItem>
      <StaggerItem>
        <SoireeLauncher />
      </StaggerItem>
      <StaggerItem>
        <Card onClick={() => navigate('/historique')} className="flex items-center gap-3">
          <History className="size-7 text-grape" />
          <span className="flex-1 text-xl font-extrabold">Mes soirées passées</span>
          <span className="text-sm font-bold text-muted">Voir</span>
        </Card>
      </StaggerItem>
      <StaggerItem>
        <h2 className="text-2xl">Les jeux</h2>
      </StaggerItem>
      {GAMES.map((g) => (
        <StaggerItem key={g.id}>
          <Card
            tilt
            accent={g.color}
            onClick={() => setInfoGame(g)}
            className="flex items-center gap-4 text-[#1f1b2e]"
          >
            <motion.span
              className="text-5xl"
              animate={{ rotate: [0, -8, 8, 0] }}
              transition={{ repeat: Infinity, duration: 3.5, ease: 'easeInOut' }}
            >
              {g.emoji}
            </motion.span>
            <div className="flex-1">
              <h3 className="text-2xl">{g.name}</h3>
              <p className="text-sm leading-snug">{g.tagline}</p>
              <Badge tone="neutral" className="mt-2">{g.minPlayers}-{g.maxPlayers} joueurs</Badge>
            </div>
          </Card>
        </StaggerItem>
      ))}
      <GameInfoModal game={infoGame} onClose={() => setInfoGame(null)} />
    </StaggerList>
  )
}

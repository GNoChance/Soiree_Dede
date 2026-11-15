import { Link } from 'react-router'
import { GAMES } from '@/games/registry'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { useSession } from '@/store/session'
import { Avatar } from '@/components/ui/Avatar'

export function HubPage() {
  const profile = useSession((s) => s.profile)
  return (
    <StaggerList className="flex flex-col gap-4">
      <StaggerItem className="flex items-center gap-3">
        {profile && <Avatar slug={profile.slug} expression={profile.equipped_expression} size={56} />}
        <div>
          <p className="text-muted">Salut,</p>
          <h1 className="text-3xl">{profile?.nickname} !</h1>
        </div>
      </StaggerItem>
      <StaggerItem>
        <Badge tone="mint">Soirée : bientôt</Badge>
      </StaggerItem>
      {GAMES.map((g) => (
        <StaggerItem key={g.id}>
          <Card tilt interactive accent={g.color} className="flex items-center gap-4 text-[#1f1b2e]">
            <span className="text-5xl">{g.emoji}</span>
            <div className="flex-1">
              <h2 className="text-2xl">{g.name}</h2>
              <p className="text-sm leading-snug">{g.tagline}</p>
              <Badge tone="neutral" className="mt-2">{g.minPlayers}-{g.maxPlayers} joueurs</Badge>
            </div>
          </Card>
        </StaggerItem>
      ))}
      <StaggerItem>
        <Link to="/soiree/demo" className="block text-center font-display font-bold text-muted underline">
          (dev) ouvrir un salon de démo
        </Link>
      </StaggerItem>
    </StaggerList>
  )
}

import { useParams } from 'react-router'
import { ComingSoon } from '@/components/layout/ComingSoon'

export const InventoryPage = () => (
  <ComingSoon title="Inventaire" expression="cool" text="Ici tu équiperas tes expressions débloquées." />
)
export const LeaderboardPage = () => (
  <ComingSoon title="Classement" expression="gamer" text="Qui est le roi (ou la reine) des soirées ?" />
)
export const FriendsPage = () => (
  <ComingSoon title="Amis" expression="amoureux" text="Ajoute tes amis et débloque des expressions." />
)
export const SoireePage = () => {
  const { id } = useParams()
  return <ComingSoon title="Salon" expression="surprise" text={`Le salon de la soirée ${id} arrive bientôt.`} />
}
export const MatchPage = () => {
  const { matchId } = useParams()
  return <ComingSoon title="Partie" expression="reflexion" text={`La partie ${matchId} arrive bientôt.`} />
}

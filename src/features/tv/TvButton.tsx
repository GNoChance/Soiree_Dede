import { Tv } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'

/** Bouton « 📺 Mode télé » : ouvre la vue spectateur plein écran de la soirée. */
export function TvButton({ soireeId }: { soireeId: string }) {
  const navigate = useNavigate()
  return (
    <Button variant="secondary" size="sm" icon={<Tv className="size-4" />} onClick={() => navigate(`/soiree/${soireeId}/tele`)}>
      📺 Mode télé
    </Button>
  )
}

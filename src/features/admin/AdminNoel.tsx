import { useState } from 'react'
import { Eye, PlayCircle } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useNoelStore } from '@/features/noel/api'
import { useNoelIntro } from '@/features/noel/intro'
import { toastError } from '@/features/soiree/errors'

/** Édition de Noël la plus proche : du 1er décembre au 6 janvier. */
function edition(): { min: string; max: string; start: string } {
  const now = new Date()
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const min = `${y}-12-01`
  const max = `${y + 1}-01-06`
  const today = now.toISOString().slice(0, 10)
  return { min, max, start: today >= min && today <= max ? today : min }
}

/** Admin : essayer l'événement de Noël avant l'heure (page, Hotte, vidéo), sans rien enregistrer. */
export function AdminNoel() {
  const navigate = useNavigate()
  const ed = edition()
  const [day, setDay] = useState(ed.start)
  const [busy, setBusy] = useState(false)
  const start = useNoelStore((s) => s.startPreview)
  const replay = useNoelIntro((s) => s.replay)

  const go = async () => {
    setBusy(true)
    try {
      await start(day)
      navigate('/noel')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="flex items-center gap-2 font-display text-lg font-extrabold">🎄 Admin : aperçu de Noël</p>
      <p className="text-sm font-bold text-muted">
        Vois la page, les missions et la Hotte comme un jour de l’événement. Rien n’est enregistré (ni flocons, ni pièces).
      </p>
      <input
        type="date"
        aria-label="Jour simulé"
        value={day}
        min={ed.min}
        max={ed.max}
        onChange={(e) => setDay(e.target.value)}
        className="sticker-sm w-full min-w-0 rounded-card border-[3px] border-ink bg-surface px-3 py-2 font-display text-lg font-extrabold text-text outline-none"
      />
      <Button fullWidth loading={busy} disabled={!day} icon={<Eye className="size-5" />} onClick={() => void go()}>
        Lancer l’aperçu
      </Button>
      <Button variant="secondary" fullWidth icon={<PlayCircle className="size-5" />} onClick={replay}>
        Voir la vidéo d’annonce
      </Button>
    </Card>
  )
}

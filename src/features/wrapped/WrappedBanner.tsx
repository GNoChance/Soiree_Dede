import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { wrappedBannerYear, wrappedButtonYear } from './api'
import { WrappedViewer } from './WrappedViewer'

/** Bannière du hub « Ton année est prête ! » (15 décembre - 31 janvier, heure de Paris ; ?wrapped=AAAA force). */
export function WrappedBanner() {
  const [open, setOpen] = useState(false)
  const [year] = useState(() => wrappedBannerYear())
  if (!year) return null
  return (
    <>
      <Card onClick={() => setOpen(true)} accent="var(--color-bubblegum)" className="flex items-center gap-3 text-[#1f1b2e]">
        <span className="text-4xl">🎁</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-extrabold leading-tight">Ton année {year} est prête !</h2>
          <p className="text-sm font-bold leading-snug">Tes stats, tes records, ta personnalité…</p>
        </div>
        <span className="text-sm font-extrabold">Voir</span>
      </Card>
      {open && <WrappedViewer year={year} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Bouton permanent (profil) : ouvre « Mon année ». */
export function WrappedButton() {
  const [open, setOpen] = useState(false)
  const [year] = useState(() => wrappedButtonYear())
  return (
    <>
      <Button variant="secondary" fullWidth icon={<Sparkles className="size-5" />} onClick={() => setOpen(true)}>
        Mon année {year}
      </Button>
      {open && <WrappedViewer year={year} onClose={() => setOpen(false)} />}
    </>
  )
}

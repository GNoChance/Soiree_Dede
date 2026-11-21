import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { Verdict } from './records'

/** Bandeau de titre de l'écran de choix (même esprit que « Jouer seul »). */
export function TrainingHeader({ title, color, onBack }: { title: string; color: string; onBack: () => void }) {
  return (
    <>
      <button type="button" onClick={onBack} className="flex min-h-12 items-center gap-2 self-start font-extrabold">
        <ArrowLeft className="size-6" /> Retour
      </button>
      <div className="rounded-card border-[3px] border-ink p-4 text-center shadow-sticker" style={{ background: color }}>
        <p className="font-display text-sm font-extrabold uppercase tracking-wide text-[#1f1b2e]">Mode entraînement 🏋️</p>
        <h1 className="text-3xl text-[#1f1b2e]">{title}</h1>
      </div>
    </>
  )
}

/** Gros bouton de choix (parcours, circuit…) avec son record. */
export function ChoiceCard({ on, onClick, emoji, title, text, record }: { on: boolean; onClick: () => void; emoji: string; title: string; text?: string; record?: string | null }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center gap-3 rounded-card border-[3px] border-ink p-3 text-left',
        on ? 'bg-sun text-[#1f1b2e] shadow-sticker' : 'bg-surface shadow-sticker-sm',
      )}
    >
      <span className="text-4xl">{emoji}</span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="font-display text-xl font-extrabold">{title}</span>
        {text && <span className="text-sm font-bold opacity-80">{text}</span>}
        <span className="mt-0.5 text-sm font-extrabold">{record ? `🏆 Record : ${record}` : 'Pas encore de record'}</span>
      </span>
    </motion.button>
  )
}

export const FOOT_NOTE = 'Mode entraînement : rien n’est compté (ni XP, ni trophée), et ça marche sans soirée.'

/** Écran de fin : score, record battu ou non, Rejouer / Changer / Retour. */
export function EndScreen({
  emoji, headline, score, detail, verdict, format, extra, onReplay, onChange, onBack,
}: {
  emoji: string
  headline: string
  /** Gros score affiché. */
  score: string
  detail?: string
  verdict: Verdict | null
  /** Mise en forme d'un record (« −2 », « 52,3 s »…). */
  format: (n: number) => string
  extra?: ReactNode
  onReplay: () => void
  onChange: () => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-col gap-4 pb-8">
      <motion.div
        initial={{ scale: 0.6, rotate: -6 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className="sticker flex flex-col items-center gap-1 bg-sun p-5 text-center text-[#1f1b2e]"
      >
        <span className="text-6xl">{emoji}</span>
        <h1 className="font-display text-2xl font-extrabold">{headline}</h1>
        <p className="font-display text-5xl leading-none font-extrabold tabular-nums">{score}</p>
        {detail && <p className="font-bold">{detail}</p>}
      </motion.div>

      {verdict && (
        <div className={cn('sticker-sm p-3 text-center font-display text-xl font-extrabold', verdict.beaten ? 'bg-mint text-[#1f1b2e]' : 'bg-surface')}>
          {verdict.first
            ? '🏆 Premier record enregistré !'
            : verdict.beaten
              ? `🏆 Nouveau record ! (avant : ${format(verdict.previous as number)})`
              : `Ton record reste ${format(verdict.previous as number)}. Tu peux le battre !`}
        </div>
      )}

      {extra}

      <Button size="lg" fullWidth onClick={onReplay}>
        Rejouer
      </Button>
      <Button variant="secondary" fullWidth onClick={onChange}>
        Changer d’options
      </Button>
      <Button variant="ghost" fullWidth onClick={onBack}>
        Retour
      </Button>
      <p className="text-center text-sm font-bold text-muted">{FOOT_NOTE}</p>
    </div>
  )
}

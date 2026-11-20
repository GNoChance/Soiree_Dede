import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { pickExpression } from '@/features/soiree/players'
import type { PlayerInfo } from '@/games/types'
import { cn } from '@/lib/cn'
import type { LocalDuelGame } from '../engine'
import type { WhyKit } from '../games'
import { replayTo, type SoloLog } from '../log'
import { MARK_COLORS } from './MarkLayer'
import type { Explanation } from './voice'
import type { MarkKind } from './types'

/** Contours : couleur du texte (encre en clair, clair en sombre) pour rester lisibles dans les deux thèmes. */
const INK = 'var(--text, #1f1b2e)'

/** Carte « {Perso} t'explique » de la fin de partie : une phrase + « Montre-moi 👀 ». */
export function WhyCard({ ex, bot, onShow }: { ex: Explanation | null; bot: PlayerInfo; onShow: () => void }) {
  const name = bot.nickname.replace(' 🤖', '')
  const title = !ex ? `${name} repasse la partie…` : ex.mode === 'win' ? `Le mot de ${name}` : `${name} t’explique`
  return (
    <motion.div
      initial={{ y: 12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="flex w-full flex-col gap-2 rounded-card border-[3px] border-ink bg-white p-3 text-left text-[#1f1b2e] shadow-sticker-sm"
    >
      <div className="flex items-start gap-2">
        <Avatar slug={bot.slug} tenue="default" expression={pickExpression(bot, ex?.sticker ?? 'reflexion', 'reflexion')} size={56} bounce={!ex} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-display text-base font-extrabold">{ex ? title : `💭 ${title}`}</p>
          {ex && <p className="text-lg leading-snug font-bold">{ex.card}</p>}
        </div>
      </div>
      {ex?.moment && ex.moment.steps.length > 0 && (
        <Button size="md" fullWidth onClick={onShow} className="text-[#1f1b2e]">
          Montre-moi 👀
        </Button>
      )}
    </motion.div>
  )
}

/** Petite forme de légende (même dessin que sur le plateau). */
function Swatch({ kind }: { kind: MarkKind }) {
  const col = MARK_COLORS[kind]
  return (
    <svg viewBox="0 0 20 20" className="size-6 shrink-0" aria-hidden>
      {kind === 'played' && (
        <>
          <rect x="3" y="3" width="14" height="14" rx="3" fill="none" stroke={INK} strokeWidth="4" />
          <rect x="3" y="3" width="14" height="14" rx="3" fill="none" stroke={col} strokeWidth="2" />
          <path d="M 7 7 L 13 13 M 13 7 L 7 13" stroke={col} strokeWidth="2.6" strokeLinecap="round" />
        </>
      )}
      {kind === 'better' && (
        <>
          <circle cx="10" cy="10" r="7" fill={col} fillOpacity=".3" stroke={INK} strokeWidth="4" />
          <circle cx="10" cy="10" r="7" fill="none" stroke={col} strokeWidth="2" />
        </>
      )}
      {kind === 'threat' && <circle cx="10" cy="10" r="7" fill={col} fillOpacity=".45" stroke={INK} strokeWidth="2.6" strokeDasharray="3 2" />}
      {kind === 'line' && <path d="M 3 15 L 17 5" stroke={col} strokeWidth="4" strokeLinecap="round" />}
      {kind === 'zone' && <rect x="3" y="3" width="14" height="14" rx="3" fill={col} fillOpacity=".5" stroke={INK} strokeWidth="1.5" strokeDasharray="3 2" />}
    </svg>
  )
}

const LEGEND: Record<'me' | 'bot', Partial<Record<MarkKind, string>>> = {
  me: { played: 'ton coup', better: 'le bon coup', threat: 'ma menace', line: 'l’alignement', zone: 'la zone' },
  bot: { played: 'mon coup', better: 'ton beau coup', threat: 'les menaces', line: 'l’alignement', zone: 'la zone' },
}

/**
 * Écran « Pourquoi tu as perdu » / « Ton meilleur coup » (plein écran) : petit plateau figé
 * en 2 étapes (① ce qui s'est passé → ② le bon coup, enchaînées toutes seules sauf
 * mouvement réduit), bulle du perso, conseil, « J'ai compris 👍 ».
 */
export function WhyPanel({
  ex,
  kit,
  local,
  log,
  me,
  bot,
  colors,
  onClose,
}: {
  ex: Explanation
  kit: WhyKit
  local: LocalDuelGame<unknown, unknown>
  log: SoloLog
  me: PlayerInfo
  bot: PlayerInfo
  colors: { a: string; b: string }
  onClose: () => void
}) {
  const reduce = useReducedMotion()
  const steps = useMemo(() => ex.moment?.steps ?? [], [ex])
  const [step, setStep] = useState(0)
  const [run, setRun] = useState(0)
  const xs = useMemo(() => {
    try {
      return steps.map((s) => replayTo(local, log, s.ply))
    } catch {
      return []
    }
  }, [steps, local, log])

  // ① puis ② tout seul ; « Revoir ▶ » relance.
  useEffect(() => {
    if (reduce || steps.length < 2) return
    const t = window.setTimeout(() => setStep(1), 2600)
    return () => window.clearTimeout(t)
  }, [run, reduce, steps.length])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  const side = ex.mode === 'win' ? 'bot' : 'me'
  const labels = ex.mode === 'win' ? ['Ce qui s’est passé', 'Ton beau coup'] : ['Ce qui s’est passé', 'Le bon coup']
  const cur = steps[Math.min(step, steps.length - 1)]
  const kinds = [...new Set(steps.flatMap((s) => s.marks.map((m) => m.kind)))] as MarkKind[]
  const D = kit.Diagram

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={ex.title}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed inset-0 z-[70] overflow-y-auto bg-paper text-text"
    >
      <div className="mx-auto flex min-h-full max-w-md flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <h2 className="text-center text-3xl">{ex.mode === 'win' ? '🏅' : ex.mode === 'draw' ? '🤝' : '🔍'} {ex.title}</h2>

        {cur && xs.length === steps.length && (
          <div className="flex flex-col gap-3">
            {steps.length > 1 ? (
              <div className="grid grid-cols-2 gap-2" role="tablist">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={step === i}
                    onClick={() => setStep(i)}
                    className={cn(
                      'min-h-12 rounded-chip border-[3px] border-ink px-2 font-display text-base leading-tight font-extrabold',
                      step === i ? (i === 0 ? 'bg-sun text-[#1f1b2e] shadow-sticker-sm' : 'bg-mint text-[#1f1b2e] shadow-sticker-sm') : 'bg-surface text-muted',
                    )}
                  >
                    {i === 0 ? '①' : '②'} {labels[i]}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-center font-display text-lg font-extrabold">{ex.mode === 'win' ? `🏆 ${labels[1]}` : `① ${labels[0]}`}</p>
            )}
            <motion.div key={`${run}-${step}`} initial={reduce ? false : { scale: 0.94, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.25 }}>
              <D x={xs[Math.min(step, xs.length - 1)]} log={log} marks={cur.marks} me={me} bot={bot} colors={colors} blink={step === 1} />
            </motion.div>
            <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-sm font-bold" aria-label="Légende">
              {kinds.map((k) => (
                <li key={k} className="flex items-center gap-1">
                  <Swatch kind={k} /> {LEGEND[side][k]}
                </li>
              ))}
            </ul>
            {steps.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setStep(0)
                  setRun((r) => r + 1)
                }}
                className="min-h-11 self-center rounded-chip border-2 border-ink bg-surface px-4 font-extrabold shadow-sticker-sm active:shadow-none"
              >
                Revoir ▶
              </button>
            )}
          </div>
        )}

        <div className="flex items-start gap-2">
          <Avatar slug={bot.slug} tenue="default" expression={pickExpression(bot, ex.sticker, 'reflexion')} size={64} />
          <div className="relative min-w-0 flex-1 rounded-bubble border-[3px] border-ink bg-surface px-3 py-2 shadow-sticker-sm">
            {ex.lines.map((l, i) => (
              <p key={i} className={cn('text-lg leading-snug', i === 0 ? 'font-extrabold' : 'font-bold')}>
                {l}
              </p>
            ))}
          </div>
        </div>

        {ex.tip && (
          <div className="rounded-card border-[3px] border-ink bg-sun p-3 text-[#1f1b2e] shadow-sticker-sm">
            <p className="font-display text-base font-extrabold">💡 Pour la prochaine fois</p>
            <p className="text-lg leading-snug font-bold">{ex.tip}</p>
          </div>
        )}

        <Button size="lg" fullWidth onClick={onClose} className="mt-auto">
          J’ai compris 👍
        </Button>
      </div>
    </motion.div>,
    document.body,
  )
}

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/Modal'
import { burst } from '@/components/ui/confetti'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import { toast } from '@/store/toast'
import { toastError } from '@/features/soiree/errors'
import { ROUND_CHOICES, compatibleGameIds, startReveillon } from './api'
import { THEME_LIST, challengeIds, defaultTheme, getTheme, type ThemeId } from './themes'

/**
 * Carte de l'hôte au salon : « Mode Réveillon » -> choix du thème et du nombre de manches,
 * puis l'appli enchaîne les jeux tirés au sort (supabase/features/reveillon.sql).
 */
export function ReveillonLauncher({ soireeId, playerCount, disabled }: { soireeId: string; playerCount: number; disabled: boolean }) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeId>(defaultTheme)
  const [rounds, setRounds] = useState<number>(6)
  const [busy, setBusy] = useState(false)
  const t = getTheme(theme)
  const games = compatibleGameIds(playerCount)

  const go = async () => {
    if (playerCount < 2) return toast.error('Il faut être au moins 2 dans le salon.')
    setBusy(true)
    const { error } = await startReveillon(soireeId, theme, rounds, games, challengeIds(theme))
    setBusy(false)
    if (error) return toastError(error)
    fx.fanfare()
    burst({ x: 0.5, y: 0.4 }, 140)
    setOpen(false)
  }

  return (
    <>
      <motion.button
        type="button"
        disabled={disabled}
        onClick={() => {
          fx.pop()
          setOpen(true)
        }}
        whileTap={{ scale: 0.95, rotate: -1 }}
        className="sticker relative flex w-full items-center gap-3 overflow-hidden p-4 text-left text-[#1f1b2e] disabled:opacity-50"
        style={{ backgroundColor: t.color }}
      >
        <motion.span className="text-5xl" animate={reduce ? undefined : { rotate: [-8, 8, -8], y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 2.2 }}>
          {t.emoji}
        </motion.span>
        <span className="flex-1">
          <span className="block font-display text-2xl leading-tight font-extrabold">Soirée scénarisée</span>
          <span className="block text-sm leading-snug font-bold">Jeux tirés au sort, défis surprises et classement spécial !</span>
        </span>
        <Sparkles className="size-7 shrink-0" strokeWidth={2.5} />
      </motion.button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Soirée scénarisée"
        footer={
          <Button size="lg" fullWidth loading={busy} disabled={playerCount < 2} onClick={() => void go()}>
            {t.emoji} C’est parti !
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-base leading-snug">L’appli choisit les jeux toute seule. Entre deux parties : un défi surprise pour tout le monde !</p>

          <div className="flex flex-col gap-2">
            <p className="font-display text-lg font-extrabold">1. Le thème</p>
            {THEME_LIST.map((th) => {
              const sel = th.id === theme
              return (
                <motion.button
                  key={th.id}
                  type="button"
                  aria-pressed={sel}
                  onClick={() => {
                    fx.pop()
                    setTheme(th.id)
                  }}
                  animate={{ scale: sel ? 1.02 : 0.97, rotate: sel ? -1 : 0 }}
                  whileTap={{ scale: 0.93 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 15 }}
                  className={cn('sticker flex min-h-16 items-center gap-3 p-3 text-left text-[#1f1b2e]', !sel && 'opacity-60 saturate-50')}
                  style={{ backgroundColor: th.color }}
                >
                  <span className="text-4xl">{th.emoji}</span>
                  <span className="flex-1">
                    <span className="block font-display text-xl leading-tight font-extrabold">{th.name}</span>
                    <span className="block text-sm leading-snug font-bold">{th.tagline}</span>
                  </span>
                  {sel && <span className="text-2xl">✅</span>}
                </motion.button>
              )
            })}
          </div>

          <div className="flex flex-col gap-2">
            <p className="font-display text-lg font-extrabold">2. Combien de manches ?</p>
            <div className="grid grid-cols-3 gap-2">
              {ROUND_CHOICES.map((n) => (
                <motion.button
                  key={n}
                  type="button"
                  aria-pressed={n === rounds}
                  onClick={() => {
                    fx.pop()
                    setRounds(n)
                  }}
                  whileTap={{ scale: 0.9 }}
                  className={cn('sticker flex min-h-16 flex-col items-center justify-center font-display font-extrabold', n === rounds ? 'bg-sun text-[#1f1b2e]' : 'bg-surface text-text opacity-70')}
                >
                  <span className="text-3xl leading-none">{n}</span>
                  <span className="text-xs">{n === 4 ? '≈ 1 h' : n === 6 ? '≈ 1 h 30' : '≈ 2 h'}</span>
                </motion.button>
              ))}
            </div>
          </div>

          <ul className="flex flex-col gap-1 text-sm leading-snug font-bold">
            <li>🎲 {games.length} jeux possibles à {playerCount} joueurs, jamais deux fois le même.</li>
            <li>🎁 Un défi surprise après chaque partie (+1 ⭐ pour qui le relève).</li>
            <li>🌟 Dernière manche : points doublés !</li>
          </ul>
        </div>
      </BottomSheet>
    </>
  )
}

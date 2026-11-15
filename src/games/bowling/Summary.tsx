import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'
import { ScoreSheet } from './ScoreSheet'
import { sheetStats } from './scoring'
import type { BowlingState } from './types'

/** Fin de partie : distinctions (meilleur lancer…) + feuilles de score complètes. */
export default function BowlingSummary({ state, players, meId }: GameSummaryProps) {
  const s = state as unknown as BowlingState
  if (!s.sheets || !s.players?.length) return null
  const get = (id: string) => playerOrPlaceholder(players, id)
  const ranked = [...s.players].sort((a, b) => (s.scores?.[b] ?? 0) - (s.scores?.[a] ?? 0))
  const stats = Object.fromEntries(s.players.map((id) => [id, sheetStats(s.sheets[id] ?? [], s.frames)]))

  const best = <K extends 'strikes' | 'spares' | 'bestFrame' | 'gutters'>(k: K) => {
    const top = Math.max(0, ...s.players.map((id) => stats[id][k]))
    return top > 0 ? { top, ids: s.players.filter((id) => stats[id][k] === top) } : null
  }
  const awards = [
    { key: 'frame', ...best('bestFrame'), emoji: '🎯', label: 'Meilleur lancer', unit: (v: number, id: string) => `${v} pts (frame ${stats[id].bestFrameNo})` },
    { key: 'strikes', ...best('strikes'), emoji: '💥', label: 'Roi du strike', unit: (v: number) => `${v} strike${v > 1 ? 's' : ''}` },
    { key: 'spares', ...best('spares'), emoji: '✨', label: 'As du spare', unit: (v: number) => `${v} spare${v > 1 ? 's' : ''}` },
    { key: 'gutters', ...best('gutters'), emoji: '🫠', label: 'Abonné à la gouttière', unit: (v: number) => `${v} lancer${v > 1 ? 's' : ''} à zéro` },
  ].filter((a): a is typeof a & { top: number; ids: string[] } => typeof a.top === 'number' && Array.isArray(a.ids))

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      {s.forced && <p className="text-sm font-bold text-muted">Partie terminée avant la fin : les lancers manquants comptent 0.</p>}
      {awards.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {awards.map((a, i) => (
            <motion.div
              key={a.key}
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: i % 2 ? 1.5 : -1.5 }}
              transition={{ delay: 1.4 + i * 0.12, type: 'spring', stiffness: 320, damping: 14 }}
              className="sticker-sm flex flex-col items-center gap-1 bg-paper p-2 text-center"
            >
              <span className="text-2xl">{a.emoji}</span>
              <span className="text-xs font-bold text-muted">{a.label}</span>
              <span className="flex -space-x-2">
                {a.ids.slice(0, 3).map((id) => (
                  <Avatar key={id} slug={get(id).slug} expression={mood(get(id), a.key === 'gutters' ? 'sad' : 'proud')} size={34} />
                ))}
              </span>
              <span className="font-display text-sm leading-tight font-extrabold">
                {a.ids.map((id) => get(id).nickname).join(', ')}
                <br />
                <span className="text-muted">{a.unit(a.top, a.ids[0])}</span>
              </span>
            </motion.div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {ranked.map((id, i) => (
          <motion.div key={id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.6 + i * 0.08 }}>
            <ScoreSheet player={get(id)} sheet={s.sheets[id] ?? []} frames={s.frames} rank={i + 1} me={id === meId} compact />
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

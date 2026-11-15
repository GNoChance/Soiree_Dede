import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps, PlayerInfo } from '../types'
import type { AovState } from './types'
import { KIND_INFO, computeHighlights } from './setup'

type Mood = Parameters<typeof mood>[1]

/** Bloc fin de partie : le plus courageux, le plus sincère, le roi du refus, le juge… */
export default function ActionVeriteSummary({ state, players }: GameSummaryProps) {
  const s = state as unknown as AovState
  const h = computeHighlights(s)
  const get = (id: string) => playerOrPlaceholder(players, id)
  const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`
  const awards: { id: string; expr: Mood; title: string; detail: string; emoji: string }[] = []
  if (h.brave) awards.push({ id: h.brave.id, expr: 'proud', title: 'Le plus courageux', detail: plural(h.brave.count, 'action'), emoji: '🦁' })
  if (h.sincere) awards.push({ id: h.sincere.id, expr: 'love', title: 'Le plus sincère', detail: plural(h.sincere.count, 'vérité'), emoji: '😇' })
  if (h.champion) awards.push({ id: h.champion.id, expr: 'happy', title: 'Mission accomplie', detail: `${plural(h.champion.count, 'défi')} réussi${h.champion.count > 1 ? 's' : ''}`, emoji: '💪' })
  if (h.chicken) awards.push({ id: h.chicken.id, expr: 'shy', title: 'La poule mouillée', detail: `${h.chicken.count} refus`, emoji: '🐔' })
  if (h.judge) awards.push({ id: h.judge.id, expr: 'angry', title: 'Le juge impitoyable', detail: plural(h.judge.count, 'pouce') + ' en bas', emoji: '👨‍⚖️' })

  const history = s.history ?? []
  const refusals = history.filter((x) => x.outcome === 'refused' && x.gage)
  if (!awards.length && !history.length) return null

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      <p className="font-display text-xl font-extrabold">Le palmarès des audacieux 🎭</p>
      <div className="flex flex-col gap-2">
        {awards.map((a, i) => (
          <Award key={a.title} p={get(a.id)} expr={a.expr} title={a.title} detail={a.detail} emoji={a.emoji} i={i} />
        ))}
      </div>
      {history.length > 0 && (
        <div className="flex gap-2 text-center font-display font-extrabold">
          <Stat label="actions" value={history.filter((x) => x.kind === 'action').length} color={KIND_INFO.action.color} />
          <Stat label="vérités" value={history.filter((x) => x.kind === 'verite').length} color={KIND_INFO.verite.color} />
          <Stat label="réussis" value={history.filter((x) => x.outcome === 'success').length} color="#06D6A0" />
          <Stat label="gages" value={refusals.length} color="#FFB703" />
        </div>
      )}
      {refusals.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-chip bg-sunk p-2">
          <p className="text-sm text-muted">🎁 Les gages de la soirée</p>
          {refusals.slice(-4).map((x) => (
            <div key={x.round} className="flex items-center gap-2 text-sm">
              <Avatar slug={get(x.target).slug} expression={mood(get(x.target), 'shy')} size={28} />
              <span className="font-bold">{x.gage}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 rounded-chip border-2 border-ink px-1 py-1 text-[#1f1b2e]" style={{ backgroundColor: color }}>
      <p className="text-xl leading-none">{value}</p>
      <p className="text-[11px]">{label}</p>
    </div>
  )
}

function Award({ p, expr, title, detail, emoji, i }: { p: PlayerInfo; expr: Mood; title: string; detail: string; emoji: string; i: number }) {
  return (
    <motion.div
      initial={{ x: -40, opacity: 0, rotate: -3 }}
      animate={{ x: 0, opacity: 1, rotate: 0 }}
      transition={{ delay: 1.4 + i * 0.15, type: 'spring', stiffness: 300, damping: 18 }}
      className="flex items-center gap-3 rounded-chip bg-sunk p-2"
    >
      <Avatar slug={p.slug} expression={mood(p, expr)} size={48} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted">
          {emoji} {title}
        </p>
        <p className="truncate font-display text-lg font-extrabold">
          {p.nickname} <span className="text-sm font-bold text-muted">· {detail}</span>
        </p>
      </div>
    </motion.div>
  )
}

/** Panneau des joueurs (repliable), bandeau du format de partie et journal. */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Avatar } from '@/components/ui/Avatar'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '../types'
import { logLine, signedEur } from './format'
import { cellsOf, fortuneOf, levelOf } from './rules'
import type { MoneyFloat } from './usePlayback'
import type { TdpState } from './types'

/* ------------------------------ format de partie ------------------------------ */

const mmss = (ms: number) => {
  const t = Math.ceil(ms / 1000)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export function FormatBar({ s }: { s: TdpState }) {
  const left = useCountdown(s.format === 'tours' ? null : s.ends_at, 1000)
  let main: string
  if (s.format === 'tours') main = `Tour ${Math.min(s.round, s.total_rounds ?? s.round)}/${s.total_rounds ?? '?'}`
  else if (s.format === 'chrono') main = s.last_turn || left <= 0 ? 'Dernier tour !' : `⏳ ${mmss(left)} restantes`
  else main = `Classique · tour ${s.round}${s.ends_at && left > 0 ? ` · max ${mmss(left)}` : ''}`
  const urgent = s.last_turn || (s.format === 'chrono' && left > 0 && left < 60_000)
  return (
    <div className="flex items-center justify-between gap-2 text-sm font-bold">
      <span className={cn('rounded-chip border-2 border-ink px-2.5 py-1', urgent ? 'bg-tomato text-white' : 'bg-surface')}>{main}</span>
      {s.format !== 'tours' && <span className="text-muted">Tour {s.round}</span>}
      {s.format === 'tours' && s.last_turn && <span className="rounded-chip border-2 border-ink bg-tomato px-2.5 py-1 text-white">Dernier tour !</span>}
    </div>
  )
}

/* ------------------------------ joueurs ------------------------------ */

function FloatingMoney({ f, onDone }: { f: MoneyFloat; onDone: (key: string) => void }) {
  return (
    <motion.span
      aria-hidden
      initial={{ y: 4, opacity: 0, scale: 0.7 }}
      animate={{ y: -26, opacity: [0, 1, 1, 0], scale: 1 }}
      transition={{ duration: 1.7, times: [0, 0.15, 0.7, 1] }}
      onAnimationComplete={() => onDone(f.key)}
      className={cn(
        'pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 rounded-full border-2 border-ink px-1.5 text-[11px] leading-4 font-extrabold whitespace-nowrap shadow-sticker-sm',
        f.amount > 0 ? 'bg-mint text-[#1f1b2e]' : 'bg-tomato text-white',
      )}
    >
      {signedEur(f.amount)}
    </motion.span>
  )
}

interface PlayersProps {
  s: TdpState
  players: Record<string, PlayerInfo>
  meId: string
  floats: MoneyFloat[]
  dismissFloat: (key: string) => void
}

export function PlayersPanel({ s, players, meId, floats, dismissFloat }: PlayersProps) {
  const [open, setOpen] = useState(false)
  const ids = s.order
  return (
    <section className="sticker flex flex-col bg-surface p-2" aria-label="Joueurs">
      <ul className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(ids.length, 9)}, minmax(0, 1fr))` }}>
        {ids.map((id) => {
          const p = playerOrPlaceholder(players, id)
          const broke = s.bankrupt.includes(id)
          const turn = s.turn === id
          return (
            <li key={id} className={cn('relative flex min-w-0 flex-col items-center gap-0.5 rounded-chip py-1', turn && 'bg-sun/50 ring-2 ring-sun', broke && 'opacity-45 grayscale')}>
              <Avatar slug={p.slug} expression={broke ? mood(p, 'sad') : turn ? mood(p, 'think') : p.equipped} size={ids.length > 6 ? 28 : 34} bounce={turn} badge={s.away.includes(id) ? '💤' : s.jail[id] !== undefined ? '🚔' : undefined} />
              <span className={cn('max-w-full truncate text-[10px] leading-none font-extrabold tabular-nums', (s.cash[id] ?? 0) < 0 && 'text-tomato')}>
                {broke ? '💥' : <AnimatedNumber value={s.cash[id] ?? 0} duration={0.7} />}
              </span>
              {floats.filter((f) => f.player === id).slice(-2).map((f) => (
                <FloatingMoney key={f.key} f={f} onDone={dismissFloat} />
              ))}
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mt-1 flex min-h-10 w-full items-center justify-center gap-1 rounded-chip text-sm font-extrabold text-muted"
      >
        {open ? 'Masquer le détail' : 'Fortunes et propriétés'}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} strokeWidth={3} />
      </button>

      {open && (
        <ul className="flex flex-col gap-1.5 pt-1">
          {ids.map((id) => {
            const p = playerOrPlaceholder(players, id)
            const broke = s.bankrupt.includes(id)
            const mine = cellsOf(s, id)
            const houses = mine.reduce((n, i) => n + (levelOf(s, i) >= 5 ? 0 : levelOf(s, i)), 0)
            const hotels = mine.filter((i) => levelOf(s, i) >= 5).length
            return (
              <li key={id} className={cn('flex items-center gap-2 rounded-chip border-2 px-2 py-1.5', s.turn === id ? 'border-ink bg-sun/40' : 'border-transparent bg-sunk', broke && 'opacity-50')}>
                <Avatar slug={p.slug} expression={broke ? mood(p, 'sad') : p.equipped} size={32} />
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-sm font-extrabold">
                    {p.nickname}
                    {id === meId && ' (toi)'}
                    {s.turn === id && !broke && ' ▶'}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {broke ? 'En faillite' : `🏠 ${mine.length}${houses ? ` · ${houses} 🏘️` : ''}${hotels ? ` · ${hotels} 🏨` : ''}`}
                    {!broke && s.jail[id] !== undefined && ' · 🚔 violon'}
                    {!broke && s.away.includes(id) && ' · 💤 absent'}
                    {!broke && (s.jail_cards[id]?.length ?? 0) > 0 && ' · 🎟️'}
                  </p>
                </div>
                {!broke && (
                  <div className="text-right leading-tight">
                    <p className={cn('text-sm font-extrabold tabular-nums', (s.cash[id] ?? 0) < 0 && 'text-tomato')}>{(s.cash[id] ?? 0).toLocaleString('fr-FR')} €</p>
                    <p className="text-[11px] text-muted tabular-nums">fortune {fortuneOf(s, id).toLocaleString('fr-FR')} €</p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------ journal ------------------------------ */

export function LogPanel({ s, name }: { s: TdpState; name: (id: string | null | undefined) => string }) {
  const [all, setAll] = useState(false)
  const lines = [...s.log]
    .reverse()
    .filter((e) => e.kind !== 'turn')
    .map((e) => ({ e, l: logLine(e, name) }))
    .filter((x): x is { e: typeof x.e; l: { icon: string; text: string } } => x.l !== null)
  const shown = all ? lines : lines.slice(0, 4)
  return (
    <section className="sticker flex flex-col gap-1 bg-surface p-3" aria-label="Journal de la partie">
      <h2 className="font-display text-lg leading-none">Journal</h2>
      {shown.length === 0 && <p className="text-sm text-muted">Rien pour l’instant.</p>}
      <ol className="flex flex-col gap-1">
        {shown.map(({ e, l }) => (
          <li key={e.no} className="flex gap-2 text-sm leading-snug">
            <span aria-hidden className="w-5 shrink-0 text-center">
              {l.icon}
            </span>
            <span className="min-w-0 break-words">{l.text}</span>
          </li>
        ))}
      </ol>
      {lines.length > 4 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="min-h-10 rounded-chip text-sm font-extrabold text-muted">
          {all ? 'Réduire' : `Tout voir (${lines.length})`}
        </button>
      )}
    </section>
  )
}

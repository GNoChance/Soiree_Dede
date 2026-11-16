/** Fin de partie : podium (chibis), classement par fortune, raison de fin, petits trophées. */
import { useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { burst } from '@/components/ui/confetti'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import type { GameSummaryProps, PlayerInfo } from '../types'
import { eur } from './format'
import type { TdpEndReason, TdpRankingRow, TdpState } from './types'

const REASONS: Record<TdpEndReason, string> = {
  last_standing: 'Dernier en lice : tous les autres ont fait faillite !',
  rounds: 'Tous les tours de table ont été joués.',
  time: 'Le temps est écoulé.',
  safety: 'Limite de 3 h atteinte.',
}

const MEDALS = ['🥇', '🥈', '🥉']
const PODIUM_H = [112, 80, 58]
const PODIUM_BG = ['bg-sun', 'bg-sky', 'bg-bubblegum']

export default function TourDesPotesSummary({ state, meId, players }: GameSummaryProps) {
  const s = state as unknown as TdpState
  const reduce = useReducedMotion()
  const ranking = s.ranking
  const iWon = !!s.winners?.includes(meId)

  // Confettis pour le gagnant (l'écran de résultats commun s'en charge déjà si c'est moi).
  useEffect(() => {
    if (iWon || !s.winners?.length) return
    const t = window.setTimeout(() => burst({ x: 0.5, y: 0.35 }, 100), 700)
    return () => clearTimeout(t)
  }, [iWon, s.winners])

  if (!ranking || ranking.length === 0) return null
  const get = (id: string) => playerOrPlaceholder(players, id)
  const places = [1, 2, 3].map((r) => ranking.filter((x) => x.rank === r))
  // Affichage 2 - 1 - 3
  const order = [1, 0, 2].filter((i) => places[i].length > 0)

  const best = (pick: (id: string) => number) => {
    const rows = ranking.map((r) => ({ id: r.player, v: pick(r.player) })).sort((a, b) => b.v - a.v)
    return rows[0] && rows[0].v > 0 ? rows[0] : null
  }
  const awards = [
    { icon: '💰', label: 'Roi du loyer', top: best((id) => s.stats?.[id]?.rent_received ?? 0), fmt: eur },
    { icon: '😬', label: 'Plus gros payeur', top: best((id) => s.stats?.[id]?.rent_paid ?? 0), fmt: eur },
    { icon: '🔨', label: 'Bâtisseur', top: best((id) => s.stats?.[id]?.built ?? 0), fmt: (n: number) => `${n} bâtiment${n > 1 ? 's' : ''}` },
    { icon: '🚔', label: 'Habitué du violon', top: best((id) => s.stats?.[id]?.jail ?? 0), fmt: (n: number) => `${n} fois` },
  ].flatMap((a) => (a.top ? [{ ...a, top: a.top }] : []))

  return (
    <div className="flex flex-col gap-3">
      <div className="sticker flex flex-col gap-3 overflow-hidden bg-grape p-3 text-white">
        <p className="text-center font-display text-2xl leading-none font-extrabold" style={{ textShadow: '2px 2px 0 #1f1b2e' }}>
          {s.end_reason ? REASONS[s.end_reason] : 'Partie terminée !'}
        </p>
        <div className="flex items-end justify-center gap-2">
          {order.map((i) => (
            <motion.div
              key={i}
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.15 + (2 - i) * 0.18 }}
              className="flex min-w-0 flex-1 flex-col items-center"
            >
              <div className="flex items-end justify-center">
                {places[i].map((r) => {
                  const p = get(r.player)
                  return (
                    <div key={r.player} className="flex min-w-0 flex-col items-center">
                      <motion.div animate={reduce || i !== 0 ? undefined : { y: [0, -6, 0], rotate: [-2, 2, -2] }} transition={{ repeat: Infinity, duration: 1.1 }}>
                        <ChibiImage slug={p.slug} expression={i === 0 ? mood(p, 'proud') : i === 1 ? mood(p, 'happy') : mood(p, 'shy')} size={places[i].length > 1 ? 56 : i === 0 ? 92 : 72} />
                      </motion.div>
                      <span className="max-w-full truncate text-sm font-extrabold">{r.player === meId ? 'Toi' : p.nickname}</span>
                    </div>
                  )
                })}
              </div>
              <div
                className={cn('mt-1 flex w-full flex-col items-center justify-start gap-0.5 rounded-t-card border-[3px] border-b-0 border-ink pt-2 text-[#1f1b2e]', PODIUM_BG[i])}
                style={{ height: PODIUM_H[i] }}
              >
                <span className="text-3xl leading-none">{MEDALS[i]}</span>
                <span className="font-display text-sm leading-none font-extrabold tabular-nums">{eur(places[i][0].fortune)}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <section className="sticker flex flex-col gap-1.5 bg-surface p-3" aria-label="Classement par fortune">
        <h2 className="font-display text-lg leading-none">Classement des fortunes</h2>
        <p className="text-xs text-muted">Fortune = argent + lieux + bâtiments.</p>
        <ol className="flex flex-col gap-1.5">
          {ranking.map((r, k) => (
            <Row key={r.player} r={r} k={k} meId={meId} p={get(r.player)} />
          ))}
        </ol>
      </section>

      {awards.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {awards.map((a) => {
            const p = get(a.top.id)
            return (
              <div key={a.label} className="sticker flex flex-col items-center gap-1 bg-sunk p-2 text-center">
                <span className="text-xs font-extrabold uppercase">
                  {a.icon} {a.label}
                </span>
                <Avatar slug={p.slug} expression={p.equipped} size={36} />
                <span className="max-w-full truncate text-sm leading-tight font-bold">{a.top.id === meId ? 'Toi' : p.nickname}</span>
                <span className="text-xs text-muted tabular-nums">{a.fmt(a.top.v)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Row({ r, k, meId, p }: { r: TdpRankingRow; k: number; meId: string; p: PlayerInfo }) {
  return (
    <motion.li
      initial={{ x: -30, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay: 0.3 + k * 0.06 }}
      className={cn('flex items-center gap-2 rounded-chip border-2 px-2 py-1.5', r.player === meId ? 'border-ink bg-sun/40' : 'border-transparent bg-sunk', r.bankrupt && 'opacity-60')}
    >
      <span className="w-7 shrink-0 text-center text-lg leading-none font-extrabold">{MEDALS[r.rank - 1] ?? `${r.rank}.`}</span>
      <Avatar slug={p.slug} expression={r.bankrupt ? mood(p, 'sad') : r.rank === 1 ? mood(p, 'proud') : p.equipped} size={34} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate font-extrabold">{r.player === meId ? `${p.nickname} (toi)` : p.nickname}</p>
        <p className="text-xs text-muted tabular-nums">
          {r.bankrupt ? '💥 Faillite' : `${eur(r.cash)} · 🏠 ${r.owned} lieu${r.owned > 1 ? 'x' : ''} · 🔨 ${eur(r.buildings)}`}
        </p>
      </div>
      <span className="shrink-0 font-display text-base font-extrabold tabular-nums">{r.bankrupt ? '—' : eur(r.fortune)}</span>
    </motion.li>
  )
}

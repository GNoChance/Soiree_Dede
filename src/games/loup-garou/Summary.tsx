import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps, PlayerInfo } from '../types'
import { CAUSE_LABEL, ROLE_INFO, ROLE_ORDER, WINNER_INFO, type LgDeath, type LgNightLog, type LgReveal, type LgState } from './types'
import { Moon, Stars } from './Scenery'
import { bell, lines, narrationSession, speak } from './narration'

/** Fin de partie : camp vainqueur, révélation de tous les rôles, récit de la partie. */
export default function LoupGarouSummary({ state, players, meId }: GameSummaryProps) {
  const s = state as unknown as LgState
  const key = `${s.players.join(',')}:${s.seq ?? 0}`
  useEffect(() => {
    // Conteur : annonce de la victoire sur le téléphone de l'hôte uniquement.
    if (!narrationSession.host || !s.winner || narrationSession.spoken.has(key)) return
    narrationSession.spoken.add(key)
    bell(5)
    speak([lines.win(s.winner)])
  }, [key, s.winner])
  if (!s.winner || !s.roles) return null
  const w = WINNER_INFO[s.winner]
  const get = (id: string) => playerOrPlaceholder(players, id)
  const roles = s.roles
  const lovers = s.lovers ?? []
  const winners = new Set((s.results ?? []).filter((r) => r.won).map((r) => r.profile_id))
  const sorted = [...s.players].sort((a, b) => ROLE_ORDER.indexOf(roles[a]) - ROLE_ORDER.indexOf(roles[b]))

  return (
    <div className="flex flex-col gap-3">
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: -2 }}
        transition={{ type: 'spring', stiffness: 260, damping: 12 }}
        className="sticker relative overflow-hidden p-4 text-center text-white"
        style={{ background: 'linear-gradient(180deg, #141040, #2b1d5e 70%, ' + w.color + ')' }}
      >
        <Stars count={30} />
        <div className="relative flex flex-col items-center gap-1">
          <Moon size={46} blood={s.winner === 'loups'} />
          <p className="font-display text-3xl font-extrabold">
            {w.emoji} {w.text}
          </p>
          <p className="text-sm font-bold opacity-85">
            {s.night} nuit{s.night > 1 ? 's' : ''} · {s.alive.length} survivant{s.alive.length > 1 ? 's' : ''}
          </p>
        </div>
      </motion.div>

      <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
        <p className="font-display text-lg font-extrabold">Les rôles dévoilés</p>
        {sorted.map((id, i) => {
          const p = get(id)
          const r = roles[id]
          const dead = !s.alive.includes(id)
          const info = ROLE_INFO[r]
          const expr = dead ? (r === 'loup' ? pickExpression(p, 'colere') : pickExpression(p, 'pleurs')) : winners.has(id) ? pickExpression(p, 'joie', 'cool') : pickExpression(p, 'boude')
          return (
            <motion.div
              key={id}
              initial={{ x: i % 2 ? 60 : -60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3 + i * 0.07, type: 'spring', stiffness: 260, damping: 20 }}
              className={cn('flex items-center gap-2', id === meId && 'font-extrabold')}
            >
              <Avatar slug={p.slug} expression={expr} size={34} />
              <span className="min-w-0 flex-1 truncate">
                {p.nickname}
                {lovers.includes(id) && ' 💞'}
                {winners.has(id) && ' 🏆'}
                {dead && <span className="text-muted"> · mort·e</span>}
              </span>
              <span className="rounded-full border-2 border-ink px-2 text-sm font-extrabold text-[#1f1b2e]" style={{ backgroundColor: info.color }}>
                {info.emoji} {info.label}
              </span>
            </motion.div>
          )
        })}
      </div>

      <Chronicle s={s} get={get} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Récit : nuits (actions secrètes dévoilées) + jours (votes, morts)          */
/* -------------------------------------------------------------------------- */

function Chronicle({ s, get }: { s: LgState; get: (id: string) => PlayerInfo }) {
  const roles = s.roles ?? {}
  const n = (id?: string | null) => (id ? get(id).nickname : '')
  const roleOf = (id: string) => ROLE_INFO[roles[id]]?.label.toLowerCase() ?? '?'
  const nights = new Map<number, LgNightLog>((s.chronicle ?? []).map((c) => [c.night, c]))
  const byNight = new Map<number, LgReveal[]>()
  for (const r of s.history ?? []) byNight.set(r.night, [...(byNight.get(r.night) ?? []), r])
  const maxNight = Math.max(s.night, ...[...nights.keys()])

  const deathText = (d: LgDeath) => `${n(d.id)} (${ROLE_INFO[d.role].label.toLowerCase()}) — ${CAUSE_LABEL[d.cause]}`

  const chapters = []
  for (let k = 1; k <= maxNight; k++) {
    const log = nights.get(k)
    const reveals = byNight.get(k) ?? []
    const nightLines: string[] = []
    if (log) {
      if (log.lovers) nightLines.push(`💘 Cupidon unit ${n(log.lovers[0])} et ${n(log.lovers[1])}.`)
      if (log.seer) nightLines.push(`🔮 La voyante sonde ${n(log.seer)} : ${roleOf(log.seer)}.`)
      if (log.protect) nightLines.push(`🛡️ Le protecteur veille sur ${n(log.protect)}.`)
      nightLines.push(log.wolves ? `🐺 Les loups attaquent ${n(log.wolves)}.` : '🐺 Les loups ne se décident pas…')
      if (log.wolves && log.protect === log.wolves) nightLines.push('✨ …mais le bouclier du protecteur tient bon !')
      if (log.saved) nightLines.push(`💚 La sorcière sauve ${n(log.saved)}.`)
      if (log.poison) nightLines.push(`☠️ La sorcière empoisonne ${n(log.poison)}.`)
    }
    const dayLines: string[] = []
    for (const r of reveals) {
      if (r.kind === 'dawn') dayLines.push(r.deaths.length ? `🌅 À l’aube : ${r.deaths.map(deathText).join(', ')}.` : '🌅 À l’aube, personne n’est mort.')
      else if (r.kind === 'vote') {
        const main = r.deaths.find((d) => d.cause === 'vote')
        dayLines.push(main ? `🗳️ Le village élimine ${deathText(main)}${r.revote ? ' (après un revote)' : ''}.` : r.outcome === 'tie' ? '🗳️ Égalité au revote : personne n’est éliminé.' : '🗳️ Personne n’est éliminé.')
        for (const d of r.deaths.filter((x) => x.cause !== 'vote')) dayLines.push(`💔 ${deathText(d)}.`)
      } else {
        dayLines.push(r.target ? `🏹 Le chasseur ${n(r.hunter)} abat ${r.deaths.map(deathText).join(', ')}.` : `🏹 Le chasseur ${n(r.hunter)} ne tire pas.`)
      }
    }
    if (!nightLines.length && !dayLines.length) continue
    chapters.push(
      <motion.div key={k} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6 + k * 0.15 }} className="flex flex-col gap-1">
        <p className="font-display font-extrabold">🌙 Nuit {k}</p>
        {nightLines.map((l, i) => (
          <p key={`n${i}`} className="pl-3 text-sm leading-snug">
            {l}
          </p>
        ))}
        {dayLines.map((l, i) => (
          <p key={`d${i}`} className="pl-3 text-sm leading-snug">
            {l}
          </p>
        ))}
      </motion.div>,
    )
  }
  if (!chapters.length) return null
  return (
    <div className="sticker flex flex-col gap-3 bg-sunk p-3">
      <p className="font-display text-lg font-extrabold">📜 Le récit de la partie</p>
      {chapters}
    </div>
  )
}

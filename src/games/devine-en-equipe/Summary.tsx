import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import { Moments, names, topOf, type Moment } from '@/features/duel/Moments'
import type { GameSummaryProps, PlayerInfo } from '../types'
import { ROUND_RULES, TEAMS, TEAM_META, plural } from './setup'
import type { TeamState, TeamTStat } from './types'

/** Fin de partie : score des équipes manche par manche + meilleur orateur. */
export default function TeamSummary({ state, players }: GameSummaryProps) {
  const s = state as unknown as TeamState
  if (!s.teams || !s.scores) return null
  const winners = s.winners ?? []
  const tie = winners.length === 2
  const pts = s.speaker_points ?? {}
  const best = Object.entries(pts).sort((a, b) => b[1] - a[1])[0]
  const mvp = best && best[1] > 0 ? playerOrPlaceholder(players, best[0]) : null

  const moments = teamMoments(s, (id) => playerOrPlaceholder(players, id))

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      <p className="text-center font-display text-2xl font-extrabold">
        {tie ? '🤝 Égalité parfaite !' : `${TEAM_META[winners[0] ?? 'red'].emoji} Victoire des ${TEAM_META[winners[0] ?? 'red'].short} !`}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {TEAMS.map((t, i) => {
          const meta = TEAM_META[t]
          const won = winners.includes(t)
          return (
            <motion.div
              key={t}
              initial={{ scale: 0.6, opacity: 0, rotate: i ? 6 : -6 }}
              animate={{ scale: won ? 1.04 : 0.97, opacity: 1, rotate: i ? 1.5 : -1.5 }}
              transition={{ type: 'spring', stiffness: 240, damping: 14, delay: 1.4 + i * 0.15 }}
              className={cn('sticker-sm flex flex-col items-center gap-1 rounded-card p-2', !won && 'saturate-50')}
              style={{ backgroundColor: meta.color, color: meta.text }}
            >
              <span className="font-display text-base font-extrabold">
                {meta.emoji} {meta.short} {won && '🏆'}
              </span>
              <span className="font-display text-5xl leading-none font-extrabold">{s.scores[t]}</span>
              <div className="flex flex-col items-center text-xs font-bold">
                {(s.round_scores ?? []).map((r, k) => (
                  <span key={k}>
                    {ROUND_RULES[k + 1]?.emoji} {ROUND_RULES[k + 1]?.name} : {r[t]}
                  </span>
                ))}
              </div>
              <div className="mt-1 flex flex-col gap-1 self-stretch">
                {s.teams[t].map((id) => {
                  const p = playerOrPlaceholder(players, id)
                  return (
                    <div key={id} className="flex items-center gap-1.5 rounded-chip bg-white/90 px-1.5 py-0.5 text-[#1f1b2e]">
                      <Avatar slug={p.slug} tenue={p.equippedTenue} size={22} />
                      <span className="min-w-0 flex-1 truncate text-xs font-extrabold">{p.nickname}</span>
                      <span className="text-xs font-extrabold">{pts[id] ?? 0}</span>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )
        })}
      </div>
      {mvp && (
        <div className="flex items-center gap-3">
          <Avatar slug={mvp.slug} tenue={mvp.equippedTenue} expression={pickExpression(mvp, 'cool', 'gamer', 'joie')} size={56} />
          <div>
            <p className="text-sm text-muted">Meilleur orateur 🗣️</p>
            <p className="font-display text-xl font-extrabold">
              {mvp.nickname} · {plural(best[1], 'mot')} fait{best[1] > 1 ? 's' : ''} deviner
            </p>
          </div>
        </div>
      )}
      <Moments moments={moments} get={(id) => playerOrPlaceholder(players, id)} />
    </motion.div>
  )
}
/** Moments drôles tirés des compteurs par orateur (state.tstat) : masqués pour les parties anciennes. */
function teamMoments(s: TeamState, get: (id: string) => PlayerInfo): Moment[] {
  const out: Moment[] = []
  const ids = s.players ?? []
  const ts = (id: string, k: keyof TeamTStat) => s.tstat?.[id]?.[k] ?? 0
  const many = (a: string[]) => (a.length > 1 ? 'ont' : 'a')
  const flash = topOf(ids, (id) => ts(id, 'best_turn'))
  if (flash && flash.value >= 3) out.push({ key: 'flash', emoji: '🏃', title: 'Passage éclair', ids: flash.ids, text: `${names(flash.ids, get)} ${many(flash.ids)} fait deviner ${flash.value} mots en un seul passage. Quel débit !` })
  const mime = topOf(ids, (id) => ts(id, 'found_r3'))
  if (mime && mime.value >= 3) out.push({ key: 'mime', emoji: '🎭', title: 'Roi du mime', ids: mime.ids, text: `${names(mime.ids, get)} ${many(mime.ids)} fait trouver ${mime.value} mots sans dire un mot. Oscar mérité !` })
  const pass = topOf(ids, (id) => ts(id, 'max_passed'))
  if (pass && pass.value >= 3) out.push({ key: 'pass', emoji: '🐢', title: 'Roi du « Passer »', ids: pass.ids, text: `${names(pass.ids, get)} ${many(pass.ids)} passé ${pass.value} mots dans un même passage. Certains mots font de la résistance !` })
  const empty = topOf(ids, (id) => ts(id, 'empty_turns'))
  if (empty) out.push({ key: 'empty', emoji: '🙈', title: 'Passage à vide', ids: empty.ids, text: `${names(empty.ids, get)} ${many(empty.ids)} eu ${empty.value > 1 ? `${empty.value} passages` : 'un passage'} sans aucun mot trouvé. Ça arrive aux meilleurs !` })
  return out.slice(0, 4)
}


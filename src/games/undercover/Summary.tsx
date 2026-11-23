import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import type { UndercoverState } from '@/types/db'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'
import { ROLE_INFO } from './setup'

const WINNER_LABEL = {
  civils: { text: 'Les civils ont gagné !', emoji: '😇', bg: 'bg-mint' },
  infiltres: { text: 'Les infiltrés ont gagné !', emoji: '🕵️', bg: 'bg-tomato text-white' },
  mrwhite: { text: 'Mister White a trouvé le mot !', emoji: '🤫', bg: 'bg-white' },
} as const

type Moment = { id: string; emoji: string; title: string; detail: string }

/** Moments drôles tirés du journal des votes (state.vote_log, révélé en fin de partie ; absent sur les anciennes parties). */
function computeMoments(s: UndercoverState, log: Array<Record<string, string>>, roles: Record<string, string>): Moment[] {
  const out: Moment[] = []
  if (!log.length) return out
  const received: Record<string, number> = {}
  const onInfiltre: Record<string, number> = {}
  const total: Record<string, number> = {}
  for (const round of log)
    for (const [voter, target] of Object.entries(round)) {
      received[target] = (received[target] ?? 0) + 1
      total[voter] = (total[voter] ?? 0) + 1
      if (roles[target] && roles[target] !== 'civil') onInfiltre[voter] = (onInfiltre[voter] ?? 0) + 1
    }
  const best = (rec: Record<string, number>, ids: string[]) => ids.filter((id) => (rec[id] ?? 0) > 0).sort((a, b) => (rec[b] ?? 0) - (rec[a] ?? 0))[0]

  const wrong = (s.eliminated ?? []).find((e) => e.role === 'civil')
  if (wrong) out.push({ id: wrong.profile_id, emoji: '🤦', title: 'Erreur judiciaire', detail: `éliminé·e à tort (innocent·e) à la manche ${wrong.round}` })

  const sus = best(received, s.players)
  if (sus && received[sus] >= 2) out.push({ id: sus, emoji: '👀', title: 'Le plus suspecté', detail: `${received[sus]} votes contre lui·elle` })

  const sher = best(onInfiltre, s.players)
  if (sher && onInfiltre[sher] >= 2) out.push({ id: sher, emoji: '🔎', title: 'Le meilleur flair', detail: `a visé un infiltré ${onInfiltre[sher]} fois` })

  const sneaky = s.players
    .filter((id) => roles[id] && roles[id] !== 'civil' && (received[id] ?? 0) === 0)
    .sort((a, b) => Number(s.alive.includes(b)) - Number(s.alive.includes(a)))[0]
  if (sneaky) out.push({ id: sneaky, emoji: '🥷', title: "L'infiltré·e le plus discret·e", detail: 'n’a reçu aucun vote' })
  return out.slice(0, 4)
}

/** Fin de partie : vainqueurs, révélation des deux mots et des rôles. */
export default function UndercoverSummary({ state, players, meId }: GameSummaryProps) {
  const s = state as unknown as UndercoverState
  if (!s.winner) return null
  const w = WINNER_LABEL[s.winner]
  const roles = s.roles ?? {}
  const log = ((s as unknown as { vote_log?: Array<Record<string, string>> }).vote_log ?? []).filter((x) => x && typeof x === 'object')
  const moments = computeMoments(s, log, roles)
  return (
    <div className="flex flex-col gap-3">
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: -2 }}
        transition={{ type: 'spring', stiffness: 260, damping: 12 }}
        className={cn('sticker p-3 text-center text-[#1f1b2e]', w.bg)}
      >
        <p className="font-display text-2xl font-extrabold">
          {w.emoji} {w.text}
        </p>
        {s.winner === 'mrwhite' && s.mrwhite_guess?.word && <p className="font-bold">Sa réponse : « {s.mrwhite_guess.word} »</p>}
      </motion.div>

      {s.words && (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['Mot des civils', s.words.civil, 'bg-mint', 0.4],
              ['Mot undercover', s.words.undercover, 'bg-tomato text-white', 0.8],
            ] as const
          ).map(([label, word, bg, delay]) => (
            <div key={label} className="h-28 [perspective:800px]">
              <motion.div
                className="relative size-full [transform-style:preserve-3d]"
                initial={{ rotateY: 0 }}
                animate={{ rotateY: 180 }}
                transition={{ delay, type: 'spring', stiffness: 120, damping: 14 }}
              >
                <div className="sticker absolute inset-0 flex items-center justify-center bg-grape text-4xl text-white [backface-visibility:hidden]">?</div>
                <div className={cn('sticker absolute inset-0 flex [transform:rotateY(180deg)] flex-col items-center justify-center p-2 text-center text-[#1f1b2e] [backface-visibility:hidden]', bg)}>
                  <span className="text-xs font-bold uppercase">{label}</span>
                  <span className="font-display text-2xl leading-tight font-extrabold break-words">{word}</span>
                </div>
              </motion.div>
            </div>
          ))}
        </div>
      )}

      {moments.length > 0 && (
        <div className="sticker flex flex-col gap-2 bg-surface p-3">
          <p className="font-display font-extrabold">Les moments de la partie 🎬</p>
          {moments.map((m, i) => {
            const p = playerOrPlaceholder(players, m.id)
            return (
              <motion.div
                key={m.title}
                initial={{ x: -40, opacity: 0, rotate: -3 }}
                animate={{ x: 0, opacity: 1, rotate: 0 }}
                transition={{ delay: 1.2 + i * 0.15, type: 'spring', stiffness: 300, damping: 18 }}
                className="flex items-center gap-3 rounded-chip bg-sunk p-2"
              >
                <Avatar slug={p.slug} expression={mood(p, 'sly')} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted">
                    {m.emoji} {m.title}
                  </p>
                  <p className="font-display text-base leading-tight font-extrabold">
                    {p.nickname} <span className="text-sm font-bold text-muted">· {m.detail}</span>
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
        <p className="font-display font-extrabold">Les rôles</p>
        {s.players.map((id) => {
          const p = playerOrPlaceholder(players, id)
          const r = roles[id] ?? 'civil'
          const out = !s.alive.includes(id)
          return (
            <div key={id} className={cn('flex items-center gap-2', id === meId && 'font-extrabold')}>
              <Avatar slug={p.slug} expression={r === 'civil' ? p.equipped : mood(p, 'sly')} size={30} />
              <span className="flex-1">
                {p.nickname}
                {out && <span className="text-muted"> · éliminé·e</span>}
              </span>
              <span className={cn('rounded-full border-2 border-ink px-2 text-sm font-extrabold', ROLE_INFO[r].bg)}>
                {ROLE_INFO[r].emoji} {ROLE_INFO[r].label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { mood, pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import type { GameSummaryProps } from '../types'
import { FaceIcon } from './Dice'
import type { MtrState } from './types'
import { MtrMoments } from './Moments'

const MEDALS = ['🏆', '🥈', '🥉']

/** Fin de partie : vainqueur (chibi cool), classement inverse des éliminations, petites stats de bluff. */
export default function MenteurSummary({ state, players, meId }: GameSummaryProps) {
  const s = state as unknown as MtrState
  const reduce = useReducedMotion()
  if (!s.winner) return null
  const winner = playerOrPlaceholder(players, s.winner)
  const ranked = [s.winner, ...[...s.eliminated].reverse()]
  const history = s.history ?? []

  // Stats : « Menteur ! » justes et bluffs démasqués.
  const rightCalls: Record<string, number> = {}
  const caught: Record<string, number> = {}
  for (const h of history) {
    if (h.kind !== 'liar') continue
    if (h.loser && h.loser !== h.caller) {
      rightCalls[h.caller] = (rightCalls[h.caller] ?? 0) + 1
      caught[h.loser] = (caught[h.loser] ?? 0) + 1
    }
  }
  const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1])[0]
  const detective = top(rightCalls)
  const bluffer = top(caught)
  const piles = history.filter((h) => h.kind === 'pile' && h.count === h.bid.qty).length
  const final = history.at(-1)

  return (
    <div className="flex flex-col gap-3">
      <motion.div
        initial={{ scale: 0, rotate: -12 }}
        animate={{ scale: 1, rotate: 2 }}
        transition={{ type: 'spring', stiffness: 220, damping: 12, delay: 0.3 }}
        className="sticker relative flex flex-col items-center gap-1 overflow-hidden bg-grape p-3 text-center text-white"
      >
        <motion.div animate={reduce ? undefined : { y: [0, -6, 0], rotate: [-2, 2, -2] }} transition={{ repeat: Infinity, duration: 1.1 }}>
          <ChibiImage slug={winner.slug} expression={pickExpression(winner, 'cool', 'pouces', 'joie')} size={130} />
        </motion.div>
        <p className="font-display text-3xl leading-none font-extrabold" style={{ textShadow: '3px 3px 0 #1f1b2e' }}>
          {s.winner === meId ? 'Tu gardes' : `${winner.nickname} garde`} le dernier gobelet !
        </p>
        <p className="font-bold">
          Avec {s.dice_count[s.winner] ?? 0} dé{(s.dice_count[s.winner] ?? 0) > 1 ? 's' : ''} restant{(s.dice_count[s.winner] ?? 0) > 1 ? 's' : ''}, en {s.round} manche{s.round > 1 ? 's' : ''}.
        </p>
        {final && (
          <p className="mt-1 flex items-center gap-1 rounded-full border-2 border-ink bg-surface px-3 py-0.5 text-sm font-extrabold text-text">
            Dernière enchère : {final.bid.qty} × <FaceIcon value={final.bid.face} size={18} /> ({final.count} sur la table)
          </p>
        )}
      </motion.div>

      <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
        <p className="font-display font-extrabold">Classement</p>
        {ranked.map((id, i) => {
          const p = playerOrPlaceholder(players, id)
          const last = i === ranked.length - 1 && ranked.length > 1
          return (
            <motion.div
              key={id}
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.07 }}
              className={cn('flex items-center gap-2', id === meId && 'font-extrabold')}
            >
              <span className="w-7 text-center text-lg">{MEDALS[i] ?? `${i + 1}.`}</span>
              <Avatar slug={p.slug} expression={i === 0 ? mood(p, 'proud') : last ? mood(p, 'sad') : p.equipped} size={30} />
              <span className="flex-1">{p.nickname}</span>
              <span className="text-sm text-muted">{i === 0 ? 'vainqueur' : `sorti·e ${ranked.length - i}${ranked.length - i === 1 ? 'er' : 'e'}`}</span>
            </motion.div>
          )
        })}
        <p className="mt-1 text-xs text-muted">Points = joueurs − place. Seul le dernier à garder des dés gagne.</p>
      </div>

      <MtrMoments s={s} players={players} />

      {(detective || bluffer || piles > 0) && (
        <div className="grid grid-cols-2 gap-2">
          {detective && (
            <div className="sticker flex flex-col items-center gap-1 bg-sky p-2 text-center text-[#1f1b2e]">
              <span className="text-xs font-extrabold uppercase">Flair de détective 🔍</span>
              <Avatar slug={playerOrPlaceholder(players, detective[0]).slug} expression={mood(playerOrPlaceholder(players, detective[0]), 'sly')} size={40} />
              <span className="text-sm font-bold">
                {playerOrPlaceholder(players, detective[0]).nickname} · {detective[1]} menteur{detective[1] > 1 ? 's' : ''} démasqué{detective[1] > 1 ? 's' : ''}
              </span>
            </div>
          )}
          {bluffer && (
            <div className="sticker flex flex-col items-center gap-1 bg-bubblegum p-2 text-center text-[#1f1b2e]">
              <span className="text-xs font-extrabold uppercase">Pris la main dans le sac 🙊</span>
              <Avatar slug={playerOrPlaceholder(players, bluffer[0]).slug} expression={mood(playerOrPlaceholder(players, bluffer[0]), 'shy')} size={40} />
              <span className="text-sm font-bold">
                {playerOrPlaceholder(players, bluffer[0]).nickname} · {bluffer[1]} bluff{bluffer[1] > 1 ? 's' : ''} grillé{bluffer[1] > 1 ? 's' : ''}
              </span>
            </div>
          )}
          {piles > 0 && (
            <div className="sticker col-span-2 bg-mint p-2 text-center text-sm font-bold text-[#1f1b2e]">
              🎯 {piles} « Pile ! » réussi{piles > 1 ? 's' : ''} dans la partie
            </div>
          )}
        </div>
      )}
    </div>
  )
}

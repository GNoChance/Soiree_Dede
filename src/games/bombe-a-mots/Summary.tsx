import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'
import type { BamState } from './types'
import { longestWord } from './setup'

const RECORD_KEY = 'dede:bam-record'
const MEDALS = ['🥇', '🥈', '🥉']

interface Rec {
  w: string
  len: number
}

const letters = (w: string) => w.replace(/-/g, '').length

/** Record perso (mot le plus long) mémorisé sur cet appareil. */
function readRecord(meId: string): Rec | null {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(RECORD_KEY) ?? '{}') as Record<string, Rec>
    return all[meId] ?? null
  } catch {
    return null
  }
}

function writeRecord(meId: string, rec: Rec) {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(RECORD_KEY) ?? '{}') as Record<string, Rec>
    const cur = all[meId]
    if (cur && cur.len >= rec.len) return
    all[meId] = rec
    globalThis.localStorage?.setItem(RECORD_KEY, JSON.stringify(all))
  } catch {
    /* stockage indisponible */
  }
}

/** Bloc fin de partie : classement de survie, mot le plus long, plus de mots, record perso. */
export default function BombeSummary({ state, meId, players }: GameSummaryProps) {
  const s = state as unknown as BamState
  const get = (id: string) => playerOrPlaceholder(players, id)
  const words = s.words ?? []
  const ranking = s.ranking ?? [...(s.alive ?? []), ...[...(s.eliminated ?? [])].reverse()]
  const longest = longestWord(words)
  const counts = s.word_counts ?? {}
  const topCount = Math.max(0, ...Object.values(counts))
  const topWriters = Object.keys(counts).filter((id) => topCount > 0 && counts[id] === topCount)
  const booms = (id: string) => (s.explosions ?? []).filter((e) => e.p === id).length
  const bonusLives = (id: string) => (s.bonuses ?? []).filter((b) => b.p === id && b.life).length

  const myWords = words.filter((w) => w.p === meId)
  const myLongest = longestWord(myWords)
  // Ancien record lu une fois (avant mise à jour), puis enregistrement du nouveau.
  const [previous] = useState(() => readRecord(meId))
  const best = myLongest ? { w: myLongest.w, len: letters(myLongest.w) } : null
  const record = { previous, beaten: !!best && (!previous || best.len > previous.len) }
  useEffect(() => {
    if (best && record.beaten) writeRecord(meId, best)
  }, [meId, best?.w, best?.len, record.beaten]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="flex flex-col gap-3">
      <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
        <p className="font-display text-lg font-extrabold">💣 Survie</p>
        {ranking.map((id, i) => {
          const p = get(id)
          return (
            <motion.div
              key={id}
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 1.4 + i * 0.08 }}
              className={cn('flex items-center gap-2 rounded-chip px-1 py-0.5', id === meId && 'bg-sunk')}
            >
              <span className="w-6 text-center">{MEDALS[i] ?? i + 1}</span>
              <Avatar slug={p.slug} expression={i === 0 ? mood(p, 'proud') : mood(p, 'sad')} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold leading-tight">{p.nickname}</p>
                <p className="text-xs font-bold text-muted">
                  ✍️ {counts[id] ?? 0} mot{(counts[id] ?? 0) > 1 ? 's' : ''} · 💥 {booms(id)}
                  {bonusLives(id) > 0 && ` · +${bonusLives(id)} ❤️ alphabet`}
                </p>
              </div>
              {i === 0 && <span className="font-display text-sm font-extrabold">Survivant·e</span>}
            </motion.div>
          )
        })}
      </div>

      {longest && (
        <div className="sticker flex items-center gap-3 bg-sun p-3 text-[#1f1b2e]">
          <Avatar slug={get(longest.p).slug} expression={mood(get(longest.p), 'proud')} size={52} />
          <div className="min-w-0">
            <p className="text-sm font-bold">📏 Mot le plus long ({letters(longest.w)} lettres)</p>
            <p className="truncate font-display text-2xl leading-tight font-extrabold uppercase">{longest.w}</p>
            <p className="text-sm">
              par {get(longest.p).nickname} sur « {longest.s.toUpperCase()} »
            </p>
          </div>
        </div>
      )}

      {topWriters.length > 0 && (
        <div className="sticker flex items-center gap-3 bg-mint p-3 text-[#1f1b2e]">
          <div className="flex -space-x-3">
            {topWriters.map((id) => (
              <Avatar key={id} slug={get(id).slug} expression={mood(get(id), 'happy')} size={44} />
            ))}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold">✍️ Plus de mots</p>
            <p className="font-display text-lg leading-tight font-extrabold">
              {topWriters.map((id) => get(id).nickname).join(', ')} · {topCount} mot{topCount > 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}

      {s.players?.includes(meId) && (
        <div className={cn('sticker p-3', record.beaten ? 'bg-bubblegum text-[#1f1b2e]' : 'bg-surface')}>
          <p className="text-sm font-bold">🏅 Ton record (mot le plus long)</p>
          {record.beaten && myLongest ? (
            <motion.p initial={{ scale: 2, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 1.8, type: 'spring', stiffness: 300, damping: 10 }} className="font-display text-xl font-extrabold">
              NOUVEAU RECORD : <span className="uppercase">{myLongest.w}</span> ({letters(myLongest.w)})
              {record.previous && <span className="block text-sm font-bold">ancien : {record.previous.w} ({record.previous.len})</span>}
            </motion.p>
          ) : record.previous ? (
            <p className="font-display text-lg font-extrabold">
              <span className="uppercase">{record.previous.w}</span> ({record.previous.len} lettres)
              {myLongest && <span className="block text-sm font-bold text-muted">cette partie : {myLongest.w} ({letters(myLongest.w)})</span>}
            </p>
          ) : (
            <p className="font-bold text-muted">Aucun mot cette fois… la prochaine sera la bonne 💪</p>
          )}
        </div>
      )}

      {words.length > 0 && (
        <details className="sticker bg-surface p-3">
          <summary className="cursor-pointer font-display font-extrabold">📜 Tous les mots ({words.length})</summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {words.map((w) => (
              <span key={w.n} className="rounded-full border-2 border-ink/30 bg-sunk px-2 py-0.5 text-xs font-bold">
                <Avatar slug={get(w.p).slug} size={16} className="mr-1 align-middle" />
                <span className="uppercase">{w.w}</span> <span className="text-muted">({w.s})</span>
              </span>
            ))}
          </div>
        </details>
      )}
    </motion.div>
  )
}

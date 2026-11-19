import { useState } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import { useCountdown } from '@/features/soiree/useServerClock'
import { DoneStrip } from '../Parts'
import type { MajData } from '../types'
import type { MgPlayProps, MgTvProps } from './common'

/** Comme tout le monde : un « Qui de nous… ? », on vote pour un joueur, la majorité gagne. */
export function MajoritePlay({ mg, players, get, submit, submitted }: MgPlayProps) {
  const data = mg.data as unknown as MajData
  const [pick, setPick] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [voted, setVoted] = useState<string | null>(null)

  const vote = async () => {
    if (!pick || sending) return
    setSending(true)
    const ok = await submit({ target: pick })
    setSending(false)
    if (ok) setVoted(pick)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="sticker bg-surface p-3 text-center font-display text-xl leading-snug font-extrabold">{data.question}</p>
      {submitted || voted ? (
        <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="sticker flex flex-col items-center gap-1 bg-mint p-3 text-[#1f1b2e]">
          <span className="text-sm font-bold opacity-75">Ton vote</span>
          {voted ? (
            <>
              <Avatar slug={get(voted).slug} tenue={get(voted).equippedTenue} size={64} />
              <span className="font-display text-2xl font-extrabold">{get(voted).nickname}</span>
            </>
          ) : (
            <span className="font-display text-2xl font-extrabold">✔ Envoyé</span>
          )}
        </motion.div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {players.map((id) => {
              const p = get(id)
              const on = pick === id
              return (
                <motion.button
                  key={id}
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={() => {
                    fx.tick()
                    setPick(id)
                  }}
                  className={cn('flex flex-col items-center gap-1 rounded-card border-[3px] border-ink p-2 shadow-sticker-sm', on ? 'bg-sun text-[#1f1b2e]' : 'bg-surface')}
                >
                  <Avatar slug={p.slug} tenue={p.equippedTenue} size={56} selected={on} />
                  <span className="w-full truncate text-center text-sm font-extrabold">{p.nickname}</span>
                </motion.button>
              )
            })}
          </div>
          <Button size="lg" disabled={!pick} loading={sending} onClick={() => void vote()}>
            {pick ? `Je vote ${get(pick).nickname} !` : 'Choisis quelqu’un'}
          </Button>
        </>
      )}
    </div>
  )
}

export function MajoriteTv({ s, mg, get }: MgTvProps) {
  const data = mg.data as unknown as MajData
  const left = useCountdown(s.deadline)
  return (
    <div className="flex w-full flex-col items-center gap-4 text-center">
      <p className="sticker bg-surface p-5 font-display text-4xl leading-tight font-extrabold">{data.question}</p>
      <p className="font-display text-2xl font-extrabold text-muted">Votez comme la majorité !</p>
      <p className="font-display text-5xl font-extrabold tabular-nums">{Math.ceil(left / 1000)} s</p>
      <DoneStrip ids={s.players} done={mg.submitted} get={get} size={56} />
    </div>
  )
}

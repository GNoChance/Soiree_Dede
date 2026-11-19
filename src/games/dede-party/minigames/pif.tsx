import { useEffect, useRef, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import { useCountdown } from '@/features/soiree/useServerClock'
import { formatLive, parseNumberInput, withUnit } from '../../le-plus-proche/setup'
import { DoneStrip } from '../Parts'
import type { PifData } from '../types'
import type { MgPlayProps, MgTvProps } from './common'

/** Au pif : une question chiffrée, la saisie de « Le plus proche ». */
export function PifPlay({ mg, submit, submitted }: MgPlayProps) {
  const data = mg.data as unknown as PifData
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sentValue, setSentValue] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 400)
    return () => clearTimeout(t)
  }, [])

  const send = async (v: number) => {
    if (sending || submitted) return
    setSending(true)
    const ok = await submit({ value: v })
    setSending(false)
    if (ok) {
      setSentValue(v)
      fx.success()
    }
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const p = parseNumberInput(text)
    if (!p.ok) {
      setError(p.reason === 'empty' ? 'Tape un nombre !' : p.reason === 'range' ? 'Beaucoup trop grand !' : 'Chiffres et virgule uniquement.')
      fx.fail()
      return
    }
    void send(p.value)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="sticker bg-surface p-3 text-center font-display text-xl leading-snug font-extrabold">{data.prompt}</p>
      {submitted || sentValue !== null ? (
        <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="sticker bg-mint p-3 text-center text-[#1f1b2e]">
          <p className="text-sm font-bold opacity-75">Ton estimation</p>
          <p className="font-display text-3xl font-extrabold break-all">{sentValue !== null ? withUnit(sentValue, data.unit) : '✔'}</p>
        </motion.div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <div className={cn('sticker flex items-center gap-2 p-2', error ? 'bg-tomato/15' : 'bg-surface')}>
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(formatLive(e.target.value, e.target.selectionStart ?? e.target.value.length).text)
                setError(null)
              }}
              inputMode="decimal"
              enterKeyHint="send"
              autoComplete="off"
              placeholder="Ton estimation"
              aria-label="Ton estimation"
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-right font-display text-3xl font-extrabold outline-none placeholder:text-left placeholder:text-xl placeholder:text-muted/60"
            />
            {data.unit && <span className="max-w-[35%] shrink-0 truncate font-display text-lg font-extrabold text-muted">{data.unit}</span>}
          </div>
          {error && <p className="text-center font-display font-extrabold text-tomato">{error}</p>}
          <Button type="submit" size="lg" loading={sending} disabled={!text.trim()} icon={<Check className="size-6" strokeWidth={3} />}>
            Valider
          </Button>
        </form>
      )}
    </div>
  )
}

/** Télé : la question en grand + qui a répondu. */
export function PifTv({ s, mg, get }: MgTvProps) {
  const data = mg.data as unknown as PifData
  const left = useCountdown(s.deadline)
  return (
    <div className="flex w-full flex-col items-center gap-4 text-center">
      <p className="sticker bg-surface p-5 font-display text-4xl leading-tight font-extrabold">{data.prompt}</p>
      {data.unit && <p className="font-display text-2xl font-extrabold text-muted">Réponse en {data.unit}</p>}
      <p className="font-display text-5xl font-extrabold tabular-nums">{Math.ceil(left / 1000)} s</p>
      <DoneStrip ids={s.players} done={mg.submitted} get={get} size={56} />
    </div>
  )
}

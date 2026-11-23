import { useState } from 'react'
import { cn } from '@/lib/cn'
import { DP_RULE_BLOCKS } from './rules-text'

const KEY = 'dede:aide:dede-party:regles'
const read = () => {
  try {
    return Number(localStorage.getItem(KEY) ?? '0')
  } catch {
    return 0
  }
}

/** Carrousel des 3 blocs de règles, affiché au générique les 3 premières fois (refermable). */
export function RulesCarousel() {
  const [shown] = useState(() => {
    const n = read()
    try {
      localStorage.setItem(KEY, String(n + 1))
    } catch {
      /* sans stockage : rendu normal */
    }
    return n < 3
  })
  const [open, setOpen] = useState(true)
  const [i, setI] = useState(0)
  if (!shown || !open) return null
  const b = DP_RULE_BLOCKS[i]
  return (
    <div className="sticker flex w-full max-w-md flex-col gap-2 bg-surface p-3 text-left">
      <p className="font-display text-lg font-extrabold">{b.title}</p>
      <p className="text-base leading-snug font-bold">{b.text}</p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {DP_RULE_BLOCKS.map((_, k) => (
            <span key={k} className={cn('size-2.5 rounded-full border-2 border-ink', k === i ? 'bg-sun' : 'bg-sunk')} />
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-sm font-bold text-muted">Fermer</button>
          {i < DP_RULE_BLOCKS.length - 1 ? (
            <button type="button" onClick={() => setI(i + 1)} className="rounded-chip border-[3px] border-ink bg-sun px-3 py-1 font-display font-extrabold text-[#1f1b2e]">Suivant ›</button>
          ) : (
            <button type="button" onClick={() => setOpen(false)} className="rounded-chip border-[3px] border-ink bg-sun px-3 py-1 font-display font-extrabold text-[#1f1b2e]">J’ai compris</button>
          )}
        </div>
      </div>
    </div>
  )
}

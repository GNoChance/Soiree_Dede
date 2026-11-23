import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { usePlayers } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import { REACTION_EMOJIS, useReactionChannel, type ReactionPayload } from './channel'

const MAX_ON_SCREEN = 25
const LIFETIME_MS = 2500

interface Floating {
  id: number
  e: string
  p: string
  dx: number
  left: number
}

/**
 * Couche de réactions emoji. `interactive` : bouton flottant (joueurs) ; sinon affichage seul (télé, emojis plus gros).
 * À monter une seule fois par écran de partie.
 */
export function Reactions({ matchId, meId, interactive = true, big = false }: { matchId: string; meId: string; interactive?: boolean; big?: boolean }) {
  const reduce = useReducedMotion()
  const { byId } = usePlayers()
  const [items, setItems] = useState<Floating[]>([])
  const [open, setOpen] = useState(false)
  const seq = useRef(0)
  const sent = useRef<number[]>([])
  const closeTimer = useRef<number | null>(null)

  const push = useCallback((r: ReactionPayload) => {
    const id = ++seq.current
    const f: Floating = { id, e: r.e, p: r.p, dx: Math.round((Math.random() - 0.5) * 90), left: 8 + Math.random() * 84 }
    setItems((l) => [...l, f].slice(-MAX_ON_SCREEN))
    window.setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), LIFETIME_MS + 100)
  }, [])

  const send = useReactionChannel(matchId, push)

  const armClose = useCallback(() => {
    if (closeTimer.current != null) clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(false), 4000)
  }, [])
  useEffect(
    () => () => {
      if (closeTimer.current != null) clearTimeout(closeTimer.current)
    },
    [],
  )

  const emit = (e: string) => {
    armClose()
    const now = Date.now()
    const recent = sent.current.filter((t) => now - t < 5000)
    if (recent.length >= 6 || (recent.length && now - recent[recent.length - 1] < 600)) return
    sent.current = [...recent, now]
    push({ e, p: meId })
    send({ e, p: meId })
  }

  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[45] overflow-hidden">
        <AnimatePresence>
          {items.map((f) => {
            const p = byId[f.p]
            return (
              <motion.div
                key={f.id}
                className="absolute flex items-end gap-1"
                style={{ left: `${f.left}%`, bottom: 0 }}
                initial={reduce ? { opacity: 0 } : { y: -40, x: 0, scale: 0.5, opacity: 0 }}
                animate={
                  reduce
                    ? { opacity: [0, 1, 1, 0] }
                    : { y: [-40, big ? -380 : -260], x: [0, f.dx], scale: [0.5, big ? 2 : 1.4], opacity: [0, 1, 1, 0] }
                }
                transition={{ duration: LIFETIME_MS / 1000, ease: 'easeOut', times: [0, 0.15, 0.65, 1] }}
                exit={{ opacity: 0 }}
              >
                {p && <Avatar slug={p.slug} expression={p.equipped} tenue={p.equippedTenue} size={big ? 44 : 28} />}
                <span className={big ? 'text-6xl' : 'text-4xl'}>{f.e}</span>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      {interactive && (
        <div className="pl-safe fixed left-2 z-[44] flex items-center gap-2" style={{ bottom: '34%' }}>
          <button
            type="button"
            aria-label={open ? 'Fermer les réactions' : 'Envoyer une réaction'}
            onClick={() => {
              setOpen((o) => !o)
              armClose()
            }}
            className={cn(
              'flex size-12 items-center justify-center rounded-full border-[3px] border-ink bg-surface text-2xl shadow-sticker-sm',
              !open && 'opacity-80',
            )}
          >
            😊
          </button>
          {open && (
            <div className="flex gap-1 rounded-full border-[3px] border-ink bg-surface p-1 shadow-sticker-sm">
              {REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-label={`Réagir ${e}`}
                  onClick={() => emit(e)}
                  className="flex size-10 items-center justify-center rounded-full text-2xl active:scale-90"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageCircle, Send, Smile } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { BottomSheet } from '@/components/ui/Modal'
import { tenueExtras, tenuePalette } from '@/components/ui/tenueArt'
import { EXPRESSIONS } from '@/data/expressions'
import type { ExpressionId } from '@/types/db'
import { cn } from '@/lib/cn'
import { playSound } from '@/lib/feedback'
import { useActiveSoireesStore } from '@/features/soiree/activeSoirees'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { useSession } from '@/store/session'
import { useSoireeChat, type ChatMessage } from './useSoireeChat'

/**
 * Chat de la soirée affichée (salon ou partie) : bulle flottante + feuille de discussion.
 * Monté une seule fois à la racine ; suit la soirée déclarée par `useViewingSoiree`.
 */
export function SoireeChat() {
  const viewing = useActiveSoireesStore((s) => s.viewing?.soireeId)
  const meId = useSession((s) => s.profile?.id)
  // en passant du salon à la partie, la soirée affichée est vide un court instant : on garde la bulle
  const [soireeId, setSoireeId] = useState(viewing)
  useEffect(() => {
    if (viewing) {
      setSoireeId(viewing)
      return
    }
    const t = setTimeout(() => setSoireeId(undefined), 1500)
    return () => clearTimeout(t)
  }, [viewing])
  if (!soireeId || !meId) return null
  return <ChatWidget key={soireeId} soireeId={soireeId} meId={meId} />
}

const seenKey = (soireeId: string) => `chat-seen:${soireeId}`
const readSeen = (soireeId: string) => {
  try {
    return Number(localStorage.getItem(seenKey(soireeId))) || 0
  } catch {
    return 0
  }
}

function ChatWidget({ soireeId, meId }: { soireeId: string; meId: string }) {
  const { byId } = usePlayers()
  const me = playerOrPlaceholder(byId, meId)
  const [open, setOpen] = useState(false)
  const [tray, setTray] = useState(false)
  const [text, setText] = useState('')
  const [seen, setSeen] = useState(() => readSeen(soireeId))
  const [previews, setPreviews] = useState<ChatMessage[]>([])
  const openRef = useRef(open)
  openRef.current = open

  const { messages, send, sending } = useSoireeChat(soireeId, meId, (m) => {
    if (openRef.current) return
    playSound('pop')
    setPreviews((p) => [...p.slice(-2), m])
    setTimeout(() => setPreviews((p) => p.filter((x) => x.id !== m.id)), 4500)
  })

  const lastId = messages.length ? messages[messages.length - 1].id : 0
  const unread = messages.filter((m) => m.id > seen && m.profile_id !== meId).length

  // feuille ouverte : tout est lu, et on reste calé en bas
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    endRef.current?.scrollIntoView({ block: 'end' })
    if (lastId > seen) {
      setSeen(lastId)
      try {
        localStorage.setItem(seenKey(soireeId), String(lastId))
      } catch {
        /* stockage indisponible */
      }
    }
  }, [open, lastId, seen, soireeId])

  // seuls les stickers débloqués (comme dans l'inventaire) : les autres, il faut les gagner !
  const unlocks = useSession((s) => s.unlocks)
  const stickers = useMemo(
    () => [
      ...tenuePalette(me.slug, me.equippedTenue).filter(
        (e) => e === 'joie' || EXPRESSIONS[e as ExpressionId]?.default || unlocks[e as ExpressionId],
      ),
      ...tenueExtras(me.slug, me.equippedTenue).map((x) => x.id),
    ],
    [me.slug, me.equippedTenue, unlocks],
  )

  const submit = async () => {
    const body = text.trim()
    if (!body || sending) return
    setText('')
    if (!(await send('text', body))) setText(body)
  }

  return (
    <>
      {/* bulle flottante + aperçus des messages reçus */}
      <div className="pointer-events-none fixed right-2 top-[42%] z-[45] flex flex-col items-end gap-2">
        <AnimatePresence>
          {!open &&
            previews.map((m) => {
              const p = playerOrPlaceholder(byId, m.profile_id)
              return (
                <motion.button
                  key={m.id}
                  type="button"
                  initial={{ opacity: 0, x: 40, scale: 0.8 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 40, scale: 0.8 }}
                  onClick={() => setOpen(true)}
                  className="pointer-events-auto flex max-w-[70vw] items-center gap-2 rounded-chip border-[3px] border-ink bg-surface px-2 py-1 text-left text-text shadow-sticker-sm"
                >
                  <Avatar slug={p.slug} size={32} />
                  {m.kind === 'sticker' ? (
                    <ChibiImage slug={p.slug} tenue={m.tenue || p.equippedTenue} expression={m.body} size={72} bare />
                  ) : (
                    <span className="min-w-0">
                      <span className="block text-xs font-extrabold text-muted">{p.nickname}</span>
                      <span className="line-clamp-2 break-words text-sm font-bold">{m.body}</span>
                    </span>
                  )}
                </motion.button>
              )
            })}
        </AnimatePresence>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={unread ? `Discussion : ${unread} nouveau${unread > 1 ? 'x' : ''} message${unread > 1 ? 's' : ''}` : 'Ouvrir la discussion'}
          className="pointer-events-auto relative grid size-12 place-items-center rounded-full border-[3px] border-ink bg-sun text-ink shadow-sticker-sm"
        >
          <MessageCircle className="size-6" />
          {unread > 0 && (
            <span className="absolute -left-2 -top-2 grid min-w-6 place-items-center rounded-full border-2 border-ink bg-tomato px-1 text-xs font-extrabold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </div>

      <BottomSheet
        open={open}
        onClose={() => {
          setOpen(false)
          setTray(false)
        }}
        title="💬 Discussion"
        footer={
          <div className="flex flex-col gap-2">
            {tray && (
              <div className="grid max-h-44 grid-cols-5 gap-1 overflow-y-auto rounded-card border-[3px] border-ink bg-sunk p-2">
                {stickers.map((e) => (
                  <button
                    key={e}
                    type="button"
                    disabled={sending}
                    onClick={() => void send('sticker', e)}
                    aria-label={`Envoyer le sticker ${e}`}
                    className="grid place-items-center rounded-chip p-1 active:scale-90"
                  >
                    <ChibiImage slug={me.slug} tenue={me.equippedTenue} expression={e} size={56} bare />
                  </button>
                ))}
              </div>
            )}
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <button
                type="button"
                onClick={() => setTray((t) => !t)}
                aria-label="Stickers"
                aria-pressed={tray}
                className={cn('grid size-12 shrink-0 place-items-center rounded-full border-[3px] border-ink shadow-sticker-sm', tray ? 'bg-sun text-ink' : 'bg-surface text-text')}
              >
                <Smile className="size-6" />
              </button>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={200}
                placeholder="Ton message…"
                enterKeyHint="send"
                autoComplete="off"
                className="h-12 min-w-0 flex-1 rounded-chip border-[3px] border-ink bg-surface px-3 text-base font-bold text-text placeholder:text-muted focus:outline-none focus:ring-4 focus:ring-sun"
              />
              <button
                type="submit"
                disabled={!text.trim() || sending}
                aria-label="Envoyer"
                className="grid size-12 shrink-0 place-items-center rounded-full border-[3px] border-ink bg-sun text-ink shadow-sticker-sm disabled:opacity-40"
              >
                <Send className="size-5" />
              </button>
            </form>
          </div>
        }
      >
        <div className="flex min-h-40 flex-col gap-2 pb-2">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm font-bold text-muted">Personne n’a encore rien dit… Lance la conversation, ou envoie un sticker !</p>
          )}
          {messages.map((m, k) => {
            const mine = m.profile_id === meId
            const p = playerOrPlaceholder(byId, m.profile_id)
            const first = k === 0 || messages[k - 1].profile_id !== m.profile_id
            return (
              <div key={m.id} className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
                <div className="w-9 shrink-0">{first && !mine && <Avatar slug={p.slug} size={36} />}</div>
                <div className={cn('flex min-w-0 max-w-[78%] flex-col', mine ? 'items-end' : 'items-start')}>
                  {first && !mine && <span className="px-1 text-xs font-extrabold text-muted">{p.nickname}</span>}
                  {m.kind === 'sticker' ? (
                    <ChibiImage slug={p.slug} tenue={m.tenue || p.equippedTenue} expression={m.body} size={104} bare thumb={false} />
                  ) : (
                    <span
                      className={cn(
                        'break-words rounded-card border-[3px] border-ink px-3 py-2 text-base font-bold shadow-sticker-sm',
                        mine ? 'bg-sun text-ink' : 'bg-sunk text-text',
                      )}
                    >
                      {m.body}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>
      </BottomSheet>
    </>
  )
}

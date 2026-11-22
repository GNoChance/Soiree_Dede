import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router'
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import { Check, Lock, Trash2, Undo2 } from 'lucide-react'
import { PaperFold, FOLD_MS } from './PaperFold'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { useIsGuest } from '@/features/guest/api'
import { toastError } from '@/features/soiree/errors'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { toast } from '@/store/toast'
import {
  adminDeleteIdea,
  adminListIdeas,
  adminSetIdeaStatus,
  ideaBoxState,
  submitIdea,
  type Idea,
  type IdeaBoxState,
} from './api'

const MAX = 500
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/* -------------------------------------------------------------------------- */
/* La boîte (carton, fente, cadenas, papiers qui dépassent)                    */
/* -------------------------------------------------------------------------- */

const PEEK = [
  { x: 26, r: -14, h: 26 },
  { x: 78, r: 8, h: 32 },
  { x: 128, r: -5, h: 22 },
  { x: 170, r: 13, h: 28 },
]

function IdeaBox({ total, open, locked, slotRef, burst }: { total: number; open: boolean; locked: boolean; slotRef: React.Ref<HTMLDivElement>; burst: number }) {
  const reduce = useReducedMotion()
  const peeks = PEEK.slice(0, Math.min(PEEK.length, Math.ceil(Math.min(total, 12) / 3)))
  return (
    <div className="relative mx-auto h-44 w-56 select-none" style={{ perspective: 700 }} aria-hidden>
      {/* papiers qui dépassent */}
      {peeks.map((p, i) => (
        <div
          key={i}
          className="absolute top-8 w-8 rounded-sm border-[3px] border-ink bg-[#fffdf2]"
          style={{ left: p.x, height: p.h + 14, transform: `rotate(${p.r}deg)`, top: 34 - p.h }}
        />
      ))}
      {/* corps */}
      <div className="absolute inset-x-0 top-12 h-28 rounded-b-2xl border-[3px] border-ink bg-[#e0a35f] shadow-sticker">
        <div className="absolute inset-x-6 top-6 h-5 rounded-full border-2 border-ink/30 bg-[#c98a4b]/50" />
        <p className="absolute inset-x-0 top-14 text-center font-display text-lg font-extrabold tracking-widest text-[#1f1b2e]/80">
          IDÉES 💡
        </p>
        {locked && (
          <motion.div
            className="absolute -bottom-3 left-1/2 flex size-11 -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-ink bg-sun shadow-sticker-sm"
            animate={reduce ? undefined : { rotate: [0, -8, 8, 0] }}
            transition={{ repeat: Infinity, repeatDelay: 3, duration: 0.6 }}
          >
            <Lock className="size-5 text-[#1f1b2e]" />
          </motion.div>
        )}
      </div>
      {/* couvercle + fente */}
      <motion.div
        className="absolute inset-x-[-6px] top-6 z-10 h-9 origin-top rounded-t-xl border-[3px] border-ink bg-[#c98a4b] shadow-sticker-sm"
        animate={open ? { rotateX: -78, y: -10 } : { rotateX: 0, y: 0 }}
        transition={{ type: 'spring', stiffness: 150, damping: 11 }}
      >
        <div ref={slotRef} className="absolute top-1/2 left-1/2 h-3 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-[#1f1b2e]" />
      </motion.div>
      {/* gerbe d'étoiles qui sort de la fente */}
      {burst > 0 && (
        <div key={burst} className="pointer-events-none absolute top-[42px] left-1/2 z-20">
          {Array.from({ length: 9 }).map((_, i) => {
            const a = (-160 + i * 40) * (Math.PI / 180)
            return (
              <motion.span
                key={i}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-xl"
                initial={{ x: 0, y: 0, scale: 0.3, opacity: 1 }}
                animate={{ x: Math.cos(a) * 80, y: Math.sin(a) * 70 - 20, scale: [0.3, 1.2, 0.6], opacity: [1, 1, 0], rotate: i * 50 }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              >
                {i % 3 === 0 ? '⭐' : i % 3 === 1 ? '✨' : '💡'}
              </motion.span>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function IdeasPage() {
  const isGuest = useIsGuest()
  const reduce = useReducedMotion()
  const [box, setBox] = useState<IdeaBoxState | null>(null)
  const [opened, setOpened] = useState(false)

  const [text, setText] = useState('')
  const [anon, setAnon] = useState(false)
  const [sending, setSending] = useState(false)
  const [thanks, setThanks] = useState(false)

  const boxControls = useAnimationControls()
  const paper = useAnimationControls()
  const paperRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const flight = useAnimationControls()
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<{ w: number; h: number; phase: 1 | 2; inside: boolean; text: string } | null>(null)
  const [burst, setBurst] = useState(0)

  useEffect(() => {
    if (isGuest) return
    ideaBoxState().then(setBox).catch(() => {})
  }, [isGuest])

  const send = useCallback(async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    let state: IdeaBoxState
    try {
      state = await submitIdea(body, anon)
    } catch (e) {
      toastError(e)
      setSending(false)
      return
    }
    // Animation : pliage 3D en deux puis en quatre, vol en arc jusqu'à la fente, plongeon dans la boîte.
    if (!reduce && paperRef.current) {
      const pr = paperRef.current.getBoundingClientRect()
      const { width: w, height: h } = pr
      setStage({ w, h, phase: 1, text: body, inside: false })
      fx.deal()
      await wait(FOLD_MS + 100)
      await flight.start({ scaleY: [1, 0.95, 1.02, 1], transition: { duration: 0.28 } })
      setStage({ w, h, phase: 2, text: body, inside: false })
      fx.deal()
      await wait(FOLD_MS + 250)
      await flight.start({ scaleX: [1, 0.94, 1.03, 1], transition: { duration: 0.28 } })
      const sr = slotRef.current?.getBoundingClientRect()
      const st = stageRef.current?.getBoundingClientRect()
      const dx = sr && st ? sr.left + sr.width / 2 - (st.left + w / 4) : 0
      const dy = sr && st ? sr.top + sr.height / 2 - (st.top + (3 * h) / 4) : -300
      fx.whoosh()
      await flight.start({
        x: [0, dx * 0.45, dx],
        y: [0, dy * 0.7 - 110, dy - 36],
        rotate: [0, -35, 10],
        scale: [1, 0.75, 0.4],
        transition: { duration: 0.85, ease: 'easeInOut', times: [0, 0.55, 1] },
      })
      setStage((x) => (x ? { ...x, inside: true } : x))
      await flight.start({ y: dy + 34, scale: 0.34, transition: { duration: 0.3, ease: 'easeIn' } })
      setStage(null)
      flight.set({ x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1 })
      fx.success()
      setBurst((n) => n + 1)
      await boxControls.start({ y: [0, -26, 0, -9, 0], scaleY: [1, 1.06, 0.94, 1.02, 1], transition: { duration: 0.6 } })
    } else {
      fx.success()
      await paper.start({ opacity: 0, transition: { duration: 0.2 } })
    }
    setBox(state)
    setText('')
    setThanks(true)
    paper.set({ scaleX: 1, scaleY: 1, x: 0, y: 0, rotate: -1.5, opacity: 0 })
    await paper.start({ opacity: 1, transition: { duration: 0.4 } })
    setSending(false)
    void wait(4000).then(() => setThanks(false))
  }, [text, anon, sending, reduce, paper, boxControls, flight])

  if (isGuest) return <Navigate to="/" replace />

  const isAdmin = !!box?.is_admin
  return (
    <div className="flex flex-col gap-5 pb-6">
      <div>
        <h1 className="text-3xl">💡 Boîte à idées</h1>
        <p className="text-muted">Un nouveau jeu, une amélioration, un bug : écris-le, ça tombe dans la boîte !</p>
      </div>

      <motion.div animate={boxControls} className="relative z-10">
        <IdeaBox total={box?.total ?? 0} open={opened} locked={!isAdmin} slotRef={slotRef} burst={burst} />
      </motion.div>

      {!isAdmin && <p className="text-center text-sm font-bold text-muted">🔒 Seul l’admin peut ouvrir la boîte.</p>}

      <AnimatePresence>
        {thanks && (
          <motion.p
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-card border-[3px] border-ink bg-mint px-4 py-3 text-center font-display text-xl font-extrabold text-[#1f1b2e] shadow-sticker-sm"
            role="status"
          >
            Merci ! Ton idée est dans la boîte 💡
          </motion.p>
        )}
      </AnimatePresence>

      {/* Le papier */}
      <div className="relative">
        <motion.div
          ref={paperRef}
          animate={paper}
          initial={{ rotate: -1.5 }}
          className="rounded-card border-[3px] border-ink bg-[#fffdf2] p-4 text-[#1f1b2e] shadow-sticker"
          style={{
            visibility: stage ? 'hidden' : 'visible',
            backgroundImage: 'repeating-linear-gradient(transparent 0 27px, #9ec9f0 27px 28px)',
            backgroundPositionY: 12,
          }}
        >
          <label htmlFor="idee-texte" className="mb-1 block font-display text-lg font-extrabold">
            Mon idée
          </label>
          <textarea
            id="idee-texte"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX))}
            disabled={sending}
            rows={5}
            placeholder="Ex : un jeu de pétanque en ligne…"
            className="w-full resize-none bg-transparent text-lg leading-[28px] outline-none placeholder:text-[#1f1b2e]/40"
          />
          <p className="text-right text-xs font-bold text-[#1f1b2e]/60">
            {text.length}/{MAX}
          </p>
        </motion.div>
        {stage && (
          <motion.div
            ref={stageRef}
            animate={flight}
            className={cn('pointer-events-none absolute top-0 left-0', stage.inside ? 'z-0' : 'z-30')}
            style={{ width: stage.w, height: stage.h, transformOrigin: `${stage.w / 4}px ${(3 * stage.h) / 4}px` }}
          >
            <PaperFold text={stage.text} w={stage.w} h={stage.h} phase={stage.phase} />
          </motion.div>
        )}
      </div>

      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-card border-[3px] border-ink bg-surface px-4 py-2 font-bold shadow-sticker-sm">
        <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} disabled={sending} className="size-6 accent-grape" />
        Rester anonyme 🕵️
      </label>

      <Button size="lg" fullWidth loading={sending} disabled={!text.trim()} onClick={send}>
        Plier et glisser dans la boîte ✉️
      </Button>

      {box && box.mine > 0 && (
        <p className="text-center font-bold text-muted">
          Tu as glissé {box.mine} idée{box.mine > 1 ? 's' : ''} dans la boîte.
        </p>
      )}

      {isAdmin && (
        <AdminPanel
          unread={box?.unread ?? 0}
          opened={opened}
          setOpened={setOpened}
          onChanged={() => ideaBoxState().then(setBox).catch(() => {})}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Admin : ouverture de la boîte                                               */
/* -------------------------------------------------------------------------- */

function AdminPanel({ unread, opened, setOpened, onChanged }: { unread: number; opened: boolean; setOpened: (v: boolean) => void; onChanged: () => void }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [filter, setFilter] = useState<'new' | 'done'>('new')
  const [toDelete, setToDelete] = useState<Idea | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      setIdeas(await adminListIdeas())
    } catch (e) {
      toastError(e)
    }
  }, [])

  const toggle = async () => {
    if (opened) {
      setOpened(false)
      return
    }
    setLoading(true)
    await load()
    setLoading(false)
    fx.success()
    setOpened(true)
  }

  const flip = async (i: Idea) => {
    const next = i.status === 'new' ? 'done' : 'new'
    try {
      await adminSetIdeaStatus(i.id, next)
      setIdeas((l) => l?.map((x) => (x.id === i.id ? { ...x, status: next } : x)) ?? l)
      onChanged()
    } catch (e) {
      toastError(e)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    const id = toDelete.id
    setToDelete(null)
    try {
      await adminDeleteIdea(id)
      setIdeas((l) => l?.filter((x) => x.id !== id) ?? l)
      onChanged()
      toast.success('Idée supprimée')
    } catch (e) {
      toastError(e)
    }
  }

  const shown = (ideas ?? []).filter((i) => i.status === filter)
  return (
    <div className="flex flex-col gap-4 border-t-[3px] border-dashed border-ink/30 pt-5">
      <Button size="lg" variant="secondary" fullWidth loading={loading} onClick={toggle}>
        {opened ? 'Refermer la boîte' : 'Ouvrir la boîte 🔓'}
        {!opened && unread > 0 && (
          <span className="ml-1 rounded-full border-[3px] border-ink bg-tomato px-2.5 text-lg text-white">{unread}</span>
        )}
      </Button>

      <AnimatePresence>
        {opened && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-3" style={{ perspective: 900 }}>
            <div className="flex gap-2">
              {(['new', 'done'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'min-h-11 flex-1 rounded-chip border-[3px] border-ink px-3 font-display font-extrabold',
                    filter === f ? 'bg-sun text-[#1f1b2e] shadow-sticker-sm' : 'bg-surface text-text',
                  )}
                >
                  {f === 'new' ? `À traiter (${(ideas ?? []).filter((i) => i.status === 'new').length})` : `Faites (${(ideas ?? []).filter((i) => i.status === 'done').length})`}
                </button>
              ))}
            </div>
            {shown.length === 0 && (
              <p className="py-4 text-center font-bold text-muted">{filter === 'new' ? 'Rien à traiter, la boîte est vide 🎉' : 'Aucune idée faite pour l’instant.'}</p>
            )}
            <AnimatePresence initial>
              {shown.map((i, n) => (
                <motion.div
                  key={i.id}
                  layout
                  style={{ transformOrigin: '50% 0%' }}
                  initial={{ opacity: 0, y: -140, scaleX: 0.25, scaleY: 0.2, rotateX: -95, rotate: n % 2 ? 18 : -18 }}
                  animate={{ opacity: 1, y: 0, scaleX: 1, scaleY: 1, rotateX: 0, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: 'spring', stiffness: 120, damping: 14, delay: 0.25 + Math.min(n, 8) * 0.12 }}
                >
                  <Card className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      {i.author_slug ? (
                        <Avatar slug={i.author_slug} size={44} />
                      ) : (
                        <span className="flex size-11 items-center justify-center rounded-full border-[3px] border-ink bg-sunk text-2xl">🕵️</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-lg leading-tight font-extrabold">{i.author_nickname ?? 'Anonyme'}</p>
                        <p className="text-xs font-bold text-muted">
                          {new Date(i.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      {i.status === 'done' && <Badge tone="mint">Fait</Badge>}
                    </div>
                    <p className="text-lg leading-snug break-words whitespace-pre-wrap">{i.body}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant={i.status === 'new' ? 'primary' : 'secondary'} icon={i.status === 'new' ? <Check className="size-5" /> : <Undo2 className="size-5" />} onClick={() => flip(i)} className="flex-1">
                        {i.status === 'new' ? 'Fait ✅' : 'À refaire'}
                      </Button>
                      <Button size="sm" variant="danger" aria-label="Supprimer l’idée" icon={<Trash2 className="size-5" />} onClick={() => setToDelete(i)} />
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Supprimer cette idée ?">
        <p className="mb-4 text-lg break-words">{toDelete?.body}</p>
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={() => setToDelete(null)}>
            Non
          </Button>
          <Button variant="danger" fullWidth onClick={remove}>
            Supprimer
          </Button>
        </div>
      </Modal>
    </div>
  )
}

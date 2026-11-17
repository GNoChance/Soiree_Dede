import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'framer-motion'
import { ChevronLeft, ChevronRight, Home, Share2, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { victoryConfetti } from '@/components/ui/confetti'
import { getGame } from '@/games/registry'
import { StandingLine } from '@/features/stats/SoireeStandings'
import { fmtDuration } from '@/features/stats/api'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import { toast } from '@/store/toast'
import { useSession } from '@/store/session'
import { fetchRecap, type SoireeRecap } from './api'
import { buildCards, type AwardView, type RecapCard } from './cards'
import { shareRecap } from './share'

const BASE = 'sticker flex w-full flex-1 flex-col items-center justify-center gap-4 overflow-y-auto rounded-bubble p-5 text-center text-[#1f1b2e]'

function Stat({ value, label, emoji, delay }: { value: number | string; label: string; emoji: string; delay: number }) {
  return (
    <motion.div
      initial={{ scale: 0, rotate: -8 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ delay, type: 'spring', stiffness: 280, damping: 14 }}
      className="sticker flex flex-col items-center gap-0.5 rounded-card bg-white px-2 py-3"
    >
      <span className="text-3xl">{emoji}</span>
      <span className="font-display text-3xl font-extrabold leading-none">{typeof value === 'number' ? <AnimatedNumber value={value} /> : value}</span>
      <span className="text-sm font-bold">{label}</span>
    </motion.div>
  )
}

function NumbersCard({ r }: { r: SoireeRecap }) {
  return (
    <div className={cn(BASE, 'bg-sky')}>
      <h2 className="text-4xl leading-tight">La soirée en chiffres</h2>
      <div className="grid w-full grid-cols-2 gap-3">
        <Stat emoji="⏱️" value={fmtDuration(r.duration_min)} label="de bonne humeur" delay={0.1} />
        <Stat emoji="🎲" value={r.games_played} label={r.games_played > 1 ? 'parties' : 'partie'} delay={0.2} />
        <Stat emoji="🕹️" value={r.distinct_games} label={r.distinct_games > 1 ? 'jeux différents' : 'jeu'} delay={0.3} />
        <Stat emoji="🧑‍🤝‍🧑" value={r.players_count} label={r.players_count > 1 ? 'joueurs' : 'joueur'} delay={0.4} />
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {r.players.map((p, i) => (
          <motion.div key={p.profile_id} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 + i * 0.05 }}>
            <Avatar slug={p.slug} tenue={p.equipped_tenue} size={52} />
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function TopGameCard({ r }: { r: SoireeRecap }) {
  const reduce = useReducedMotion()
  const top = r.top_game!
  const g = getGame(top.game_id)
  return (
    <div className={cn(BASE, 'bg-bubblegum')}>
      <h2 className="text-4xl leading-tight">Le jeu de la soirée</h2>
      <motion.div
        className="text-8xl"
        initial={{ scale: 0, rotate: -30 }}
        animate={reduce ? { scale: 1 } : { scale: 1, rotate: [0, -8, 8, 0] }}
        transition={{ type: 'spring', stiffness: 200, damping: 10, rotate: { delay: 0.6, duration: 1.2 } }}
      >
        {g?.emoji ?? '🎲'}
      </motion.div>
      <p className="font-display text-4xl font-extrabold leading-tight">{g?.name ?? top.game_id}</p>
      <p className="text-xl font-bold">
        Joué {top.played} fois : {top.played > 1 ? 'on ne s’en lasse pas !' : 'une seule fois, mais quelle partie !'}
      </p>
    </div>
  )
}

function AwardCard({ v }: { v: AwardView }) {
  return (
    <div className={cn(BASE, v.bg)}>
      <motion.span className="text-6xl" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 9 }}>
        {v.emoji}
      </motion.span>
      <h2 className="text-3xl leading-tight">{v.title}</h2>
      <div className="flex flex-wrap items-end justify-center gap-2">
        {v.who.map((w, i) => (
          <motion.div key={w.profile_id} className="flex flex-col items-center" initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 + i * 0.1, type: 'spring', stiffness: 220, damping: 11 }}>
            <Avatar slug={w.slug} tenue={w.equipped_tenue} size={v.who.length > 2 ? 84 : 120} bounce />
            <span className="max-w-[9rem] truncate font-display text-2xl font-extrabold">{w.nickname}</span>
          </motion.div>
        ))}
      </div>
      {v.sticker && (
        <motion.div initial={{ rotate: -12, scale: 0 }} animate={{ rotate: 6, scale: 1 }} transition={{ delay: 0.6, type: 'spring' }} className="sticker rounded-card bg-white p-1">
          <ChibiImage slug={v.who[0].slug} tenue={v.sticker.tenue} expression={v.sticker.expression} size={96} />
        </motion.div>
      )}
      <motion.p className="sticker rounded-chip bg-white px-4 py-1 font-display text-2xl font-extrabold" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: 'spring', stiffness: 300, damping: 12 }}>
        {v.big}
      </motion.p>
      <p className="text-lg font-bold leading-snug">{v.line}</p>
    </div>
  )
}

function StandingsCard({ r, meId, onShare, busy }: { r: SoireeRecap; meId?: string; onShare: () => void; busy: boolean }) {
  return (
    <div className={cn(BASE, 'justify-start bg-surface text-text')}>
      <h2 className="text-3xl leading-tight">🏆 Classement final</h2>
      <ul className="flex w-full flex-col gap-2">
        {r.standings.map((s, i) => (
          <StandingLine key={s.profile_id} row={s} me={s.profile_id === meId} delay={0.1 + i * 0.06} />
        ))}
      </ul>
      <Button variant="secondary" fullWidth loading={busy} icon={<Share2 className="size-5" />} onClick={onShare}>
        Partager
      </Button>
    </div>
  )
}

function FinalCard({ r, onShare, busy, onDone, doneLabel }: { r: SoireeRecap; onShare: () => void; busy: boolean; onDone: () => void; doneLabel: string }) {
  return (
    <div className={cn(BASE, 'bg-sun')}>
      <div className="flex flex-wrap justify-center -space-x-2">
        {r.players.slice(0, 9).map((p, i) => (
          <motion.div key={p.profile_id} animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 1.4, delay: i * 0.15 }}>
            <Avatar slug={p.slug} tenue={p.equipped_tenue} expression="joie" size={64} />
          </motion.div>
        ))}
      </div>
      <h2 className="text-5xl leading-tight">À la prochaine !</h2>
      <p className="text-xl font-bold">Merci d’avoir joué, rendez-vous à la prochaine soirée. 🎈</p>
      <Button size="lg" fullWidth loading={busy} icon={<Share2 className="size-6" />} onClick={onShare}>
        Partager
      </Button>
      <Button variant="secondary" fullWidth icon={<Home className="size-5" />} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  )
}

/**
 * Récap plein écran façon « Wrapped » : cartes qu'on fait défiler (boutons, flèches clavier, balayage).
 * `recap` fourni -> pas de chargement. Sinon chargé via `soiree_recap` ; en cas d'échec ou de soirée
 * sans partie, `onDone` est appelé aussitôt (on n'embête personne).
 */
export function SoireeRecap({ soireeId, recap, onDone, doneLabel = 'Terminer' }: { soireeId: string; recap?: SoireeRecap; onDone: () => void; doneLabel?: string }) {
  const meId = useSession((s) => s.profile?.id)
  const [data, setData] = useState<SoireeRecap | null>(recap ?? null)
  const [[idx, dir], setPage] = useState<[number, number]>([0, 0])
  const [busy, setBusy] = useState(false)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })

  useEffect(() => {
    if (recap) return
    let alive = true
    fetchRecap(soireeId)
      .then((d) => {
        if (!alive) return
        if (d.games_played === 0) doneRef.current()
        else setData(d)
      })
      .catch(() => {
        if (alive) doneRef.current()
      })
    return () => {
      alive = false
    }
  }, [soireeId, recap])

  const cards: RecapCard[] = data ? buildCards(data) : []
  const last = cards.length - 1
  const go = useCallback(
    (d: 1 | -1) => {
      setPage(([i]) => {
        const n = Math.max(0, Math.min(last, i + d))
        if (n !== i) fx.whoosh()
        return [n, n === i ? 0 : d]
      })
    },
    [last],
  )

  useEffect(() => {
    if (!data) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'Escape') doneRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, go])

  const kind = cards[idx]?.kind
  const awardKey = (cards[idx] as { view?: AwardView } | undefined)?.view?.key
  useEffect(() => {
    if (kind === 'final' || awardKey === 'star') victoryConfetti(1600)
  }, [kind, awardKey])

  if (!data) return null

  const share = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await shareRecap(data)
      if (res === 'downloaded') toast.success('Image enregistrée !')
    } catch {
      toast.error('Impossible de créer l’image. Réessaie !')
    } finally {
      setBusy(false)
    }
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60 || info.velocity.x < -400) go(1)
    else if (info.offset.x > 60 || info.velocity.x > 400) go(-1)
  }

  const card = cards[idx]
  let body: React.ReactNode
  if (card.kind === 'numbers') body = <NumbersCard r={data} />
  else if (card.kind === 'topgame') body = <TopGameCard r={data} />
  else if (card.kind === 'award') body = <AwardCard v={card.view} />
  else if (card.kind === 'standings') body = <StandingsCard r={data} meId={meId} onShare={share} busy={busy} />
  else body = <FinalCard r={data} onShare={share} busy={busy} onDone={() => doneRef.current()} doneLabel={doneLabel} />

  return createPortal(
    <div className="fixed inset-0 z-[67] flex justify-center bg-[#07050f]/80 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Récap de la soirée">
      <div className="flex h-full w-full max-w-md flex-col gap-3 p-3 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {cards.map((_, i) => (
              <span key={i} className={cn('h-2 flex-1 rounded-full border-2 border-ink', i <= idx ? 'bg-sun' : 'bg-white/40')} />
            ))}
          </div>
          <Button variant="secondary" size="sm" icon={<X className="size-5" />} onClick={() => doneRef.current()}>
            Passer
          </Button>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <AnimatePresence mode="popLayout" custom={dir} initial={false}>
            <motion.div
              key={idx}
              custom={dir}
              className="flex min-h-0 flex-1 flex-col pb-2 pr-2"
              variants={{
                enter: (d: number) => ({ x: d * 80, opacity: 0, scale: 0.95 }),
                center: { x: 0, opacity: 1, scale: 1 },
                exit: (d: number) => ({ x: d * -80, opacity: 0, scale: 0.95 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.25}
              onDragEnd={onDragEnd}
            >
              {body}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" aria-label="Carte précédente" disabled={idx === 0} icon={<ChevronLeft className="size-8" />} onClick={() => go(-1)} />
          <Button size="lg" fullWidth disabled={idx === last} onClick={() => go(1)}>
            Suivant <ChevronRight className="size-7" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

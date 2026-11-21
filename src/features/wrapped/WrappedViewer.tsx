import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import { ChevronLeft, ChevronRight, Share2, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Button } from '@/components/ui/Button'
import { victoryConfetti } from '@/components/ui/confetti'
import { getGame } from '@/games/registry'
import { fmtDuration } from '@/features/stats/api'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import { toast } from '@/store/toast'
import { fetchWrapped, type YearWrapped } from './api'
import { shareWrapped } from './image'
import { personalityOf } from './texts'

const BASE = 'sticker flex w-full flex-1 flex-col items-center justify-center gap-4 overflow-y-auto rounded-bubble p-5 text-center text-[#1f1b2e]'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`
const gameOf = (id: string) => getGame(id)

function Big({ children, delay = 0.2 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.p className="sticker rounded-chip bg-white px-4 py-1 font-display text-3xl font-extrabold" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay, type: 'spring', stiffness: 300, damping: 12 }}>
      {children}
    </motion.p>
  )
}

function Stat({ value, label, emoji, delay }: { value: number; label: string; emoji: string; delay: number }) {
  return (
    <motion.div initial={{ scale: 0, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay, type: 'spring', stiffness: 280, damping: 14 }} className="sticker flex flex-col items-center gap-0.5 rounded-card bg-white px-2 py-3">
      <span className="text-3xl">{emoji}</span>
      <span className="font-display text-3xl font-extrabold leading-none">
        <AnimatedNumber value={value} />
      </span>
      <span className="text-sm font-bold">{label}</span>
    </motion.div>
  )
}

function Person({ p, size = 96 }: { p: { slug: string; equipped_tenue: string; nickname: string }; size?: number }) {
  return (
    <div className="flex flex-col items-center">
      <Avatar slug={p.slug} tenue={p.equipped_tenue} size={size} bounce />
      <span className="max-w-[10rem] truncate font-display text-2xl font-extrabold">{p.nickname}</span>
    </div>
  )
}

interface CardDef {
  key: string
  node: ReactNode
}

function buildCards(w: YearWrapped, onShare: () => void, busy: boolean, onClose: () => void): CardDef[] {
  const pers = personalityOf(w.personality.id)
  const cards: CardDef[] = []
  cards.push({
    key: 'intro',
    node: (
      <div className={cn(BASE, 'bg-sun')}>
        <Avatar slug={w.profile.slug} tenue={w.profile.equipped_tenue} expression="joie" size={140} bounce />
        <h2 className="text-5xl leading-tight">Ton année {w.year}</h2>
        <p className="text-xl font-bold">{w.profile.nickname}, voici ce que tu as fait de beau cette année. Prêt·e ? 🎉</p>
      </div>
    ),
  })
  if (w.games_played > 0) {
    cards.push({
      key: 'numbers',
      node: (
        <div className={cn(BASE, 'bg-sky')}>
          <h2 className="text-4xl leading-tight">En chiffres</h2>
          <div className="grid w-full grid-cols-2 gap-3">
            <Stat emoji="🎲" value={w.games_played} label={w.games_played > 1 ? 'parties' : 'partie'} delay={0.1} />
            <Stat emoji="🏆" value={w.wins} label={w.wins > 1 ? 'victoires' : 'victoire'} delay={0.2} />
            <Stat emoji="🎈" value={w.soirees} label={w.soirees > 1 ? 'soirées' : 'soirée'} delay={0.3} />
            <Stat emoji="🕹️" value={w.distinct_games} label={w.distinct_games > 1 ? 'jeux essayés' : 'jeu essayé'} delay={0.4} />
          </div>
          <p className="text-lg font-bold">{w.win_rate} % de victoires. {w.win_rate >= 50 ? 'Respect !' : 'L’important, c’est de participer !'}</p>
        </div>
      ),
    })
    if (w.favorite_game) {
      const g = gameOf(w.favorite_game.game_id)
      const b = w.best_game && gameOf(w.best_game.game_id)
      cards.push({
        key: 'games',
        node: (
          <div className={cn(BASE, 'bg-bubblegum')}>
            <h2 className="text-3xl leading-tight">Ton jeu préféré</h2>
            <span className="text-8xl">{g?.emoji ?? '🎲'}</span>
            <p className="font-display text-4xl font-extrabold leading-tight">{g?.name ?? w.favorite_game.game_id}</p>
            <p className="text-xl font-bold">Joué {w.favorite_game.played} fois. On ne s’en lasse pas !</p>
            {w.best_game && (
              <Big>
                {b?.emoji} Ton meilleur : {b?.name ?? w.best_game.game_id} ({plural(w.best_game.wins, 'victoire')})
              </Big>
            )}
          </div>
        ),
      })
    }
    if (w.longest_soiree || w.latest_match) {
      const lg = w.latest_match && gameOf(w.latest_match.game_id)
      cards.push({
        key: 'soirees',
        node: (
          <div className={cn(BASE, 'bg-lime')}>
            <h2 className="text-3xl leading-tight">Tes soirées</h2>
            {w.longest_soiree && (
              <>
                <span className="text-6xl">⏱️</span>
                <Big>{fmtDuration(w.longest_soiree.minutes)}</Big>
                <p className="text-lg font-bold">C’est ta plus longue soirée, avec {plural(w.longest_soiree.games, 'partie')}. Courage, c’est de l’endurance !</p>
              </>
            )}
            {w.latest_match && (
              <>
                <span className="text-6xl">🌙</span>
                <Big>{w.latest_match.at.replace(':', ' h ')}</Big>
                <p className="text-lg font-bold">Ta partie la plus tardive{lg ? ` (${lg.emoji} ${lg.name})` : ''}. Les lève-tôt n’ont qu’à bien se tenir.</p>
              </>
            )}
          </div>
        ),
      })
    }
    if (w.rival || w.buddy) {
      cards.push({
        key: 'people',
        node: (
          <div className={cn(BASE, 'bg-mint')}>
            {w.buddy && (
              <>
                <h2 className="text-3xl leading-tight">Ton complice</h2>
                <Person p={w.buddy} />
                <p className="text-lg font-bold">{plural(w.buddy.together, 'partie')} ensemble. Les deux font la paire !</p>
              </>
            )}
            {w.rival && (
              <>
                <h2 className="text-3xl leading-tight">Ton rival</h2>
                <Person p={w.rival} size={80} />
                <p className="text-lg font-bold">T’a battu {plural(w.rival.losses, 'fois', 'fois')}. La revanche s’annonce belle ! 😈</p>
              </>
            )}
          </div>
        ),
      })
    }
  }
  if (w.trophies.count > 0 || w.tenues.count > 0) {
    cards.push({
      key: 'collection',
      node: (
        <div className={cn(BASE, 'bg-tangerine')}>
          <h2 className="text-3xl leading-tight">Ta collection</h2>
          {w.trophies.count > 0 && (
            <>
              <span className="text-6xl">🏅</span>
              <Big>{plural(w.trophies.count, 'trophée')}</Big>
              <p className="text-base font-bold">{w.trophies.recent.map((t) => t.name).join(' · ')}</p>
            </>
          )}
          {w.tenues.count > 0 && (
            <>
              <span className="text-6xl">👗</span>
              <Big>{plural(w.tenues.count, 'tenue débloquée', 'tenues débloquées')}</Big>
              <p className="text-base font-bold">{w.tenues.recent.map((t) => `${t.emoji} ${t.label}`).join(' · ')}</p>
            </>
          )}
        </div>
      ),
    })
  }
  if (w.daily.days > 0) {
    cards.push({
      key: 'daily',
      node: (
        <div className={cn(BASE, 'bg-sky')}>
          <h2 className="text-3xl leading-tight">Défi du jour</h2>
          <span className="text-7xl">🗓️</span>
          <Big>🔥 {plural(w.daily.best_streak, 'jour')} d’affilée</Big>
          <p className="text-lg font-bold">Ta plus belle série, sur {plural(w.daily.days, 'défi')} relevés cette année.</p>
        </div>
      ),
    })
  }
  cards.push({
    key: 'personality',
    node: (
      <div className={cn(BASE, 'bg-bubblegum')}>
        <h2 className="text-3xl leading-tight">Cette année, tu es…</h2>
        <motion.span className="text-8xl" initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 9 }}>
          {pers.emoji}
        </motion.span>
        <p className="font-display text-4xl font-extrabold leading-tight">{pers.title}</p>
        <p className="text-lg font-bold leading-snug">{pers.line}</p>
      </div>
    ),
  })
  cards.push({
    key: 'final',
    node: (
      <div className={cn(BASE, 'bg-sun')}>
        <Avatar slug={w.profile.slug} tenue={w.profile.equipped_tenue} expression="joie" size={110} bounce />
        <h2 className="text-4xl leading-tight">Mon année {w.year}</h2>
        <p className="text-xl font-bold">
          {pers.emoji} {pers.title} · {plural(w.games_played, 'partie')} · {plural(w.wins, 'victoire')}
        </p>
        <Button size="lg" fullWidth loading={busy} icon={<Share2 className="size-6" />} onClick={onShare}>
          Partager mon année
        </Button>
        <Button variant="secondary" fullWidth onClick={onClose}>
          Fermer
        </Button>
      </div>
    ),
  })
  return cards
}

/** « Mon année » plein écran : cartes façon story (boutons, flèches clavier, balayage). */
export function WrappedViewer({ year, onClose }: { year: number; onClose: () => void }) {
  const [data, setData] = useState<YearWrapped | null>(null)
  const [failed, setFailed] = useState(false)
  const [[idx, dir], setPage] = useState<[number, number]>([0, 0])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetchWrapped(year)
      .then((d) => alive && setData(d))
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [year])

  useEffect(() => {
    if (failed) {
      toast.error('Impossible de charger ton année. Réessaie !')
      onClose()
    }
  }, [failed, onClose])

  const share = async () => {
    if (busy || !data) return
    setBusy(true)
    try {
      const res = await shareWrapped(data)
      if (res === 'downloaded') toast.success('Image enregistrée !')
    } catch {
      toast.error('Impossible de créer l’image. Réessaie !')
    } finally {
      setBusy(false)
    }
  }

  const cards = data ? buildCards(data, share, busy, onClose) : []
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
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, go, onClose])

  const key = cards[idx]?.key
  useEffect(() => {
    if (key === 'final' || key === 'personality') victoryConfetti(1400)
  }, [key])

  if (!data) return null
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60 || info.velocity.x < -400) go(1)
    else if (info.offset.x > 60 || info.velocity.x > 400) go(-1)
  }

  return createPortal(
    <div className="fixed inset-0 z-[67] flex justify-center bg-[#07050f]/80 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={`Mon année ${year}`}>
      <div className="flex h-full w-full max-w-md flex-col gap-3 p-3 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {cards.map((c, i) => (
              <span key={c.key} className={cn('h-2 flex-1 rounded-full border-2 border-ink', i <= idx ? 'bg-sun' : 'bg-white/40')} />
            ))}
          </div>
          <Button variant="secondary" size="sm" icon={<X className="size-5" />} onClick={onClose}>
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
              {cards[idx]?.node}
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

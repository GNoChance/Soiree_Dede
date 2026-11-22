import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { confettiRain } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { refreshProfile } from '@/lib/auth'
import { toastError } from '@/features/soiree/errors'
import { toast } from '@/store/toast'
import { getTrophy } from '@/data/trophees'
import { openAdventDay, useAdventState } from './api'
import { ADVENT_TEXTS } from './texts'
import { ADVENT_MILESTONES, adventDayItem, getItem, type ItemDef } from '@/data/cadeaux'
import { usePlayersStore } from '@/features/soiree/players'

type CaseStatus = 'opened' | 'ready' | 'today' | 'future' | 'missed'

const pad = (n: number) => String(n).padStart(2, '0')

const SLOT_NAMES: Record<ItemDef['slot'], string> = {
  frame: 'Cadre d’avatar',
  title: 'Titre sous ton pseudo',
  kart: 'Pour Dédé Kart',
  golf_ball: 'Pour le Mini-golf',
  bowling_ball: 'Pour le Bowling',
  chess: 'Pour les Échecs',
}

/** Calendrier de l'Avent : 24 cases, une par jour du 1er au 24 décembre. */
export function AdventPage() {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [version, setVersion] = useState(0)
  const { data, loading } = useAdventState(version)
  const [busy, setBusy] = useState<number | null>(null)
  const [shown, setShown] = useState<{ day: number; xp: number; gifts: string[] } | null>(null)

  const dateOf = (d: number) => `${data?.year}-12-${pad(d)}`
  const statusOf = (d: number): CaseStatus => {
    if (!data) return 'future'
    const date = dateOf(d)
    if (data.opened.includes(date)) return 'opened'
    if (data.done.includes(date)) return 'ready'
    if (date > data.today) return 'future'
    return date === data.today ? 'today' : 'missed'
  }

  const tap = async (d: number) => {
    const st = statusOf(d)
    if (st === 'opened') return setShown({ day: d, xp: 0, gifts: [] })
    if (st === 'future') return void toast('Pas touche ! Cette case s’ouvrira le jour J.')
    if (st === 'missed') return void toast('Trop tard : il fallait finir le défi ce jour-là. Pas de rattrapage !')
    if (st === 'today') return void toast('Finis le défi du jour pour ouvrir la case !')
    setBusy(d)
    try {
      const r = await openAdventDay(dateOf(d))
      fx.fanfare()
      if (!reduce) confettiRain(1800)
      setShown({ day: d, xp: r.xp, gifts: r.gifts ?? [] })
      if (r.gifts?.length) void usePlayersStore.getState().load(true)
      setVersion((v) => v + 1)
      void refreshProfile().catch(() => undefined)
      if (r.trophy) toast.success(`Trophée « ${getTrophy('gen_esprit_noel')?.name ?? 'Esprit de Noël'} » : tu as débloqué la tenue Lutin ! 🧝`)
    } catch (e) {
      toastError(e)
      setVersion((v) => v + 1)
    } finally {
      setBusy(null)
    }
  }

  const openedCount = data?.opened.length ?? 0
  const readyCount = data?.done.filter((x) => !data.opened.includes(x)).length ?? 0
  const text = shown ? ADVENT_TEXTS[shown.day - 1] : null

  return (
    <div className="flex flex-col gap-4 pb-8">
      <button type="button" onClick={() => navigate(-1)} className="flex min-h-12 items-center gap-2 self-start font-extrabold">
        <ArrowLeft className="size-6" /> Retour
      </button>
      <h1 className="text-4xl">🎄 Calendrier de l’Avent</h1>
      <Card className="flex flex-col gap-1 text-[#1f1b2e]" accent="var(--color-mint)">
        <p className="font-extrabold">Termine le défi du jour pour ouvrir la case du jour : +25 XP, une surprise et un cadeau !</p>
        <p className="text-sm font-bold">
          {openedCount} case{openedCount > 1 ? 's' : ''} ouverte{openedCount > 1 ? 's' : ''} sur 24
          {readyCount > 0 && ` · ${readyCount} à ouvrir !`} · 12 cases = une tenue secrète 🧝
        </p>
      </Card>
      <Card className="flex flex-col gap-2">
        <p className="font-display text-lg font-extrabold">🎁 Gros cadeaux</p>
        <div className="grid grid-cols-4 gap-2">
          {ADVENT_MILESTONES.map((m) => {
            const got = openedCount >= m.count
            return (
              <div
                key={m.count}
                className={
                  'flex flex-col items-center gap-0.5 rounded-card border-[3px] border-ink p-1.5 text-center ' +
                  (got ? 'bg-mint text-[#1f1b2e]' : 'bg-sunk')
                }
              >
                <span className="text-2xl leading-none">{m.items.map((i) => i.emoji).join('')}</span>
                <span className="text-[0.65rem] leading-tight font-extrabold">{m.items[0].label}</span>
                <span className="text-xs font-extrabold">{got ? '✓' : `${Math.min(openedCount, m.count)}/${m.count}`}</span>
              </div>
            )
          })}
        </div>
        <p className="text-xs font-bold text-muted">Comptés en cases ouvertes. Cadres, titres et objets s’équipent dans Inventaire › Déco.</p>
      </Card>
      {loading && !data ? (
        <p className="text-center font-bold text-muted">Chargement…</p>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 24 }, (_, i) => i + 1).map((d) => {
            const st = statusOf(d)
            const t = ADVENT_TEXTS[d - 1]
            return (
              <motion.button
                key={d}
                type="button"
                disabled={busy !== null}
                onClick={() => void tap(d)}
                aria-label={`Case ${d}`}
                whileTap={{ scale: 0.92 }}
                animate={st === 'ready' && !reduce ? { rotate: [-3, 3, -3] } : { rotate: 0 }}
                transition={st === 'ready' ? { repeat: Infinity, duration: 1.2 } : undefined}
                className={
                  'sticker-sm flex aspect-square flex-col items-center justify-center rounded-card border-[3px] border-ink font-display font-extrabold text-[#1f1b2e] ' +
                  (st === 'opened' ? 'bg-mint' : st === 'ready' ? 'bg-sun' : st === 'today' ? 'bg-white' : st === 'missed' ? 'bg-sunk text-muted opacity-60' : 'bg-white')
                }
              >
                <span className="text-xs leading-none">{d}</span>
                <span className="text-2xl leading-none">
                  {st === 'opened' ? t.emoji : st === 'ready' ? '🎁' : st === 'missed' ? '✖️' : st === 'today' ? '🎄' : '🔒'}
                </span>
                {st !== 'missed' && adventDayItem(d) && (
                  <span aria-hidden className={'mt-0.5 text-xs leading-none' + (st === 'opened' ? '' : ' opacity-60')}>
                    {adventDayItem(d)!.slot === 'title' ? '🏷️' : '🖼️'}
                  </span>
                )}
              </motion.button>
            )
          })}
        </div>
      )}
      <Button variant="secondary" fullWidth onClick={() => navigate('/defi')}>
        Aller au défi du jour
      </Button>

      <Modal open={Boolean(shown)} onClose={() => setShown(null)} title={shown ? `Case n° ${shown.day}` : undefined}>
        {shown && text && (
          <div className="flex flex-col items-center gap-4 text-center">
            <motion.div
              initial={reduce ? false : { scale: 0, rotate: -40 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 9 }}
              className="text-7xl"
            >
              {text.emoji}
            </motion.div>
            <p className="text-lg font-bold">{text.text}</p>
            {shown.xp > 0 && <p className="rounded-chip border-2 border-ink bg-sun px-3 py-1 font-display font-extrabold text-[#1f1b2e]">+{shown.xp} XP</p>}
            {(() => {
              const gifts = (shown.gifts.length ? shown.gifts.map(getItem) : [adventDayItem(shown.day)]).filter(Boolean) as ItemDef[]
              if (!gifts.length) return null
              return (
                <div className="flex w-full flex-col gap-2">
                  <p className="font-display font-extrabold">{shown.gifts.length ? (gifts.length > 1 ? 'Tes cadeaux :' : 'Ton cadeau :') : 'Cadeau de cette case :'}</p>
                  {gifts.map((g, i) => (
                    <motion.div
                      key={g.id}
                      initial={reduce ? false : { scale: 0, rotate: 12 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 10, delay: 0.3 + i * 0.15 }}
                      className="sticker-sm flex items-center gap-3 rounded-card border-[3px] border-ink bg-mint p-2 text-left text-[#1f1b2e]"
                    >
                      <span className="text-3xl leading-none">{g.emoji}</span>
                      <span className="flex flex-col">
                        <span className="font-extrabold">{g.label}</span>
                        <span className="text-xs font-bold">{SLOT_NAMES[g.slot]}</span>
                      </span>
                    </motion.div>
                  ))}
                  {shown.gifts.length > 0 && (
                    <Button variant="secondary" fullWidth onClick={() => navigate('/inventaire?onglet=deco')}>
                      Équiper mes cadeaux
                    </Button>
                  )}
                </div>
              )
            })()}
            <Button fullWidth onClick={() => setShown(null)}>
              Merci Père Noël !
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}

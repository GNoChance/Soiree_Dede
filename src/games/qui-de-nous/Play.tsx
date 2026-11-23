import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Eye, FastForward, Trophy } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { burst } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { QuiDeNousState } from '@/types/db'
import { AuthorBadge } from '@/features/cartes/AuthorBadge'
import { DropCard, VoterStrip } from '@/features/soiree/components'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { GamePlayProps, PlayerInfo } from '../types'
import { qdnActions } from './setup'
import { hash01, NextIn, useDeadlineTick } from './autoTick'

/** Champs ajoutés par le serveur (absents des vieilles parties). */
type QdnS = QuiDeNousState & { deadline?: string | null }

function isVoteSecret(v: unknown): v is { round: number; target: string } {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.round === 'number' && typeof o.target === 'string'
}

export default function QuiDeNousPlay({ state, secret, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as QdnS
  const get = (id: string) => playerOrPlaceholder(players, id)
  useDeadlineTick(s.phase === 'voting' || s.phase === 'reveal' ? s.deadline : null, act)

  return (
    <div className="flex flex-col gap-4 pb-6">
      {s.phase === 'voting' && <Voting s={s} secret={secret} meId={meId} isHost={isHost} get={get} players={players} act={act} pending={pending} />}
      {s.phase === 'reveal' && s.last_reveal && (
        <Reveal key={s.last_reveal.round} s={s} meId={meId} isHost={isHost} get={get} act={act} pending={pending} />
      )}
      <Scores s={s} meId={meId} get={get} />
    </div>
  )
}

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']

/* -------------------------------------------------------------------------- */
/* Vote                                                                        */
/* -------------------------------------------------------------------------- */

function Voting({ s, secret, meId, isHost, get, players, act, pending }: { s: QdnS; secret: unknown; meId: string; isHost: boolean; get: Get; players: Record<string, PlayerInfo>; act: ActFn; pending: boolean }) {
  const [myVote, setMyVote] = useState<{ round: number; target: string } | null>(null)
  const stored = isVoteSecret(secret) && secret.round === s.round ? secret.target : null
  const chosen = myVote?.round === s.round ? myVote.target : stored
  const isPlayer = s.players.includes(meId)
  const iVoted = s.voters.includes(meId)
  const targets = s.players.filter((id) => id !== meId)
  const allVoted = s.voters.length >= s.players.length

  const vote = async (target: string) => {
    if (target === chosen) return
    const prev = myVote
    setMyVote({ round: s.round, target })
    fx.pop()
    const res = await act(qdnActions.vote(target))
    if (!res) setMyVote(prev)
  }

  return (
    <>
      <DropCard k={s.round} accent="var(--color-sun)" className="text-[#1f1b2e]">
        <Badge tone="neutral" className="mb-2">
          Question {s.round}/{s.total_rounds}
        </Badge>
        <p className="font-display text-[1.7rem] leading-tight font-extrabold">{s.question}</p>
        <AuthorBadge by={(s as { question_by?: string | null }).question_by} className="mt-2" />
      </DropCard>

      {isPlayer ? (
        <>
          <p className="text-center font-display text-lg font-extrabold">
            {chosen ? 'Tu peux encore changer d’avis…' : iVoted ? 'Vote enregistré ✓' : 'Touche un joueur pour voter'}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {targets.map((id, i) => {
              const p = get(id)
              const sel = chosen === id
              return (
                <motion.button
                  key={id}
                  type="button"
                  initial={{ scale: 0, rotate: -15 }}
                  animate={{ scale: sel ? 1.08 : 1, rotate: sel ? -3 : 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 14, delay: myVote ? 0 : 0.25 + i * 0.04 }}
                  whileTap={{ scale: 0.88 }}
                  onClick={() => void vote(id)}
                  disabled={pending && !sel}
                  className={cn(
                    'sticker flex flex-col items-center gap-1 p-2 transition-colors',
                    sel ? 'bg-mint text-[#1f1b2e]' : 'bg-surface',
                    chosen && !sel && 'opacity-60',
                  )}
                  aria-pressed={sel}
                >
                  <Avatar slug={p.slug} expression={sel ? mood(p, 'shocked') : p.equipped} size={64} />
                  <span className="max-w-full truncate font-display text-base font-extrabold">{p.nickname}</span>
                </motion.button>
              )
            })}
          </div>
        </>
      ) : (
        <p className="text-center font-bold text-muted">Tu regardes cette partie : les joueurs votent…</p>
      )}

      <VoterStrip ids={s.players} voters={s.voters} players={players} />
      <NextIn deadline={s.deadline} label="Révélation dans" />

      {isHost && (
        <Button variant={allVoted ? 'primary' : 'secondary'} fullWidth loading={pending} icon={<Eye className="size-5" />} onClick={() => void act(qdnActions.reveal())}>
          {s.voters.length === 0 ? 'Révéler (personne n’a voté)' : 'Révéler maintenant'}
        </Button>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Dépouillement                                                               */
/* -------------------------------------------------------------------------- */

function Reveal({ s, meId, isHost, get, act, pending }: { s: QdnS; meId: string; isHost: boolean; get: Get; act: ActFn; pending: boolean }) {
  const lr = s.last_reveal!
  const reduce = useReducedMotion()

  // Ordre de dépouillement : d'abord les joueurs les moins désignés, la majorité en dernier (suspense).
  // Calculé une seule fois par manche (le composant est remonté à chaque manche).
  const [sequence] = useState(() =>
    Object.entries(lr.votes)
      .map(([voter, target]) => ({ voter, target, w: (lr.counts[target] ?? 0) + hash01(`${lr.round}:${voter}`) * 0.5 }))
      .sort((a, b) => a.w - b.w),
  )

  const [step, setStep] = useState(reduce ? sequence.length : 0)
  const done = step >= sequence.length

  useEffect(() => {
    if (done) return
    const delay = step === 0 ? 900 : Math.max(380, 900 - step * 70)
    const t = window.setTimeout(() => {
      setStep((n) => n + 1)
      fx.tick()
    }, delay)
    return () => clearTimeout(t)
  }, [step, done])

  const celebrated = useRef(false)
  useEffect(() => {
    if (!done || celebrated.current) return
    celebrated.current = true
    if (lr.majority.length) {
      fx.fanfare()
      burst({ x: 0.5, y: 0.35 }, 120)
    }
    if (lr.scorers.includes(meId)) window.setTimeout(() => fx.success(), 700)
  }, [done, lr, meId])

  const counts: Record<string, number> = {}
  for (const v of sequence.slice(0, step)) counts[v.target] = (counts[v.target] ?? 0) + 1
  const max = Math.max(1, ...Object.values(lr.counts))
  const rows = done ? [...s.players].sort((a, b) => (lr.counts[b] ?? 0) - (lr.counts[a] ?? 0)) : s.players
  const current = !done && step > 0 ? sequence[step - 1] : null
  const myVote = lr.votes[meId]
  const scored = lr.scorers.includes(meId)
  const last = s.round >= s.total_rounds

  return (
    <>
      <div className="sticker bg-sun p-4 text-center text-[#1f1b2e]">
        <p className="font-display text-xl leading-tight font-extrabold">{lr.question}</p>
        <AuthorBadge by={(s as { question_by?: string | null }).question_by} className="mt-2" />
      </div>

      {/* Vote en cours de dépouillement */}
      <div className="flex h-14 items-center justify-center">
        <AnimatePresence mode="popLayout">
          {current ? (
            <motion.div
              key={step}
              initial={{ y: -40, scale: 0.4, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 50, scale: 0.6, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}
              className="sticker-sm flex items-center gap-2 bg-surface px-3 py-1"
            >
              <Avatar slug={get(current.voter).slug} size={36} />
              <span className="font-display font-extrabold">{get(current.voter).nickname}</span>
              <ArrowRight className="size-5" strokeWidth={3} />
              <Avatar slug={get(current.target).slug} expression={mood(get(current.target), 'shocked')} size={36} />
            </motion.div>
          ) : !done ? (
            <motion.p key="wait" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1 }} className="font-display text-xl font-extrabold">
              Dépouillement…
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Le(s) plus désigné(s) */}
      <AnimatePresence>
        {done && (
          <motion.div
            initial={{ scale: 0, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 12 }}
            className="sticker flex flex-col items-center gap-1 bg-bubblegum p-4 text-[#1f1b2e]"
          >
            {lr.majority.length ? (
              <>
                <p className="font-display text-lg font-extrabold">{lr.majority.length > 1 ? 'Égalité ! Les plus désignés :' : 'Le plus désigné :'}</p>
                <div className="flex flex-wrap justify-center gap-3">
                  {lr.majority.map((id, i) => (
                    <motion.div key={id} className="flex flex-col items-center" animate={reduce ? undefined : { y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.15 }}>
                      <ChibiImage slug={get(id).slug} expression={i % 2 ? mood(get(id), 'shy') : mood(get(id), 'shocked')} size={lr.majority.length > 2 ? 90 : 130} />
                      <span className="font-display text-2xl font-extrabold">{get(id).nickname}</span>
                      <Badge tone="neutral">{lr.counts[id]} vote{lr.counts[id] > 1 ? 's' : ''}</Badge>
                    </motion.div>
                  ))}
                </div>
              </>
            ) : (
              <p className="font-display text-xl font-extrabold">{Object.keys(lr.votes).length ? 'Pas de majorité ! ⚖️' : 'Personne n’a voté ! 🦗'}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Barres */}
      <LayoutGroup>
        <div className="sticker flex flex-col gap-2 bg-surface p-3">
          {rows.map((id) => {
            const p = get(id)
            const c = done ? (lr.counts[id] ?? 0) : (counts[id] ?? 0)
            const isMaj = done && lr.majority.includes(id)
            return (
              <motion.div layout key={id} className="flex items-center gap-2" transition={{ type: 'spring', stiffness: 300, damping: 26 }}>
                <Avatar slug={p.slug} expression={isMaj ? mood(p, 'shocked') : p.equipped} size={36} />
                <span className="w-16 truncate font-display text-sm font-extrabold">{p.nickname}</span>
                <div className="relative h-7 flex-1 overflow-hidden rounded-full border-2 border-ink bg-sunk">
                  <motion.div
                    className={cn('h-full rounded-full', isMaj ? 'bg-tomato' : 'bg-sky')}
                    animate={{ width: `${(c / max) * 100}%` }}
                    transition={{ type: 'spring', stiffness: 200, damping: 18 }}
                  />
                </div>
                <motion.span key={c} initial={{ scale: 2 }} animate={{ scale: 1 }} className="w-6 text-right font-display text-lg font-extrabold">
                  {c}
                </motion.span>
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>

      {!done && (
        <button type="button" className="mx-auto flex items-center gap-1 font-display font-extrabold text-muted underline" onClick={() => setStep(sequence.length)}>
          <FastForward className="size-4" /> Passer l’animation
        </button>
      )}

      {done && s.players.includes(meId) && (
        <motion.div
          initial={{ scale: 0, y: 30 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 400, damping: 12 }}
          className={cn('sticker p-3 text-center font-display text-xl font-extrabold', scored ? 'bg-mint text-[#1f1b2e]' : 'bg-sunk')}
        >
          {scored ? (
            <>
              <motion.span initial={{ scale: 3 }} animate={{ scale: 1 }} transition={{ delay: 0.7 }} className="inline-block text-3xl">
                +1
              </motion.span>{' '}
              Tu as voté avec la majorité !
            </>
          ) : myVote ? (
            `Raté… tu avais choisi ${get(myVote).nickname}`
          ) : (
            'Tu n’as pas voté cette fois !'
          )}
        </motion.div>
      )}

      {/* Qui a voté pour qui */}
      {done && Object.keys(lr.votes).length > 0 && (
        <details className="sticker bg-surface p-3">
          <summary className="cursor-pointer font-display font-extrabold">Qui a voté pour qui ?</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {Object.entries(lr.votes).map(([voter, target]) => (
              <li key={voter} className="flex items-center gap-2">
                <Avatar slug={get(voter).slug} size={28} />
                <span className="font-bold">{get(voter).nickname}</span>
                <ArrowRight className="size-4" />
                <Avatar slug={get(target).slug} size={28} />
                <span className="font-bold">{get(target).nickname}</span>
                {lr.scorers.includes(voter) && <Badge tone="mint">+1</Badge>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {isHost && (
        <Button size="lg" fullWidth loading={pending} disabled={!done} icon={last ? <Trophy className="size-6" /> : <ArrowRight className="size-6" />} onClick={() => void act(qdnActions.next())}>
          {last ? 'Voir les résultats' : 'Question suivante'}
        </Button>
      )}
      {done && <NextIn deadline={s.deadline} label={last ? 'Résultats dans' : 'Question suivante dans'} />}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Scores cumulés                                                              */
/* -------------------------------------------------------------------------- */

function Scores({ s, meId, get }: { s: QuiDeNousState; meId: string; get: Get }) {
  const sorted = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0))
  return (
    <div className="sticker bg-sunk p-3">
      <p className="mb-2 flex items-center gap-1.5 font-display font-extrabold">
        <Trophy className="size-4" /> Scores
      </p>
      <LayoutGroup>
        <div className="flex flex-wrap gap-2">
          {sorted.map((id) => {
            const p = get(id)
            const sc = s.scores[id] ?? 0
            return (
              <motion.div layout key={id} className={cn('sticker-sm flex items-center gap-1.5 bg-surface py-0.5 pr-2.5 pl-0.5', id === meId && 'ring-2 ring-sun')}>
                <Avatar slug={p.slug} size={28} />
                <span className="text-sm font-bold">{p.nickname}</span>
                <motion.span key={sc} initial={{ scale: 2.2, color: '#06D6A0' }} animate={{ scale: 1, color: 'var(--text)' }} className="font-display font-extrabold">
                  {sc}
                </motion.span>
              </motion.div>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}

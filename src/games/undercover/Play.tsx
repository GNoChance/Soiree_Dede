import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Fingerprint, Gavel, Mic, Send, Skull, Vote } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { BottomSheet } from '@/components/ui/Modal'
import { burst } from '@/components/ui/confetti'
import { fx, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { UndercoverSecret, UndercoverState } from '@/types/db'
import { ConfirmModal, VoterStrip } from '@/features/soiree/components'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import { ROLE_INFO, ucActions } from './setup'
import { NextIn, useDeadlineTick } from '../qui-de-nous/autoTick'

/** Champs ajoutés par le serveur (absents des vieilles parties). */
type UcS = UndercoverState & { deadline?: string | null; vote_unlock?: string | null }

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']

export default function UndercoverPlay({ matchId, state, secret, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as UcS
  useDeadlineTick(s.phase === 'vote' || s.phase === 'elimination' || s.phase === 'mrwhite_guess' ? s.deadline : null, act)
  const sec = secret as UndercoverSecret | null
  const get = (id: string) => playerOrPlaceholder(players, id)
  const isPlayer = s.players.includes(meId)
  const alive = s.alive.includes(meId)
  const [wordOpen, setWordOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="mint" tilted={false}>{s.setup.civils} civil{s.setup.civils > 1 ? 's' : ''}</Badge>
        <Badge tone="tomato" tilted={false}>{s.setup.undercovers} undercover{s.setup.undercovers > 1 ? 's' : ''}</Badge>
        {s.setup.mister_white && <Badge tone="neutral" tilted={false}>1 Mister White</Badge>}
      </div>

      {isPlayer && !alive && s.phase !== 'mrwhite_guess' && (
        <div className="sticker flex items-center gap-2 bg-sunk p-3">
          <Skull className="size-6 shrink-0" />
          <p className="font-bold">Tu es éliminé·e : tu restes spectateur·rice. Chut, pas d’indices !</p>
        </div>
      )}

      {s.phase === 'describe' && (
        <>
          {isPlayer && s.round === 1 && <SecretCard secret={sec} big />}
          <Describe s={s} get={get} meId={meId} isHost={isHost} act={act} pending={pending} />
        </>
      )}
      {s.phase === 'vote' && <VotePhase s={s} get={get} meId={meId} isHost={isHost} players={players} act={act} pending={pending} />}
      {(s.phase === 'elimination' || s.phase === 'mrwhite_guess') && s.current_elimination && (
        <Elimination key={`${s.current_elimination.round}-${s.current_elimination.profile_id}`} matchId={matchId} s={s} get={get} meId={meId} isHost={isHost} act={act} pending={pending} />
      )}

      {isPlayer && !(s.phase === 'describe' && s.round === 1) && (
        <Button variant="secondary" fullWidth icon={<Fingerprint className="size-5" />} onClick={() => setWordOpen(true)}>
          Revoir mon mot
        </Button>
      )}
      <BottomSheet open={wordOpen} onClose={() => setWordOpen(false)} title="Mon mot secret">
        <SecretCard secret={sec} />
      </BottomSheet>

      <Graveyard s={s} get={get} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Carte secrète : maintenir appuyé pour voir                                  */
/* -------------------------------------------------------------------------- */

function SecretCard({ secret, big }: { secret: UndercoverSecret | null; big?: boolean }) {
  const [shown, setShown] = useState(false)
  const show = (v: boolean) => {
    if (v && !shown) {
      fx.whoosh()
      vibrate(15)
    }
    setShown(v)
  }
  const isMrWhite = secret?.role === 'mrwhite'
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn('w-full touch-none select-none [perspective:1000px]', big ? 'h-56' : 'h-44')}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          show(true)
        }}
        onPointerUp={() => show(false)}
        onPointerCancel={() => show(false)}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && show(true)}
        onKeyUp={() => show(false)}
        onBlur={() => show(false)}
        role="button"
        tabIndex={0}
        aria-label="Maintenir appuyé pour voir ton mot"
      >
        <motion.div className="relative size-full [transform-style:preserve-3d]" animate={{ rotateY: shown ? 180 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }}>
          <div className="sticker absolute inset-0 flex flex-col items-center justify-center gap-2 bg-grape text-white [backface-visibility:hidden]">
            <motion.div animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>
              <Fingerprint className="size-16" strokeWidth={1.8} />
            </motion.div>
            <p className="font-display text-xl font-extrabold">Maintiens appuyé pour voir ton mot</p>
            <p className="text-sm opacity-80">Cache bien ton écran 👀</p>
          </div>
          <div className="sticker absolute inset-0 flex [transform:rotateY(180deg)] flex-col items-center justify-center gap-1 bg-sun p-3 text-center text-[#1f1b2e] [backface-visibility:hidden]">
            {!secret ? (
              <p className="font-display text-xl font-extrabold">Chargement du mot…</p>
            ) : isMrWhite ? (
              <>
                <span className="text-5xl">🤫</span>
                <p className="font-display text-3xl font-extrabold">Tu es Mister White</p>
                <p className="text-sm font-bold">Tu n’as pas de mot : écoute les autres et bluffe !</p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold uppercase">Ton mot</p>
                <p className="font-display text-5xl font-extrabold break-words">{secret.word}</p>
              </>
            )}
          </div>
        </motion.div>
      </div>
      {!isMrWhite && secret && <p className="text-center text-sm text-muted">Civil ou undercover ? Personne ne sait… même pas toi !</p>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Description                                                                 */
/* -------------------------------------------------------------------------- */

function speakingOrder(s: UndercoverState): string[] {
  const alive = s.order.filter((id) => s.alive.includes(id))
  const i = Math.max(0, alive.indexOf(s.starter))
  return [...alive.slice(i), ...alive.slice(0, i)]
}

function Describe({ s, get, meId, isHost, act, pending }: { s: UcS; get: Get; meId: string; isHost: boolean; act: ActFn; pending: boolean }) {
  const order = speakingOrder(s)
  const reduce = useReducedMotion()
  const unlockLeft = useCountdown(s.vote_unlock)
  const canStart = isHost || (s.alive.includes(meId) && unlockLeft <= 0)
  return (
    <>
      <div className="sticker flex items-center gap-3 bg-sky p-3 text-[#1f1b2e]">
        <Mic className="size-8 shrink-0" />
        <p className="font-display text-lg leading-tight font-extrabold">Chacun son tour, décrivez votre mot à l’oral en un mot ou une courte phrase.</p>
      </div>
      <ol className="flex flex-col gap-2">
        {order.map((id, i) => {
          const p = get(id)
          const first = i === 0
          return (
            <motion.li
              key={id}
              initial={{ x: i % 2 ? 80 : -80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: i * 0.08, type: 'spring', stiffness: 300, damping: 20 }}
              className={cn('sticker flex items-center gap-3 p-2 pr-3', first ? 'bg-sun text-[#1f1b2e]' : 'bg-surface', id === meId && !first && 'ring-2 ring-grape')}
            >
              <span className="w-7 text-center font-display text-2xl font-extrabold">{i + 1}</span>
              <motion.div animate={first && !reduce ? { scale: [1, 1.12, 1], rotate: [0, -4, 4, 0] } : undefined} transition={{ repeat: Infinity, duration: 1.2 }}>
                <Avatar slug={p.slug} expression={first ? mood(p, 'think') : p.equipped} size={first ? 56 : 44} />
              </motion.div>
              <span className="flex-1 font-display text-lg font-extrabold">
                {p.nickname}
                {id === meId && ' (toi)'}
              </span>
              {first && <Badge tone="tomato">Commence !</Badge>}
            </motion.li>
          )
        })}
      </ol>
      {canStart ? (
        <Button size="lg" fullWidth loading={pending} icon={<Vote className="size-6" />} onClick={() => void act(ucActions.startVote())}>
          Tout le monde a parlé : au vote !
        </Button>
      ) : (
        <p className="text-center font-bold text-muted">
          L’hôte lancera le vote quand tout le monde aura parlé.
          {s.vote_unlock && unlockLeft > 0 && <> Sinon, tu pourras le lancer dans {Math.ceil(unlockLeft / 1000)} s.</>}
        </p>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Vote                                                                        */
/* -------------------------------------------------------------------------- */

function VotePhase({ s, get, meId, isHost, players, act, pending }: { s: UcS; get: Get; meId: string; isHost: boolean; players: Record<string, PlayerInfo>; act: ActFn; pending: boolean }) {
  const key = `${s.round}-${s.revote ? 'r' : 'v'}`
  const [myVote, setMyVote] = useState<{ key: string; target: string } | null>(null)
  const chosen = myVote?.key === key ? myVote.target : null
  const alive = s.alive.includes(meId)
  const iVoted = s.voters.includes(meId)
  const [confirmClose, setConfirmClose] = useState(false)
  const allVoted = s.voters.length >= s.alive.length

  const vote = async (target: string) => {
    if (target === chosen) return
    const prev = myVote
    setMyVote({ key, target })
    fx.pop()
    if (!(await act(ucActions.vote(target)))) setMyVote(prev)
  }

  return (
    <>
      <AnimatePresence>
        {s.revote && (
          <motion.div initial={{ scale: 0, rotate: 10 }} animate={{ scale: 1, rotate: -2 }} className="sticker bg-tangerine p-3 text-center text-[#1f1b2e]">
            <p className="font-display text-2xl font-extrabold">Égalité ! ⚖️</p>
            <p className="font-bold">Revote entre {s.candidates.map((id) => get(id).nickname).join(' et ')}. Nouvelle égalité = tirage au sort !</p>
          </motion.div>
        )}
      </AnimatePresence>
      <h2 className="text-center text-3xl">Qui est l’infiltré ? 🔎</h2>
      {alive ? (
        <>
          <p className="text-center font-bold text-muted">{chosen ? 'Tu peux changer d’avis tant que le vote est ouvert.' : iVoted ? 'Vote enregistré ✓' : 'Touche le joueur à éliminer'}</p>
          <div className="grid grid-cols-3 gap-3">
            {s.candidates
              .filter((id) => id !== meId)
              .map((id, i) => {
                const p = get(id)
                const sel = chosen === id
                return (
                  <motion.button
                    key={id}
                    type="button"
                    initial={{ scale: 0 }}
                    animate={{ scale: sel ? 1.08 : 1, rotate: sel ? 3 : 0 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 14, delay: myVote ? 0 : i * 0.05 }}
                    whileTap={{ scale: 0.88 }}
                    onClick={() => void vote(id)}
                    disabled={pending && !sel}
                    aria-pressed={sel}
                    className={cn('sticker flex flex-col items-center gap-1 p-2', sel ? 'bg-tomato text-white' : 'bg-surface', chosen && !sel && 'opacity-60')}
                  >
                    <Avatar slug={p.slug} expression={sel ? mood(p, 'shocked') : p.equipped} size={64} />
                    <span className="max-w-full truncate font-display font-extrabold">{p.nickname}</span>
                  </motion.button>
                )
              })}
          </div>
        </>
      ) : (
        <p className="text-center font-bold text-muted">Les survivants votent…</p>
      )}
      <VoterStrip ids={s.alive} voters={s.voters} players={players} />
      <NextIn deadline={s.deadline} label="Dépouillement dans" />
      {isHost && (
        <>
          <Button variant={allVoted ? 'primary' : 'secondary'} fullWidth loading={pending} icon={<Gavel className="size-5" />} onClick={() => (allVoted ? void act(ucActions.closeVote()) : setConfirmClose(true))}>
            Clore le vote
          </Button>
          <ConfirmModal
            open={confirmClose}
            onClose={() => setConfirmClose(false)}
            title="Clore le vote ?"
            confirmLabel="Dépouiller"
            onConfirm={() => {
              setConfirmClose(false)
              void act(ucActions.closeVote())
            }}
          >
            {s.voters.length}/{s.alive.length} joueurs ont voté. On dépouille avec les votes reçus ?
          </ConfirmModal>
        </>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Élimination (roulement de tambour + carte qui se retourne)                  */
/* -------------------------------------------------------------------------- */

function seenKey(matchId: string) {
  return `dede:uc-seen:${matchId}`
}
function wasSeen(matchId: string, k: string) {
  try {
    return (JSON.parse(sessionStorage.getItem(seenKey(matchId)) ?? '[]') as string[]).includes(k)
  } catch {
    return false
  }
}
function markSeen(matchId: string, k: string) {
  try {
    const list = JSON.parse(sessionStorage.getItem(seenKey(matchId)) ?? '[]') as string[]
    sessionStorage.setItem(seenKey(matchId), JSON.stringify([...list, k]))
  } catch {
    /* ignore */
  }
}

function Elimination({ matchId, s, get, meId, isHost, act, pending }: { matchId: string; s: UcS; get: Get; meId: string; isHost: boolean; act: ActFn; pending: boolean }) {
  const elim = s.current_elimination!
  const p = get(elim.profile_id)
  const reduce = useReducedMotion()
  const k = `${elim.round}-${elim.profile_id}`
  // 0 = tambour, 1 = nom, 2 = rôle révélé
  const [stage, setStage] = useState(() => (reduce || wasSeen(matchId, k) ? 2 : 0))
  const role = ROLE_INFO[elim.role]
  const infiltrator = elim.role !== 'civil'

  useEffect(() => {
    if (stage === 2) {
      markSeen(matchId, k)
      return
    }
    const timers: number[] = []
    if (stage === 0) {
      // Roulement de tambour qui accélère
      let t = 0
      for (let i = 0; i < 14; i++) {
        t += Math.max(60, 260 - i * 16)
        timers.push(window.setTimeout(() => fx.tick(), t))
      }
      timers.push(window.setTimeout(() => {
        setStage(1)
        fx.whoosh()
        vibrate(40)
      }, t + 200))
    } else {
      timers.push(window.setTimeout(() => {
        setStage(2)
        if (infiltrator) {
          fx.fanfare()
          burst({ x: 0.5, y: 0.4 }, 130)
        } else fx.fail()
      }, 1400))
    }
    return () => timers.forEach(clearTimeout)
  }, [stage, infiltrator, matchId, k])

  const counts = s.last_vote?.counts ?? {}
  const votesFor = counts[elim.profile_id] ?? 0

  return (
    <>
      <div className="flex min-h-[22rem] flex-col items-center justify-center gap-3">
        <AnimatePresence mode="wait">
          {stage === 0 ? (
            <motion.div key="drum" className="flex flex-col items-center gap-3" exit={{ scale: 0, opacity: 0 }}>
              <motion.span className="text-8xl" animate={reduce ? undefined : { rotate: [-10, 10], y: [0, -6] }} transition={{ repeat: Infinity, repeatType: 'mirror', duration: 0.12 }}>
                🥁
              </motion.span>
              <p className="font-display text-2xl font-extrabold">Le village a décidé…</p>
            </motion.div>
          ) : (
            <motion.div key="who" className="flex flex-col items-center gap-2" initial={{ scale: 0.2, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 12 }}>
              <ChibiImage slug={p.slug} expression={stage === 2 ? (infiltrator ? mood(p, 'sly') : mood(p, 'sad')) : mood(p, 'shocked')} size={140} />
              <p className="font-display text-3xl font-extrabold">{p.nickname} est éliminé·e !</p>
              {s.last_vote && (
                <p className="text-sm font-bold text-muted">
                  {s.last_vote.outcome === 'random' ? 'Encore égalité : tiré au sort 🎲' : `${votesFor} vote${votesFor > 1 ? 's' : ''} contre lui/elle`}
                </p>
              )}
              <div className="h-32 w-64 [perspective:900px]">
                <motion.div className="relative size-full [transform-style:preserve-3d]" animate={{ rotateY: stage === 2 ? 180 : 0 }} transition={{ type: 'spring', stiffness: 140, damping: 14 }}>
                  <div className="sticker absolute inset-0 flex items-center justify-center bg-ink text-5xl text-white [backface-visibility:hidden]">❓</div>
                  <div className={cn('sticker absolute inset-0 flex [transform:rotateY(180deg)] flex-col items-center justify-center [backface-visibility:hidden]', role.bg)}>
                    <span className="text-4xl">{role.emoji}</span>
                    <span className="font-display text-3xl font-extrabold">{role.label}</span>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {stage === 2 && s.phase === 'mrwhite_guess' && <MrWhiteGuess s={s} get={get} meId={meId} isHost={isHost} act={act} pending={pending} />}

      {stage === 2 && s.phase === 'elimination' && (
        <>
          {s.mrwhite_guess && s.mrwhite_guess.profile_id === elim.profile_id && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="sticker bg-sunk p-3 text-center font-bold">
              {s.mrwhite_guess.word ? `Mister White a proposé « ${s.mrwhite_guess.word} »… raté ! ❌` : 'Mister White n’a pas répondu. ❌'}
            </motion.div>
          )}
          <NextIn deadline={s.deadline} />
          {isHost && (
            <Button size="lg" fullWidth loading={pending} icon={<ArrowRight className="size-6" />} onClick={() => void act(ucActions.next())}>
              Continuer maintenant
            </Button>
          )}
        </>
      )}
    </>
  )
}

function MrWhiteGuess({ s, get, meId, isHost, act, pending }: { s: UcS; get: Get; meId: string; isHost: boolean; act: ActFn; pending: boolean }) {
  const elimId = s.current_elimination!.profile_id
  const mine = elimId === meId
  const [word, setWord] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (mine) inputRef.current?.focus()
  }, [mine])

  if (mine) {
    return (
      <form
        className="sticker flex flex-col gap-3 bg-white p-4 text-[#1f1b2e]"
        onSubmit={(e) => {
          e.preventDefault()
          if (word.trim()) void act(ucActions.guess(word))
        }}
      >
        <p className="font-display text-xl font-extrabold">Dernière chance ! Quel est le mot des civils ?</p>
        <NextIn deadline={s.deadline} label="Temps restant :" className="font-bold text-muted" />
        <input
          ref={inputRef}
          value={word}
          onChange={(e) => setWord(e.target.value)}
          maxLength={60}
          autoComplete="off"
          placeholder="Ton mot…"
          className="sticker-sm h-14 bg-sunk px-3 font-display text-2xl font-extrabold text-text outline-none"
        />
        <Button type="submit" size="lg" fullWidth loading={pending} disabled={!word.trim()} icon={<Send className="size-5" />}>
          Deviner
        </Button>
      </form>
    )
  }
  return (
    <>
      <motion.div className="sticker bg-white p-3 text-center text-[#1f1b2e]" animate={{ rotate: [-1, 1, -1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
        <p className="font-display text-xl font-extrabold">{get(elimId).nickname} tente de deviner le mot des civils… 🤞</p>
        <p className="text-sm font-bold">S’il trouve, il gagne tout seul !</p>
        <NextIn deadline={s.deadline} label="Temps restant :" className="text-sm font-bold" />
      </motion.div>
      {isHost && (
        <Button variant="secondary" fullWidth loading={pending} onClick={() => void act(ucActions.skipGuess())}>
          Il/elle ne répond pas
        </Button>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Éliminés                                                                    */
/* -------------------------------------------------------------------------- */

function Graveyard({ s, get }: { s: UndercoverState; get: Get }) {
  if (!s.eliminated.length) return null
  return (
    <div className="sticker bg-sunk p-3">
      <p className="mb-2 font-display font-extrabold">Éliminés</p>
      <div className="flex flex-wrap gap-2">
        {s.eliminated.map((e) => {
          const p = get(e.profile_id)
          return (
            <div key={e.profile_id} className="sticker-sm flex items-center gap-1.5 bg-surface py-0.5 pr-2 pl-0.5 grayscale-[0.5]">
              <Avatar slug={p.slug} expression={mood(p, 'sad')} size={28} />
              <span className="text-sm font-bold">{p.nickname}</span>
              <span title={ROLE_INFO[e.role].label}>{ROLE_INFO[e.role].emoji}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

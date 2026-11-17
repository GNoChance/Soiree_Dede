import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, Eye, EyeOff, SkipForward, Timer } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Button } from '@/components/ui/Button'
import { burst, confettiRain } from '@/components/ui/confetti'
import { supabase } from '@/lib/supabase'
import { fx, playSound, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { useWakeLock } from '@/lib/wakeLock'
import { ConfirmModal } from '@/features/soiree/components'
import { pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps, PlayerInfo } from '../types'
import { ROUND_RULES, TEAMS, TEAM_META, other, plural, teamActions } from './setup'
import type { Team, TeamSecret, TeamState, WordKind } from './types'

type Get = (id: string) => PlayerInfo
type ActFn = GamePlayProps['act']
type Role = 'speaker' | 'watcher' | 'teammate' | 'spectator'

/* -------------------------------------------------------------------------- */
/* Hooks                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Mon secret le plus frais pour le passage courant. Le prop `secret` (Realtime)
 * suffit d'habitude ; on relit quand même à chaque carte (filet de sécurité).
 * Un secret d'un autre passage, ou d'une carte déjà dépassée, est ignoré.
 */
function useTeamSecret(matchId: string, s: TeamState, propSecret: unknown) {
  const [fetched, setFetched] = useState<TeamSecret | null>(null)
  const reqId = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++reqId.current
    const { data, error } = await supabase.from('match_secrets').select('secret').eq('match_id', matchId).maybeSingle()
    if (id !== reqId.current || error) return
    setFetched((data?.secret as unknown as TeamSecret | null) ?? null)
  }, [matchId])
  useEffect(() => {
    if (s.phase === 'playing') void refresh()
  }, [refresh, s.phase, s.turn_no, s.card_no])
  const cands = [fetched, propSecret as TeamSecret | null].filter(
    (x): x is TeamSecret => Boolean(x) && x!.turn_no === s.turn_no && (x!.role === 'teammate' || x!.card_no >= s.card_no),
  )
  cands.sort((a, b) => b.card_no - a.card_no)
  return cands[0] ?? null
}

/** Envoie `tick` à l'échéance (orateur d'abord, puis l'hôte, puis les autres ; relance toutes les 3 s). */
function useAutoTick(s: TeamState, act: ActFn, meId: string, isHost: boolean) {
  const target = s.phase === 'playing' && s.deadline ? new Date(s.deadline).getTime() : null
  const role = s.speaker === meId ? 0 : isHost ? 1 : 2
  const actRef = useRef(act)
  useEffect(() => {
    actRef.current = act
  })
  useEffect(() => {
    if (target == null) return
    const delay = role === 0 ? 150 : role === 1 ? 600 : 1500 + Math.random() * 1500
    let timer = 0
    const fire = () => {
      void actRef.current(teamActions.tick())
      timer = window.setTimeout(fire, 3000 + Math.random() * 1000)
    }
    timer = window.setTimeout(fire, Math.max(0, target - serverNow()) + delay)
    return () => clearTimeout(timer)
  }, [target, role])
}

/* -------------------------------------------------------------------------- */
/* Écran principal                                                             */
/* -------------------------------------------------------------------------- */

export default function TeamPlay({ matchId, state, secret: propSecret, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as TeamState
  const get: Get = (id) => playerOrPlaceholder(players, id)
  const myTeam: Team | null = s.teams.red.includes(meId) ? 'red' : s.teams.blue.includes(meId) ? 'blue' : null
  const role: Role = s.speaker === meId ? 'speaker' : !myTeam ? 'spectator' : myTeam === s.team ? 'teammate' : 'watcher'
  const secret = useTeamSecret(matchId, s, propSecret)
  const [confirmSkip, setConfirmSkip] = useState(false)

  useAutoTick(s, act, meId, isHost)
  useWakeLock(s.phase === 'ready' || s.phase === 'playing')

  // Fin de passage / de manche : petit buzzer.
  const prevPhase = useRef(s.phase)
  useEffect(() => {
    const was = prevPhase.current
    prevPhase.current = s.phase
    if (was === 'playing' && s.phase === 'ready') {
      playSound('fail')
      vibrate([80, 40, 80])
    }
    if (s.phase === 'round_end' && was !== 'round_end') {
      fx.fanfare()
      confettiRain(2200)
    }
  }, [s.phase])

  // C'est à moi : on secoue le téléphone.
  useEffect(() => {
    if (s.phase === 'ready' && s.speaker === meId) vibrate([40, 60, 40, 60, 120])
  }, [s.phase, s.speaker, s.turn_no, meId])

  return (
    <div className="flex flex-col gap-3 pb-6">
      <ScoreBar s={s} get={get} meId={meId} />

      <AnimatePresence mode="wait">
        {s.phase === 'ready' && (
          <motion.div key={`ready-${s.turn_no}`} initial={{ opacity: 0, y: 40, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: -60 }}>
            <ReadyScreen s={s} get={get} role={role} pending={pending} onGo={() => void act(teamActions.ready())} />
          </motion.div>
        )}
        {s.phase === 'playing' && (
          <motion.div key={`play-${s.turn_no}`} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: 40 }}>
            <PlayingScreen s={s} get={get} role={role} secret={secret} act={act} />
          </motion.div>
        )}
        {s.phase === 'round_end' && (
          <motion.div key={`end-${s.round}`} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}>
            <RoundEnd s={s} get={get} isHost={isHost} pending={pending} onNext={() => void act(teamActions.nextRound())} />
          </motion.div>
        )}
        {s.phase === 'finished' && (
          <motion.p key="fin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-10 text-center font-display text-2xl font-extrabold">
            🏁 Partie terminée !
          </motion.p>
        )}
      </AnimatePresence>

      {isHost && (s.phase === 'ready' || s.phase === 'playing') && (
        <>
          <Button variant="secondary" size="sm" fullWidth icon={<SkipForward className="size-5" />} onClick={() => setConfirmSkip(true)}>
            Sauter ce passage
          </Button>
          <ConfirmModal
            open={confirmSkip}
            onClose={() => setConfirmSkip(false)}
            title="Sauter ce passage ?"
            confirmLabel="Sauter"
            loading={pending}
            onConfirm={async () => {
              await act(teamActions.skipTurn())
              setConfirmSkip(false)
            }}
          >
            La main passe à l’autre équipe. La carte en cours retourne dans la pioche.
          </ConfirmModal>
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Tableau des scores (haut d'écran)                                           */
/* -------------------------------------------------------------------------- */

function ScoreBar({ s, get, meId }: { s: TeamState; get: Get; meId: string }) {
  const reduce = useReducedMotion()
  const live = s.phase === 'ready' || s.phase === 'playing'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-2">
        {TEAMS.map((t) => {
          const meta = TEAM_META[t]
          const active = live && s.team === t
          return (
            <motion.div
              key={t}
              animate={{ scale: active ? 1.03 : 0.96, rotate: active ? (t === 'red' ? -1.5 : 1.5) : 0, opacity: live && !active ? 0.75 : 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 16 }}
              className="sticker relative flex flex-col gap-1 overflow-hidden rounded-card p-2"
              style={{ backgroundColor: meta.color, color: meta.text }}
            >
              {active && !reduce && (
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-white"
                  animate={{ opacity: [0, 0.18, 0] }}
                  transition={{ repeat: Infinity, duration: 1.6 }}
                />
              )}
              <div className="flex items-center justify-between gap-1">
                <span className="truncate font-display text-base font-extrabold">
                  {meta.emoji} {meta.short}
                </span>
                <AnimatedNumber value={s.scores[t]} className="font-display text-3xl leading-none font-extrabold" duration={0.6} />
              </div>
              <div className="flex -space-x-2">
                {s.teams[t].map((id) => {
                  const p = get(id)
                  const speaking = live && s.speaker === id
                  return (
                    <motion.div
                      key={id}
                      animate={speaking && !reduce ? { y: [0, -5, 0] } : { y: 0 }}
                      transition={speaking ? { repeat: Infinity, duration: 0.8 } : undefined}
                      className={cn('rounded-full', id === meId && 'ring-2 ring-white', speaking && 'z-10')}
                    >
                      <Avatar slug={p.slug} tenue={p.equippedTenue} size={speaking ? 34 : 28} />
                    </motion.div>
                  )
                })}
              </div>
            </motion.div>
          )
        })}
      </div>
      {s.phase !== 'finished' && (
        <p className="text-center text-sm font-bold text-muted">
          🃏 {plural(s.pile_left, 'carte')} dans la pioche · {ROUND_RULES[s.round]?.emoji} {ROUND_RULES[s.round]?.short}
        </p>
      )}
    </div>
  )
}

function TeamBadge({ team, className }: { team: Team; className?: string }) {
  const meta = TEAM_META[team]
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-chip border-2 border-ink px-2 py-0.5 font-display text-sm font-extrabold', className)}
      style={{ backgroundColor: meta.color, color: meta.text }}
    >
      {meta.emoji} {meta.label}
    </span>
  )
}

function RuleCard({ round, compact }: { round: number; compact?: boolean }) {
  const r = ROUND_RULES[round]
  if (!r) return null
  return (
    <div className={cn('sticker-sm flex items-center gap-3 rounded-card bg-surface', compact ? 'p-2' : 'p-3')}>
      <motion.span
        className={compact ? 'text-3xl' : 'text-5xl'}
        animate={{ rotate: [0, -12, 12, 0] }}
        transition={{ repeat: Infinity, duration: 2.4, repeatDelay: 1 }}
      >
        {r.emoji}
      </motion.span>
      <div className="min-w-0">
        <p className="font-display text-lg leading-tight font-extrabold">
          Manche {round} · {r.name}
        </p>
        {!compact && <p className="text-sm leading-snug">{r.rule}</p>}
        {compact && <p className="text-sm text-muted">{r.short}</p>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Écran « Au tour de X — prêt ? »                                             */
/* -------------------------------------------------------------------------- */

function ReadyScreen({ s, get, role, pending, onGo }: { s: TeamState; get: Get; role: Role; pending: boolean; onGo: () => void }) {
  const reduce = useReducedMotion()
  const sp = get(s.speaker)
  const meta = TEAM_META[s.team]
  const recap = s.last_turn && s.last_turn.turn_no === s.turn_no - 1 && s.last_turn.reason !== 'empty' ? s.last_turn : null
  return (
    <div className="flex flex-col gap-3">
      {recap && <PassageRecapCard recap={recap} get={get} />}

      <div className="sticker flex flex-col items-center gap-2 rounded-bubble p-5 text-center" style={{ backgroundColor: meta.color, color: meta.text }}>
        <p className="font-display text-xl font-extrabold opacity-90">{role === 'speaker' ? 'C’est à toi !' : 'Au tour de'}</p>
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 11 }}
        >
          <motion.div animate={reduce ? undefined : { y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 1.4 }}>
            <Avatar slug={sp.slug} tenue={sp.equippedTenue} expression={pickExpression(sp, 'gamer', 'cool', 'joie')} size={130} />
          </motion.div>
        </motion.div>
        <p className="font-display text-4xl leading-none font-extrabold">{sp.nickname}</p>
        <span className="rounded-chip border-2 border-ink bg-white px-3 py-0.5 font-display text-base font-extrabold text-[#1f1b2e]">
          {meta.emoji} {meta.label}
        </span>
        <p className="flex items-center gap-1 font-bold">
          <Timer className="size-5" /> {s.budget} s{s.carried ? ' (temps conservé de la manche précédente)' : ''}
        </p>
      </div>

      <RuleCard round={s.round} />

      {role === 'speaker' ? (
        <>
          <p className="text-center text-sm font-bold text-muted">Ton équipe devine, les adversaires voient le mot pour surveiller. Mets-toi face à ton équipe !</p>
          <motion.div animate={reduce ? undefined : { scale: [1, 1.04, 1] }} transition={{ repeat: Infinity, duration: 1.1 }}>
            <Button size="lg" fullWidth loading={pending} onClick={onGo} className="min-h-24 text-4xl" style={{ backgroundColor: meta.color, color: meta.text }}>
              C’est parti !
            </Button>
          </motion.div>
        </>
      ) : (
        <p className="text-center font-display text-xl font-extrabold">
          {role === 'teammate' && '🧠 Prépare-toi à deviner !'}
          {role === 'watcher' && '🕵️ Tu verras le mot : surveille la triche !'}
          {role === 'spectator' && '🍿 Installe-toi, ça va bouger.'}
          <span className="mt-1 block text-sm font-bold text-muted">{sp.nickname} lance le chrono quand il est prêt.</span>
        </p>
      )}
    </div>
  )
}

function PassageRecapCard({ recap, get }: { recap: NonNullable<TeamState['last_turn']>; get: Get }) {
  const p = get(recap.speaker)
  const n = recap.found.length
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6, rotate: -4 }}
      animate={{ opacity: 1, scale: 1, rotate: -1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 14 }}
      className="sticker-sm flex flex-col gap-1.5 rounded-card bg-surface p-3"
    >
      <div className="flex items-center gap-2">
        <Avatar slug={p.slug} tenue={p.equippedTenue} expression={pickExpression(p, n >= 3 ? 'cool' : 'pleurs', 'joie')} size={40} />
        <p className="font-display text-base leading-tight font-extrabold">
          {recap.reason === 'skip' ? `Passage de ${p.nickname} sauté` : `⏰ Temps écoulé ! ${p.nickname} a fait deviner ${plural(n, 'mot')}`}
          {recap.passed > 0 && <span className="text-muted"> · {plural(recap.passed, 'passe')}</span>}
        </p>
      </div>
      {n > 0 && <WordChips words={recap.found} team={recap.team} />}
    </motion.div>
  )
}

function WordChips({ words, team }: { words: string[]; team: Team }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <AnimatePresence initial={false}>
        {words.map((w, i) => (
          <motion.span
            key={`${i}-${w}`}
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: i % 2 ? 2 : -2 }}
            transition={{ type: 'spring', stiffness: 420, damping: 14 }}
            className="rounded-chip border-2 border-ink px-2 py-0.5 text-sm font-extrabold"
            style={{ backgroundColor: TEAM_META[team].soft, color: '#1f1b2e' }}
          >
            ✓ {w}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Passage en cours                                                            */
/* -------------------------------------------------------------------------- */

const KIND_LABEL: Record<WordKind, string> = { perso: '👤 Personnage', objet: '🎯 Mot' }

function PlayingScreen({ s, get, role, secret, act }: { s: TeamState; get: Get; role: Role; secret: TeamSecret | null; act: ActFn }) {
  const ms = useCountdown(s.deadline, 100)
  const secs = Math.ceil(ms / 1000)
  const sp = get(s.speaker)
  const meta = TEAM_META[s.team]

  // Bips des 5 dernières secondes.
  useEffect(() => {
    if (secs > 0 && secs <= 5) fx.tick()
  }, [secs])

  // Mot trouvé : son + confettis côté équipe qui joue.
  const prevFound = useRef(s.turn_found)
  useEffect(() => {
    if (s.turn_found > prevFound.current) {
      if (role === 'speaker' || role === 'teammate') {
        fx.success()
        burst({ x: 0.5, y: 0.45 }, 40)
      } else fx.pop()
    }
    prevFound.current = s.turn_found
  }, [s.turn_found, role])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <CountdownRing ms={ms} total={s.budget * 1000} color={meta.color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Avatar slug={sp.slug} tenue={sp.equippedTenue} expression={pickExpression(sp, 'gamer', 'cool', 'joie')} size={40} />
            <p className="truncate font-display text-lg leading-tight font-extrabold">{role === 'speaker' ? 'Tu fais deviner' : `${sp.nickname} fait deviner`}</p>
          </div>
          <TeamBadge team={s.team} className="mt-1" />
          <p className="mt-1 font-display text-base font-extrabold">
            ✓ <AnimatedNumber value={s.turn_found} duration={0.3} /> trouvé{s.turn_found > 1 ? 's' : ''}
            {s.turn_passed > 0 && <span className="text-muted"> · ⏭ {s.turn_passed}</span>}
          </p>
        </div>
      </div>

      {role === 'speaker' && <SpeakerPanel s={s} secret={secret} act={act} ms={ms} />}
      {role === 'watcher' && <WatcherPanel s={s} secret={secret} speaker={sp} />}
      {(role === 'teammate' || role === 'spectator') && <GuesserPanel s={s} speaker={sp} spectator={role === 'spectator'} />}

      {s.turn_words.length > 0 && <WordChips words={s.turn_words} team={s.team} />}
    </div>
  )
}

function CountdownRing({ ms, total, color }: { ms: number; total: number; color: string }) {
  const reduce = useReducedMotion()
  const frac = total > 0 ? Math.max(0, Math.min(1, ms / total)) : 0
  const secs = Math.ceil(ms / 1000)
  const urgent = secs <= 5
  const R = 42
  const C = 2 * Math.PI * R
  return (
    <motion.div
      className="relative size-28 shrink-0"
      animate={urgent && !reduce ? { rotate: [0, -6, 6, 0], scale: [1, 1.08, 1] } : { rotate: 0, scale: 1 }}
      transition={urgent ? { repeat: Infinity, duration: 0.5 } : undefined}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="var(--surface)" stroke="var(--ink)" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={urgent ? '#ef476f' : color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 0.1s linear' }}
        />
      </svg>
      <span className={cn('absolute inset-0 flex items-center justify-center font-display text-4xl font-extrabold', urgent && 'text-tomato')}>{secs}</span>
    </motion.div>
  )
}

function WordCard({ word, kind, accent, k, small }: { word: string | null; kind?: WordKind | null; accent: string; k: string | number; small?: boolean }) {
  return (
    <div className="relative" style={{ perspective: 800 }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={k}
          initial={{ rotateY: -90, opacity: 0, scale: 0.8 }}
          animate={{ rotateY: 0, opacity: 1, scale: 1 }}
          exit={{ x: 160, rotate: 18, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
          className={cn('sticker flex flex-col items-center justify-center gap-1 rounded-bubble bg-white px-4 text-center text-[#1f1b2e]', small ? 'min-h-28 py-3' : 'min-h-44 py-5')}
          style={{ borderColor: accent, boxShadow: `6px 6px 0 0 ${accent}` }}
        >
          {kind && <span className="text-sm font-extrabold tracking-wide text-[#6b6480] uppercase">{KIND_LABEL[kind]}</span>}
          <span className={cn('font-display leading-tight font-extrabold break-words', small ? 'text-3xl' : 'text-5xl')}>{word ?? '…'}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function SpeakerPanel({ s, secret, act, ms }: { s: TeamState; secret: TeamSecret | null; act: ActFn; ms: number }) {
  const meta = TEAM_META[s.team]
  // Carte affichée : secret frais, ou carte suivante optimiste (affichage instantané).
  const [opt, setOpt] = useState<{ turn_no: number; card_no: number; word: string | null; kind: WordKind | null } | null>(null)
  const lastSent = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const fresh = secret && secret.role === 'speaker' && secret.card_no >= s.card_no ? secret : null
  let shown: { card_no: number; word: string | null; kind: WordKind | null } | null = fresh
    ? { card_no: fresh.card_no, word: fresh.word, kind: fresh.kind ?? null }
    : null
  if (opt && opt.turn_no === s.turn_no && (!shown || opt.card_no > shown.card_no)) shown = opt
  const canAct = Boolean(shown?.word) && ms > 0

  const send = (type: 'found' | 'pass') => {
    if (!shown?.word) return
    const idx = shown.card_no
    if (idx <= lastSent.current) return
    lastSent.current = idx
    const known = fresh && fresh.card_no === idx ? fresh : null
    const nextWord = known ? (type === 'found' ? (known.next_word ?? null) : (known.next_word ?? known.word)) : null
    const nextKind = known ? (type === 'found' ? (known.next_kind ?? null) : (known.next_word ? (known.next_kind ?? null) : (known.kind ?? null))) : null
    setOpt({ turn_no: s.turn_no, card_no: idx + 1, word: nextWord, kind: nextKind })
    if (type === 'found') {
      vibrate(25)
    } else {
      fx.whoosh()
    }
    // Envois en série : l'ordre des cartes compte.
    queue.current = queue.current.then(async () => {
      const r = await act(type === 'found' ? teamActions.found(idx) : teamActions.pass(idx))
      if (!r) {
        // Échec (réseau…) : on revient à la carte confirmée par le serveur.
        lastSent.current = Math.min(lastSent.current, idx - 1)
        setOpt(null)
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <WordCard word={shown?.word ?? null} kind={shown?.kind} accent={meta.color} k={shown?.card_no ?? 'none'} />
      <p className="text-center text-sm font-bold text-muted">
        {ROUND_RULES[s.round]?.emoji} {ROUND_RULES[s.round]?.short}
      </p>
      <motion.button
        type="button"
        disabled={!canAct}
        onClick={() => send('found')}
        whileTap={canAct ? { scale: 0.94, y: 4 } : undefined}
        className="sticker flex min-h-32 w-full select-none items-center justify-center gap-3 rounded-bubble bg-mint font-display text-5xl font-extrabold text-[#1f1b2e] disabled:opacity-50"
      >
        <Check className="size-12" strokeWidth={4} /> Trouvé
      </motion.button>
      <motion.button
        type="button"
        disabled={!canAct}
        onClick={() => send('pass')}
        whileTap={canAct ? { scale: 0.94, y: 4 } : undefined}
        className="sticker flex min-h-20 w-full select-none items-center justify-center gap-2 rounded-bubble bg-surface font-display text-3xl font-extrabold disabled:opacity-50"
      >
        <SkipForward className="size-8" strokeWidth={3} /> Passer
      </motion.button>
      <p className="text-center text-xs text-muted">« Passer » remet la carte en fin de pioche.</p>
    </div>
  )
}

function WatcherPanel({ s, secret, speaker }: { s: TeamState; secret: TeamSecret | null; speaker: PlayerInfo }) {
  const word = secret?.role === 'watcher' ? secret.word : null
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center justify-center gap-2 text-center font-display text-lg font-extrabold">
        <Eye className="size-5" /> Surveille {speaker.nickname} !
      </p>
      <WordCard word={word} kind={secret?.kind} accent={TEAM_META[other(s.team)].color} k={secret?.card_no ?? 'none'} small />
      <p className="text-center text-sm font-bold text-muted">
        Ne le dis surtout pas ! S’il triche ({ROUND_RULES[s.round]?.short.toLowerCase()}), criez-le à l’hôte.
      </p>
    </div>
  )
}

function GuesserPanel({ s, speaker, spectator }: { s: TeamState; speaker: PlayerInfo; spectator: boolean }) {
  const reduce = useReducedMotion()
  return (
    <div className="sticker flex flex-col items-center gap-2 rounded-bubble p-5 text-center" style={{ backgroundColor: TEAM_META[s.team].soft, color: '#1f1b2e' }}>
      <motion.div animate={reduce ? undefined : { rotate: [-6, 6, -6], y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.9 }}>
        <Avatar slug={speaker.slug} tenue={speaker.equippedTenue} expression={pickExpression(speaker, 'surprise', 'gamer', 'joie')} size={110} />
      </motion.div>
      <p className="font-display text-4xl font-extrabold">{spectator ? 'Ça joue !' : 'Devine !'}</p>
      <p className="flex items-center gap-1 text-sm font-bold">
        <EyeOff className="size-4" /> {spectator ? 'Le mot reste caché pour toi.' : `Écoute ${speaker.nickname} et crie tes réponses !`}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Entre deux manches                                                          */
/* -------------------------------------------------------------------------- */

function RoundEnd({ s, get, isHost, pending, onNext }: { s: TeamState; get: Get; isHost: boolean; pending: boolean; onNext: () => void }) {
  const lead: Team | null = s.scores.red === s.scores.blue ? null : s.scores.red > s.scores.blue ? 'red' : 'blue'
  const next = s.round + 1
  const sp = get(s.speaker)
  const done = useMemo(() => s.round_scores.slice(0, s.round), [s.round_scores, s.round])
  return (
    <div className="flex flex-col gap-3">
      <motion.h2
        initial={{ scale: 2, rotate: -10, opacity: 0 }}
        animate={{ scale: 1, rotate: -2, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 12 }}
        className="text-center text-3xl"
      >
        Fin de la manche {s.round} ! 🎉
      </motion.h2>

      <div className="grid grid-cols-2 gap-2">
        {TEAMS.map((t, i) => {
          const meta = TEAM_META[t]
          return (
            <motion.div
              key={t}
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1, scale: lead === t ? 1.06 : 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.2 + i * 0.15 }}
              className="sticker flex flex-col items-center gap-1 rounded-bubble p-3"
              style={{ backgroundColor: meta.color, color: meta.text }}
            >
              <span className="font-display text-lg font-extrabold">
                {meta.emoji} {meta.short} {lead === t && '👑'}
              </span>
              <AnimatedNumber value={s.scores[t]} className="font-display text-6xl leading-none font-extrabold" duration={1.4} />
              <div className="flex flex-col items-center text-sm font-bold">
                {done.map((r, k) => (
                  <motion.span key={k} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 + k * 0.2 }}>
                    M{k + 1} {ROUND_RULES[k + 1]?.emoji} +{r[t]}
                  </motion.span>
                ))}
              </div>
            </motion.div>
          )
        })}
      </div>
      <p className="text-center font-display text-lg font-extrabold">
        {lead ? `Les ${TEAM_META[lead].short} mènent de ${Math.abs(s.scores.red - s.scores.blue)} !` : 'Égalité parfaite, tout se joue maintenant !'}
      </p>

      <motion.div initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ delay: 1.1, type: 'spring', stiffness: 200, damping: 16 }}>
        <p className="mb-1 text-center text-sm font-extrabold tracking-wide text-muted uppercase">Manche suivante</p>
        <RuleCard round={next} />
      </motion.div>

      <div className="sticker-sm flex items-center gap-2 rounded-card bg-surface p-2">
        <Avatar slug={sp.slug} tenue={sp.equippedTenue} size={40} />
        <p className="text-sm font-bold">
          {s.carry_seconds
            ? `${sp.nickname} reprend la main avec les ${s.carry_seconds} s qui lui restaient.`
            : `${sp.nickname} (${TEAM_META[s.team].short}) ouvrira la manche.`}
        </p>
      </div>

      {isHost ? (
        <Button size="lg" fullWidth loading={pending} onClick={onNext}>
          Lancer la manche {next} {ROUND_RULES[next]?.emoji}
        </Button>
      ) : (
        <p className="text-center text-sm font-bold text-muted">L’hôte lance la manche suivante…</p>
      )}
    </div>
  )
}

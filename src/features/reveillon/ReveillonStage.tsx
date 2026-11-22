import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Flag, Play, RotateCw, Square } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { burst, victoryConfetti } from '@/components/ui/confetti'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import { toast } from '@/store/toast'
import { getGame } from '@/games/registry'
import type { PlayerInfo } from '@/games/types'
import type { NewUnlocks } from '@/types/db'
import { CheckableToken, ConfirmModal } from '@/features/soiree/components'
import { GameWheel } from '@/features/soiree/GameWheel'
import type { WheelSpin } from '@/features/soiree/hostTools'
import { refetchActiveSoirees } from '@/features/soiree/hooks'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { errorCode, toastError } from '@/features/soiree/errors'
import { serverNow } from '@/features/soiree/useServerClock'
import { compatibleGameIds, launchReveillon, nextReveillon, rerollReveillon, reveillonStandings, stopReveillon, type Scenario, type ReveillonStanding } from './api'
import { challengeParts, getChallenge, getTheme, type ReveillonTheme } from './themes'

type ById = Record<string, PlayerInfo>
const INK_TEXT = 'text-[#1f1b2e]'
const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

/**
 * Salon en mode Réveillon / soirée scénarisée : bannière du thème, manche en cours (tirage,
 * partie, défi surprise, classement final) et classement spécial. Remplace le panneau de
 * lancement de l'hôte et la carte d'attente des joueurs tant que le scénario est en cours.
 */
export function ReveillonStage({ soireeId, scenario: sc, isHost, meId, playerIds, byId, busy, onStarted, onEnded }: {
  soireeId: string
  scenario: Scenario
  isHost: boolean
  meId: string
  playerIds: string[]
  byId: ById
  /** Une partie est en cours / en train de démarrer. */
  busy: boolean
  onStarted: (matchId: string, gameId: string) => void
  /** L'hôte a terminé la soirée (podium puis récap, comme « Terminer la soirée »). */
  onEnded: (unlocks: NewUnlocks) => void
}) {
  const theme = getTheme(sc.theme)
  const game = getGame(sc.game_id)
  const n = playerIds.length
  const compatible = Boolean(game) && n >= (game?.minPlayers ?? 99) && n <= (game?.maxPlayers ?? 0)
  const [action, setAction] = useState<'launch' | 'reroll' | 'next' | 'stop' | 'end' | null>(null)
  const [confirm, setConfirm] = useState<'stop' | 'end' | null>(null)
  const standings = useMemo(() => reveillonStandings(sc, playerIds), [sc, playerIds])

  // Roue : à chaque nouveau tirage (ou à l'arrivée juste après un tirage), tout le monde la voit tourner.
  const [seenDraw, setSeenDraw] = useState<number>(() => (sc.phase === 'draw' && sc.drawn_at && serverNow() - Date.parse(sc.drawn_at) < 20_000 ? -1 : sc.draw))
  const [wheel, setWheel] = useState<WheelSpin | null>(null)
  if (sc.draw !== seenDraw) {
    setSeenDraw(sc.draw)
    if (sc.phase === 'draw') setWheel({ id: sc.draw, game_ids: sc.pool?.length ? sc.pool : [sc.game_id], result: sc.game_id })
  } else if (wheel && sc.phase !== 'draw') setWheel(null) // partie lancée : la roue ne revient pas après une annulation
  // Défi surprise : s'ouvre en grand à chaque fin de manche (y compris en revenant au salon).
  const [dismissed, setDismissed] = useState<number | null>(null)
  const showChallenge = sc.phase === 'challenge' && dismissed !== sc.round

  const run = async (kind: NonNullable<typeof action>, fn: () => Promise<{ error: unknown }>) => {
    setAction(kind)
    try {
      const { error } = await fn()
      if (error) {
        toastError(error)
        if (errorCode(error) === 'soiree_ended') void refetchActiveSoirees()
        return false
      }
      return true
    } catch (e) {
      toastError(e)
      return false
    } finally {
      setAction(null)
    }
  }

  const launch = async () => {
    if (!game) return toast.error('Jeu inconnu : change de jeu.')
    if (!compatible) return toast.error(`${game.name} se joue de ${game.minPlayers} à ${game.maxPlayers} joueurs : change de jeu.`)
    await run('launch', async () => {
      const opts = game.defaultOptions ?? {}
      const prepared = game.prepareStart ? await game.prepareStart(opts, { playerIds }) : { ...opts }
      const { matchId, error } = await launchReveillon(soireeId, prepared)
      if (!error && matchId) onStarted(matchId, game.id)
      return { error }
    })
  }
  const reroll = () => {
    fx.whoosh()
    void run('reroll', () => rerollReveillon(soireeId, compatibleGameIds(n)))
  }
  const next = async (bravo: string[]) => {
    if (await run('next', () => nextReveillon(soireeId, bravo, compatibleGameIds(n)))) fx.whoosh()
  }
  const stop = async () => {
    if (await run('stop', () => stopReveillon(soireeId))) toast.success('Retour au salon normal.')
    setConfirm(null)
  }
  const end = async () => {
    setAction('end')
    const { data, error } = await supabase.rpc('end_soiree', { p_soiree_id: soireeId })
    setAction(null)
    setConfirm(null)
    if (error) return toastError(error)
    fx.fanfare()
    onEnded((data as { new_unlocks?: NewUnlocks } | null)?.new_unlocks ?? {})
  }

  const last = sc.history[sc.history.length - 1]
  return (
    <section className="flex flex-col gap-4">
      <ThemeBanner theme={theme} sc={sc} />

      {sc.phase === 'draw' && (
        <Card className="flex flex-col gap-3">
          <p className="font-display text-sm font-extrabold tracking-widest text-muted uppercase">Manche {sc.round} · tirée au sort</p>
          <div className="sticker flex items-center gap-3 p-3 text-[#1f1b2e]" style={{ backgroundColor: game?.color ?? '#ffb703' }}>
            <span className="text-5xl">{game?.emoji ?? '🎲'}</span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-2xl leading-tight font-extrabold">{game?.name ?? sc.game_id}</p>
              <p className="text-sm leading-snug font-bold">{game?.tagline}</p>
            </div>
          </div>
          {sc.round === sc.rounds && <p className="text-center font-display text-lg font-extrabold">🌟 Manche finale : points doublés !</p>}
          {!compatible && game && (
            <p className="text-center font-bold text-tomato">
              {game.name} se joue de {game.minPlayers} à {game.maxPlayers} joueurs : change de jeu !
            </p>
          )}
          {isHost ? (
            <div className="flex flex-col gap-2">
              <Button size="lg" fullWidth loading={action === 'launch'} disabled={busy || !compatible || action !== null} icon={<Play className="size-7 fill-current" />} onClick={() => void launch()}>
                Lancer {game?.name ?? 'le jeu'}
              </Button>
              <Button variant="secondary" fullWidth loading={action === 'reroll'} disabled={busy || action !== null} icon={<RotateCw className="size-5" />} onClick={reroll}>
                Changer de jeu
              </Button>
            </div>
          ) : (
            <p className="text-center font-display text-lg font-extrabold">L’hôte va lancer la partie… Ton téléphone basculera tout seul !</p>
          )}
        </Card>
      )}

      {sc.phase === 'playing' && (
        <Card className="flex items-center gap-3">
          <span className="text-5xl">{game?.emoji ?? '🎮'}</span>
          <div>
            <p className="font-display text-xl leading-tight font-extrabold">Manche {sc.round} en cours</p>
            <p className="text-muted">{game?.name} · le défi surprise arrive juste après !</p>
          </div>
        </Card>
      )}

      {sc.phase === 'challenge' && (
        <Card className="flex flex-col gap-3" accent={theme.color}>
          <p className={cn('font-display text-2xl font-extrabold', INK_TEXT)}>🎁 Défi surprise !</p>
          <Button size="lg" fullWidth onClick={() => setDismissed(null)}>
            Voir le défi en grand
          </Button>
        </Card>
      )}

      {sc.phase === 'finished' && <FinalCard theme={theme} standings={standings} byId={byId} isHost={isHost} action={action} onEnd={() => setConfirm('end')} onStop={() => setConfirm('stop')} />}

      <StandingsBoard theme={theme} standings={standings} byId={byId} meId={meId} />

      {isHost && sc.phase !== 'playing' && sc.phase !== 'finished' && (
        <button type="button" className="min-h-11 self-center px-3 text-sm font-bold text-muted underline" onClick={() => setConfirm('stop')}>
          Arrêter la soirée scénarisée
        </button>
      )}

      {wheel && sc.phase === 'draw' && !busy && (
        <GameWheel
          spin={wheel}
          isHost={isHost}
          busy={busy || !compatible}
          onClose={() => setWheel(null)}
          onLaunch={() => {
            setWheel(null)
            void launch()
          }}
          onRespin={reroll}
        />
      )}
      {showChallenge && (
        <ChallengeOverlay
          key={sc.round}
          theme={theme}
          sc={sc}
          round={last}
          byId={byId}
          playerIds={playerIds}
          isHost={isHost}
          busy={action === 'next'}
          onNext={(b) => void next(b)}
          onClose={() => setDismissed(sc.round)}
        />
      )}
      <ConfirmModal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        loading={action === 'stop' || action === 'end'}
        danger={confirm === 'end'}
        title={confirm === 'end' ? 'Terminer la soirée ?' : 'Arrêter la soirée scénarisée ?'}
        confirmLabel={confirm === 'end' ? 'Terminer' : 'Arrêter'}
        onConfirm={() => void (confirm === 'end' ? end() : stop())}
      >
        <p>{confirm === 'end' ? 'Place au podium et au récap de la soirée, pour tout le monde !' : 'On revient au salon normal (le classement des manches jouées reste dans le récap).'}</p>
      </ConfirmModal>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

function ThemeBanner({ theme, sc }: { theme: ReveillonTheme; sc: Scenario }) {
  const reduce = useReducedMotion()
  const current = getGame(sc.game_id)
  return (
    <div className={cn('sticker relative flex flex-col gap-3 overflow-hidden p-4', INK_TEXT)} style={{ backgroundColor: theme.color }}>
      {theme.decor.map((d, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="pointer-events-none absolute text-2xl opacity-70"
          style={{ left: `${6 + ((i * 17) % 88)}%`, top: i % 2 ? '8%' : '58%' }}
          animate={reduce ? undefined : { y: [0, -8, 0], rotate: [-10, 10, -10] }}
          transition={{ repeat: Infinity, duration: 2 + (i % 3) * 0.6, delay: i * 0.2 }}
        >
          {d}
        </motion.span>
      ))}
      <div className="relative flex items-center gap-3">
        <motion.span className="text-5xl" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 10 }}>
          {theme.emoji}
        </motion.span>
        <div className="min-w-0 flex-1">
          <h2 className="text-3xl leading-tight">{theme.name}</h2>
          <p className="font-display text-lg font-extrabold">{sc.phase === 'finished' ? 'Toutes les manches sont jouées !' : `Manche ${sc.round} sur ${sc.rounds}`}</p>
        </div>
      </div>
      <div className="relative flex flex-wrap gap-1.5" aria-label="Manches">
        {Array.from({ length: sc.rounds }, (_, i) => {
          const r = i + 1
          const h = sc.history.find((x) => x.round === r)
          const isCur = sc.phase !== 'finished' && r === sc.round && !h
          const g = h ? getGame(h.game_id) : isCur && sc.phase !== 'challenge' ? current : undefined
          return (
            <motion.span
              key={r}
              className={cn('sticker-sm relative flex size-11 items-center justify-center text-xl', h ? 'bg-white' : isCur ? 'bg-sun' : 'bg-white/50')}
              animate={isCur && !reduce ? { scale: [1, 1.12, 1] } : undefined}
              transition={{ repeat: Infinity, duration: 1.2 }}
              title={g?.name}
            >
              {g?.emoji ?? (h ? '✅' : '❔')}
              {r === sc.rounds && <span className="absolute -top-2 -right-2 rounded-full border-2 border-ink bg-tomato px-1 text-[0.6rem] font-extrabold text-white">×2</span>}
            </motion.span>
          )
        })}
      </div>
    </div>
  )
}

function StandingsBoard({ theme, standings, byId, meId }: { theme: ReveillonTheme; standings: ReveillonStanding[]; byId: ById; meId: string }) {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-2xl">
        {theme.emoji} Classement de la soirée
      </h2>
      <ul className="flex flex-col gap-1.5">
        {standings.map((s, i) => {
          const p = playerOrPlaceholder(byId, s.profile_id)
          return (
            <motion.li
              key={s.profile_id}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 20 }}
              className={cn('sticker-sm flex items-center gap-2 px-2 py-1.5', s.rank === 1 && s.total > 0 ? 'bg-sun text-[#1f1b2e]' : 'bg-surface', s.profile_id === meId && 'ring-2 ring-grape')}
            >
              <span className="w-8 text-center font-display text-xl font-extrabold">{MEDALS[s.rank] ?? s.rank}</span>
              <Avatar slug={p.slug} tenue={p.equippedTenue} size={40} />
              <span className="min-w-0 flex-1 truncate font-display text-lg font-extrabold">{p.nickname}</span>
              {s.stars > 0 && <span className="text-sm font-extrabold">⭐{s.stars}</span>}
              <span className="font-display text-xl font-extrabold">{s.total} pt{s.total > 1 ? 's' : ''}</span>
            </motion.li>
          )
        })}
      </ul>
      <p className="text-xs leading-snug text-muted">Gagnant 3 pts · 2e 2 pts · 3e 1 pt · défi relevé +1 · dernière manche ×2</p>
    </Card>
  )
}

function FinalCard({ theme, standings, byId, isHost, action, onEnd, onStop }: { theme: ReveillonTheme; standings: ReveillonStanding[]; byId: ById; isHost: boolean; action: string | null; onEnd: () => void; onStop: () => void }) {
  const champs = standings.filter((s) => s.rank === 1 && s.total > 0)
  useEffect(() => {
    victoryConfetti(2000)
    fx.fanfare()
  }, [])
  return (
    <div className={cn('sticker flex flex-col items-center gap-3 bg-sun p-4 text-center', INK_TEXT)}>
      <h2 className="text-3xl leading-tight">🏆 {champs.length > 1 ? 'Les champions de la soirée' : 'Champion·ne de la soirée'}</h2>
      <div className="flex flex-wrap items-end justify-center gap-3">
        {champs.map((s, i) => {
          const p = playerOrPlaceholder(byId, s.profile_id)
          return (
            <motion.div key={s.profile_id} className="flex flex-col items-center" initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 + i * 0.1, type: 'spring', stiffness: 220, damping: 11 }}>
              <Avatar slug={p.slug} tenue={p.equippedTenue} expression={mood(p, 'proud')} size={champs.length > 2 ? 72 : 104} bounce />
              <span className="font-display text-2xl font-extrabold">{p.nickname}</span>
              <span className="font-bold">{s.total} pts</span>
            </motion.div>
          )
        })}
      </div>
      <p className="text-lg font-bold">{theme.outro}</p>
      {isHost ? (
        <div className="flex w-full flex-col gap-2">
          <Button size="lg" fullWidth variant="danger" loading={action === 'end'} icon={<Flag className="size-6" />} onClick={onEnd}>
            Terminer la soirée
          </Button>
          <Button variant="secondary" fullWidth loading={action === 'stop'} icon={<Square className="size-5" />} onClick={onStop}>
            Continuer en mode normal
          </Button>
        </div>
      ) : (
        <p className="font-display font-extrabold">L’hôte va clôturer la soirée : podium et récap arrivent !</p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Défi surprise plein écran                                                   */
/* -------------------------------------------------------------------------- */

function ChallengeOverlay({ theme, sc, round, byId, playerIds, isHost, busy, onNext, onClose }: {
  theme: ReveillonTheme
  sc: Scenario
  round: Scenario['history'][number] | undefined
  byId: ById
  playerIds: string[]
  isHost: boolean
  busy: boolean
  onNext: (bravo: string[]) => void
  onClose: () => void
}) {
  const reduce = useReducedMotion()
  const ch = sc.challenge
  const def = getChallenge(ch?.id)
  const parts = def && ch ? challengeParts(def.text, ch) : []
  const named = [...new Set(parts.map((p) => p.who).filter((x): x is string => Boolean(x)))]
  const [bravo, setBravo] = useState<Set<string>>(() => new Set())
  const isLast = sc.round >= sc.rounds
  const winners = (round?.wins ?? []).map((id) => playerOrPlaceholder(byId, id).nickname)
  const g = round ? getGame(round.game_id) : undefined

  useEffect(() => {
    fx.fanfare()
    burst({ x: 0.5, y: 0.3 }, 160)
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[62] flex items-center justify-center bg-[#07050f]/80 p-3 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Défi surprise">
      <motion.div
        className={cn('sticker relative flex max-h-[96dvh] w-full max-w-md flex-col items-center gap-3 overflow-y-auto rounded-bubble p-4 text-center', INK_TEXT)}
        style={{ backgroundColor: theme.color }}
        initial={{ scale: 0.3, rotate: -12, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 14 }}
      >
        {round && (
          <p className="sticker-sm bg-white px-3 py-1 text-sm font-extrabold">
            {g?.emoji} Manche {round.round} : {winners.length ? `gagnée par ${winners.join(' & ')}` : 'terminée'}
            {round.double ? ' (points ×2)' : ''}
          </p>
        )}
        <motion.span className="text-7xl" animate={reduce ? undefined : { rotate: [-12, 12, -12], scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>
          {def?.emoji ?? theme.emoji}
        </motion.span>
        <h2 className="text-4xl leading-tight">Défi surprise !</h2>
        {named.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {named.map((id, i) => {
              const p = playerOrPlaceholder(byId, id)
              return (
                <motion.div key={id} initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 + i * 0.1, type: 'spring', stiffness: 220, damping: 10 }}>
                  <Avatar slug={p.slug} tenue={p.equippedTenue} expression={mood(p, 'shocked')} size={88} bounce />
                </motion.div>
              )
            })}
          </div>
        )}
        <motion.p
          className="sticker w-full bg-white p-4 font-display text-2xl leading-snug font-extrabold"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4, type: 'spring', stiffness: 260, damping: 13 }}
        >
          {def
            ? parts.map((p, i) =>
                p.who ? (
                  <span key={i} className="mx-0.5 inline-block -rotate-2 rounded-chip border-2 border-ink bg-sun px-2 shadow-sticker-sm">
                    {playerOrPlaceholder(byId, p.who).nickname}
                  </span>
                ) : (
                  <span key={i}>{p.text}</span>
                ),
              )
            : 'Pas de défi cette fois : on enchaîne !'}
        </motion.p>

        {isHost ? (
          <div className="flex w-full flex-col gap-2">
            {def && (
              <div className="sticker flex flex-col gap-1 bg-surface p-2 text-text">
                <p className="font-display font-extrabold">Qui a relevé le défi ? (+1 ⭐)</p>
                <div className="grid grid-cols-4 gap-1">
                  {playerIds.map((id) => (
                    <CheckableToken
                      key={id}
                      player={playerOrPlaceholder(byId, id)}
                      checked={bravo.has(id)}
                      size={48}
                      onToggle={() =>
                        setBravo((s) => {
                          const n = new Set(s)
                          if (n.has(id)) n.delete(id)
                          else n.add(id)
                          return n
                        })
                      }
                    />
                  ))}
                </div>
                <button type="button" className="min-h-10 text-sm font-bold underline" onClick={() => setBravo(new Set(playerIds))}>
                  Tout le monde l’a fait !
                </button>
              </div>
            )}
            <Button size="lg" fullWidth loading={busy} onClick={() => onNext([...bravo])}>
              {isLast ? '🏆 Classement final' : 'Manche suivante ➜'}
            </Button>
            <Button size="sm" variant="secondary" onClick={onClose}>
              Fermer
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-2">
            <Button size="lg" fullWidth onClick={onClose}>
              C’est fait ! 🎉
            </Button>
            <p className="text-sm font-bold">L’hôte lance la suite dès que le défi est relevé.</p>
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  )
}

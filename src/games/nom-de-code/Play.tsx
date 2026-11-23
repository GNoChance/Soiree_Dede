import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { supabase } from '@/lib/supabase'
import { fx } from '@/lib/feedback'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { TEAM_INFO } from '@/features/teams/teams'
import { TvButton } from '@/features/tv/TvButton'
import { useTv } from '@/features/tv/tv'
import type { GamePlayProps } from '../types'
import { CluePanel, SkipTurn } from './CluePanel'
import { EliminationNotice } from './Elimination'
import { Grid } from './Grid'
import { myRole, teamNames } from './logic'
import { RoundEnd } from './RoundEnd'
import { ndcActions } from './setup'
import { NdcTv } from './TvView'
import { useDeadlineTick } from './useTick'
import type { NdcCell, NdcSecret, NdcState } from './types'

const isSecret = (x: unknown): x is NdcSecret => !!x && typeof x === 'object' && typeof (x as NdcSecret).round === 'number'

/**
 * Clé de l'espion pour la manche : d'abord le secret reçu en temps réel ; s'il est absent ou d'une
 * manche précédente (évènement manqué), relecture de match_secrets avec ré-essais (comme Menteur).
 */
function useSpyKey(matchId: string, propSecret: unknown, round: number, enabled: boolean): NdcCell[] | null {
  const [fetched, setFetched] = useState<NdcSecret | null>(null)
  const prop = isSecret(propSecret) ? propSecret : null
  const best = prop?.round === round ? prop : fetched?.round === round ? fetched : null
  const have = Boolean(best?.key)
  useEffect(() => {
    if (!enabled || have) return
    let cancelled = false
    let timer = 0
    const load = async (attempt: number) => {
      const { data } = await supabase.from('match_secrets').select('secret').eq('match_id', matchId).maybeSingle()
      if (cancelled) return
      const sec = (data?.secret ?? null) as unknown
      if (isSecret(sec)) setFetched(sec)
      if ((!isSecret(sec) || sec.round < round || !sec.key) && attempt < 6) timer = window.setTimeout(() => void load(attempt + 1), 400 * (attempt + 1))
    }
    timer = window.setTimeout(() => void load(0), 700) // d'abord une chance au Realtime
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [matchId, round, enabled, have])
  return best?.key ?? null
}

/** Sous TvContext (route /soiree/:id/tele) : vue télé en lecture seule. */
export default function NomDeCodePlay(props: GamePlayProps) {
  return useTv() ? <NdcTv {...props} /> : <NdcPlayScreen {...props} />
}

function NdcPlayScreen({ matchId, soireeId, state, secret, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as NdcState
  const role = myRole(s, meId)
  const secretKey = useSpyKey(matchId, secret, s.round, role.spy)
  const live = s.phase === 'clue' || s.phase === 'guess'
  const left = useCountdown(live ? s.deadline : null)
  const timeUp = live && Boolean(s.deadline) && left <= 0

  // Échéance : un seul tick (l'hôte tout de suite), les joueurs d'équipe ne servent que de secours.
  useDeadlineTick(timeUp && Boolean(role.team || isHost), act, isHost ? 'host' : 'player')

  // Rôle affiché 3 s au début de chaque manche (front uniquement).
  const [roleRound, setRoleRound] = useState<number | null>(null)
  const shown = useRef(new Set<number>())
  useEffect(() => {
    if (!live || shown.current.has(s.round)) return
    shown.current.add(s.round)
    setRoleRound(s.round)
    const t = window.setTimeout(() => setRoleRound(null), 3000)
    return () => clearTimeout(t)
  }, [s.round, live])

  // Bruitages et secousse à chaque carte dévoilée (diff des clés : jsonb ne garde pas l'ordre d'insertion).
  const seen = useRef<Set<string> | null>(null)
  const controls = useAnimationControls()
  useEffect(() => {
    const keys = Object.keys(s.revealed)
    const prev = seen.current
    seen.current = new Set(keys)
    if (!prev) return
    const fresh = keys.filter((k) => !prev.has(k)).map((k) => s.revealed[k])
    if (!fresh.length) return
    if (fresh.some((c) => c.color === 'bomb')) {
      fx.fail()
      void controls.start({ x: [0, -14, 14, -10, 10, 0], transition: { duration: 0.5 } })
    } else if (fresh.some((c) => c.color === c.by)) fx.success()
    else fx.whoosh()
  }, [s.revealed, controls])

  const secs = Math.ceil(left / 1000)
  const out = s.teams.filter((t) => t.eliminated).map((t) => t.id)
  return (
    <motion.div animate={controls} className="flex flex-col gap-3 pb-6">
      {/* Pastilles d'équipe : mots restants, équipe active, éliminées grisées */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {s.teams.map((t) => {
          const meta = TEAM_INFO[t.id]
          const activeTeam = live && s.turn === t.id
          return (
            <motion.span
              key={t.id}
              animate={activeTeam ? { scale: [1, 1.08, 1] } : { scale: 1 }}
              transition={activeTeam ? { repeat: Infinity, duration: 1.4 } : undefined}
              className={cn('sticker-sm flex items-center gap-1 rounded-full px-3 py-1 font-display text-lg font-extrabold', t.eliminated && 'opacity-40 grayscale')}
              style={{ backgroundColor: activeTeam ? meta.color : meta.soft, color: activeTeam ? meta.text : '#1f1b2e' }}
            >
              {t.eliminated ? '💀' : meta.emoji} {t.total - t.found}
            </motion.span>
          )
        })}
        {live && s.deadline && (s.timer !== 'relaxed' || secs <= 60) && (
          <span className={cn('sticker-sm rounded-full bg-surface px-3 py-1 font-display text-lg font-extrabold', secs <= 10 && 'text-tomato')}>
            ⏱️ {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
          </span>
        )}
        {live && out.length > 0 && <p className="w-full text-center text-sm font-bold text-muted">💀 {out.length > 1 ? 'Éliminés' : 'Éliminé'} : {teamNames(out)}</p>}
      </div>

      {live && <CluePanel s={s} meId={meId} act={act} pending={pending} />}
      {live && (
        <Grid
          s={s}
          secretKey={secretKey}
          meId={meId}
          canVote={s.phase === 'guess' && role.team === s.turn && !role.spy && !pending}
          onVote={(i) => void act(ndcActions.vote(i))}
          players={players}
        />
      )}
      {live && role.spy && <p className="text-center text-xs text-muted">🕵️ Tu vois les couleurs secrètes : chut !</p>}
      {/* Loin de « Stop, on passe » (au-dessus de la grille) : l'hôte passe le tour après confirmation. */}
      {live && isHost && <SkipTurn act={act} pending={pending} />}
      {(s.phase === 'round_end' || s.phase === 'finished') && <RoundEnd s={s} meId={meId} isHost={isHost} act={act} pending={pending} players={players} />}

      {(isHost || !role.team) && <TvButton soireeId={soireeId} />}

      <EliminationNotice s={s} meTeam={role.team} />

      <AnimatePresence>
        {roleRound === s.round && (
          <motion.div
            key={`role-${s.round}`}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => setRoleRound(null)}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#07050f]/75 p-6 text-center"
          >
            <Avatar slug={playerOrPlaceholder(players, meId).slug} tenue={playerOrPlaceholder(players, meId).equippedTenue} size={120} />
            <p className="sticker rounded-card bg-surface p-4 font-display text-2xl font-extrabold">
              {role.team
                ? role.spy
                  ? `🕵️ Tu es l’espion des ${TEAM_INFO[role.team].short} !`
                  : `🔎 Tu devines pour les ${TEAM_INFO[role.team].short} !`
                : '👀 Tu regardes la partie'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

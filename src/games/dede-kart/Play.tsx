import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import type { GamePlayProps } from '../types'
import { buildDrivers } from './drivers'
import type { Game, KartSnap } from './engine/Game'
import type { UsePayload } from './engine/items'
import KartRace from './KartRace'
import { useKartNet } from './net'
import { Standings } from './Standings'
import { TRACKS } from './tracks'
import { dkActions, type DkState } from './types'

/**
 * Dédé Kart en multi : chaque téléphone conduit son kart (l'hôte conduit aussi les bots),
 * les positions passent par le broadcast `kart:<matchId>`, et chaque tour bouclé est
 * envoyé au serveur qui classe et compte les points.
 */
export default function KartPlay({ matchId, state, meId, isHost, players, act }: GamePlayProps) {
  const s = state as unknown as DkState
  const isPlayer = s.players.includes(meId)
  const roster = `${s.players.join(',')}|${s.bots.join(',')}`
  // ordre et apparence des karts figés pour la partie (un changement de pseudo ne recrée pas la scène)
  const drivers = useMemo(
    () => buildDrivers(s.players, s.bots, players),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster],
  )
  const track = TRACKS[s.track % TRACKS.length]
  const localBots = useMemo(() => (isHost ? s.bots : []), [isHost, s.bots])
  const goAt = useMemo(() => Date.parse(s.go_at), [s.go_at])

  // réseau : ~8 envois/s (un peu moins quand on est nombreux)
  const game = useRef<Game | null>(null)
  const period = s.players.length > 8 ? 150 : 120
  useKartNet(
    matchId,
    period,
    () => (s.phase === 'racing' ? game.current?.snapshots() ?? [] : []),
    (snaps: KartSnap[]) => snaps.forEach((k) => game.current?.applyRemote(k)),
  )
  // objets : pièges/projectiles et effets du state transmis au moteur
  const hazards = s.hazards
  const fx = s.fx
  const items = useRef({ hazards, fx })
  items.current = { hazards, fx }
  useEffect(() => {
    game.current?.syncItems(hazards ?? [], fx ?? [])
  }, [hazards, fx])
  const onReady = useCallback((g: Game | null) => {
    game.current = g
    g?.syncItems(items.current.hazards ?? [], items.current.fx ?? [])
  }, [])

  // actions d'un kart : le mien, ou un bot (seul l'hôte en a)
  const send = useCallback(
    (id: string, a: Record<string, unknown> & { type: string }) => {
      if (id === meId) void act(a)
      else if (isHost) void act({ ...a, bot: id })
    },
    [act, isHost, meId],
  )
  const onLap = useCallback((id: string, completed: number) => send(id, dkActions.lap(completed)), [send])
  const onUse = useCallback((id: string, u: UsePayload) => send(id, dkActions.use(u)), [send])
  const onHit = useCallback((id: string, hazard: number) => send(id, dkActions.hit(hazard)), [send])

  // échéances (fin de course, course suivante) : n'importe quel téléphone envoie `tick`
  const left = useCountdown(s.deadline)
  const ticked = useRef<string | null>(null)
  useEffect(() => {
    if ((s.phase === 'racing' || s.phase === 'results') && s.deadline && left <= 0 && ticked.current !== s.deadline) {
      ticked.current = s.deadline
      void act(dkActions.tick())
    }
  }, [left, s.deadline, s.phase, act])

  const [confirmEnd, setConfirmEnd] = useState(false)
  const endBtn = isHost && (
    <button
      type="button"
      onClick={() => (confirmEnd ? void act(dkActions.endGame()) : setConfirmEnd(true))}
      onBlur={() => setConfirmEnd(false)}
      className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-chip border-[3px] border-ink bg-surface px-2 py-1 text-xs font-bold text-text shadow-sticker-sm"
    >
      {confirmEnd ? 'Sûr ? Arrêter' : '⏹ Arrêter'}
    </button>
  )

  if (s.phase === 'results') {
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-paper p-4 text-text">
        <div className="mx-auto max-w-md">
          <h2 className="text-center font-display text-3xl font-extrabold">
            🏁 Course {s.race}/{s.races}
          </h2>
          <p className="mb-3 text-center text-sm text-muted">{track.name}</p>
          <div className="sticker bg-surface p-3">
            <Standings s={s} drivers={drivers} meId={meId} />
          </div>
          <p className="mt-4 text-center font-bold">Course suivante dans {Math.ceil(left / 1000)} s…</p>
          {isHost && (
            <button
              type="button"
              onClick={() => void act(dkActions.next())}
              className="mx-auto mt-3 block rounded-chip border-[3px] border-ink bg-sun px-5 py-3 font-display text-xl font-extrabold text-ink shadow-sticker"
            >
              On y va !
            </button>
          )}
        </div>
      </div>
    )
  }

  if (s.phase !== 'racing') return null

  const myArrival = s.arrival.indexOf(meId)
  return (
    <KartRace
      key={s.race}
      track={track}
      laps={s.laps}
      drivers={drivers}
      meId={isPlayer ? meId : null}
      localBots={localBots}
      goAt={goAt}
      now={serverNow}
      showResults={false}
      onLap={onLap}
      onUse={onUse}
      onHit={onHit}
      onReady={onReady}
    >
      {myArrival >= 0 && (
        <div className="pointer-events-none absolute inset-x-4 top-1/4 rounded-card border-[3px] border-ink bg-surface p-4 text-center text-text shadow-sticker">
          <div className="font-display text-4xl font-extrabold">🏁 {myArrival + 1}{myArrival === 0 ? 'er' : 'e'} !</div>
          <p className="mt-1 font-bold text-muted">
            En attente des autres… {s.deadline ? `(${Math.ceil(left / 1000)} s)` : ''}
          </p>
        </div>
      )}
      {endBtn}
    </KartRace>
  )
}

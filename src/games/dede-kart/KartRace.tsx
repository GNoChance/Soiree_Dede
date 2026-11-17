import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Game, type Driver, type Hud, type RaceResult } from './engine/Game'
import { ITEM_IDS, ITEMS, type UsePayload } from './engine/items'
import type { TrackDef } from './tracks'

interface Props {
  track: TrackDef
  laps: number
  drivers: Driver[]
  /** Mon kart (null = spectateur). */
  meId: string | null
  /** Bots simulés sur ce téléphone. */
  localBots: string[]
  /** Feu vert (ms, horloge `now`). */
  goAt: number
  now: () => number
  autopilot?: boolean
  /** Affiche le classement local à mon arrivée (essai solo). En multi, c'est le serveur qui classe. */
  showResults?: boolean
  onLap?: (id: string, completed: number) => void
  onUse?: (id: string, p: UsePayload) => void
  onHit?: (id: string, hazard: number) => void
  onFinish?: (results: RaceResult[]) => void
  /** Moteur créé (ou détruit : null), pour le réseau. */
  onReady?: (game: Game | null) => void
  /** Contenu superposé (boutons, attente…). */
  children?: ReactNode
}

export const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`
const DRIFT_BG = ['bg-surface', 'bg-[#4CC9F0]', 'bg-[#FF8C42]', 'bg-[#B388FF]']

/** Une course : scène 3D plein écran + HUD (place, tour, chrono) + bouton Drift tactile. */
export default function KartRace(p: Props) {
  const { track, laps, drivers, meId, localBots, goAt, now, autopilot, showResults = true, children } = p
  const host = useRef<HTMLDivElement>(null)
  const game = useRef<Game | null>(null)
  const [hud, setHud] = useState<Hud | null>(null)
  const done = useRef(false)
  const [muted, setMuted] = useState(false)
  // callbacks dans une ref : un nouveau rendu du parent ne recrée pas la scène
  const cb = useRef(p)
  cb.current = p

  useEffect(() => {
    if (!host.current) return
    const g = new Game(host.current, {
      track, laps, drivers, meId, localBots, goAt, now, autopilot,
      onHud: setHud,
      onLap: (id, n) => cb.current.onLap?.(id, n),
      onUse: (id, u) => cb.current.onUse?.(id, u),
      onHit: (id, h) => cb.current.onHit?.(id, h),
    })
    game.current = g
    setMuted(g.muted)
    done.current = false
    cb.current.onReady?.(g)
    return () => {
      cb.current.onReady?.(null)
      g.dispose()
      game.current = null
    }
    // goAt/now/localBots/meId : fixés pour une course (la course suivante remonte le composant)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, laps, drivers, autopilot])

  useEffect(() => {
    if (hud?.results && !done.current) {
      done.current = true
      cb.current.onFinish?.(hud.results)
    }
  }, [hud?.results])

  const drift = (on: boolean) => (e: React.PointerEvent) => {
    e.preventDefault()
    game.current?.setDrift(on)
  }

  // roulette : défile les emojis pendant le tirage
  const [spinIdx, setSpinIdx] = useState(0)
  const rolling = Boolean(hud?.rolling)
  useEffect(() => {
    if (!rolling) return
    const id = setInterval(() => setSpinIdx((i) => i + 1), 90)
    return () => clearInterval(id)
  }, [rolling])
  const slot = rolling ? ITEMS[ITEM_IDS[spinIdx % ITEM_IDS.length]].emoji : hud?.item ? ITEMS[hud.item].emoji : ''

  return (
    <div className="fixed inset-0 z-40 select-none overflow-hidden bg-black" style={{ touchAction: 'none' }}>
      <div ref={host} className="absolute inset-0" />
      {hud && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3 font-display font-extrabold text-ink">
            <div className="rounded-chip border-[3px] border-ink bg-sun px-3 py-1 text-3xl shadow-sticker-sm">
              {hud.place}
              <span className="text-base">{hud.place === 1 ? 'er' : 'e'}</span>
              <span className="text-sm"> / {hud.total}</span>
            </div>
            <div className="rounded-chip border-[3px] border-ink bg-surface px-3 py-1 text-center text-text shadow-sticker-sm">
              <div className="text-lg leading-tight">Tour {hud.lap}/{hud.laps}</div>
              <div className="text-sm tabular-nums">{fmtTime(hud.time)}</div>
            </div>
          </div>

          {hud.phase === 'countdown' && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-white [text-shadow:4px_4px_0_#1B1B2F]">
              <div className="font-display text-3xl font-extrabold">
                {track.emoji} {track.name}
              </div>
              {hud.count > 0 && <div className="font-display text-9xl font-extrabold">{hud.count}</div>}
            </div>
          )}
          {hud.phase === 'racing' && hud.time < 1 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center font-display text-7xl font-extrabold text-sun [text-shadow:5px_5px_0_#1B1B2F]">
              PARTEZ !
            </div>
          )}
          {hud.wrongWay && (
            <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center font-display text-4xl font-extrabold text-tomato [text-shadow:3px_3px_0_#1B1B2F]">
              ↩ Mauvais sens !
            </div>
          )}

          {hud.fx.confetti && (
            <div
              className="pointer-events-none absolute inset-0 animate-pulse"
              style={{
                background:
                  'radial-gradient(circle at 20% 30%, #FF5A5F 0 5%, transparent 6%), radial-gradient(circle at 70% 25%, #FFD23F 0 7%, transparent 8%), radial-gradient(circle at 45% 55%, #4CC9F0 0 9%, transparent 10%), radial-gradient(circle at 80% 65%, #7AE582 0 6%, transparent 7%), radial-gradient(circle at 25% 75%, #B388FF 0 8%, transparent 9%), radial-gradient(circle at 55% 85%, #FF8C42 0 6%, transparent 7%), radial-gradient(circle at 60% 40%, #FF5A5F 0 6%, transparent 7%), radial-gradient(circle at 35% 45%, #FFD23F 0 5%, transparent 6%)',
              }}
            />
          )}
          {(hud.fx.reverse || hud.fx.slow || hud.fx.spin || hud.fx.star || hud.fx.bubble) && (
            <div className="pointer-events-none absolute inset-x-0 top-20 flex flex-col items-center gap-1 font-display text-2xl font-extrabold text-white [text-shadow:3px_3px_0_#1B1B2F]">
              {hud.fx.spin && <span>💫 Aïe !</span>}
              {hud.fx.reverse && <span>🔄 Commandes inversées !</span>}
              {hud.fx.slow && <span>☁️ Sous le gros nuage…</span>}
              {hud.fx.star && <span>🌈 Intouchable !</span>}
              {hud.fx.bubble && <span className="text-lg">🛡️ Bulle active</span>}
            </div>
          )}

          {meId && hud.phase !== 'finished' && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
                game.current?.useItem()
              }}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={hud.item ? `Utiliser : ${ITEMS[hud.item].label}` : 'Pas d’objet'}
              className={`absolute bottom-6 left-4 grid size-24 place-items-center rounded-card border-[4px] border-ink text-5xl shadow-sticker ${slot ? 'bg-sun' : 'bg-surface/70'}`}
              style={{ touchAction: 'none' }}
            >
              {slot || <span className="font-display text-sm font-extrabold text-ink/60">OBJET</span>}
            </button>
          )}

          {meId && hud.phase !== 'finished' && (
            <button
              type="button"
              onPointerDown={drift(true)}
              onPointerUp={drift(false)}
              onPointerCancel={drift(false)}
              onPointerLeave={drift(false)}
              onContextMenu={(e) => e.preventDefault()}
              className={`absolute bottom-6 right-4 size-28 rounded-full border-[4px] border-ink font-display text-xl font-extrabold text-ink shadow-sticker ${DRIFT_BG[Math.max(0, hud.driftLevel)]} ${hud.driftLevel >= 0 ? 'scale-95' : ''}`}
              style={{ touchAction: 'none' }}
            >
              DRIFT
            </button>
          )}

          {showResults && hud.results && (
            <div className="absolute inset-0 grid place-items-center bg-black/50 p-4">
              <div className="w-full max-w-sm rounded-card border-[3px] border-ink bg-surface p-4 text-text shadow-sticker">
                <h2 className="text-center font-display text-3xl font-extrabold">🏁 Arrivée !</h2>
                <ol className="mt-3 space-y-1">
                  {hud.results.map((r, k) => (
                    <li key={r.id} className={`flex items-center gap-2 rounded-chip border-2 border-ink px-3 py-1 font-bold ${r.me ? 'bg-sun text-ink' : 'bg-sunk'}`}>
                      <span className="w-6">{k + 1}.</span>
                      <span className="flex-1 truncate">{r.name}</span>
                      <span className="tabular-nums">{r.time === null ? '…' : fmtTime(r.time)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </>
      )}
      <button
        type="button"
        onClick={() => {
          const m = !muted
          game.current?.setMuted(m)
          setMuted(m)
        }}
        aria-label={muted ? 'Remettre le son' : 'Couper le son'}
        className="absolute left-3 top-20 z-10 grid size-11 place-items-center rounded-full border-[3px] border-ink bg-surface text-xl shadow-sticker-sm"
      >
        {muted ? '🔇' : '🔊'}
      </button>
      {children}
    </div>
  )
}

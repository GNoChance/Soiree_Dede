import { useEffect, useRef, useState } from 'react'
import { Game, type Driver, type Hud, type RaceResult } from './engine/Game'
import type { TrackDef } from './tracks'

interface Props {
  track: TrackDef
  laps: number
  /** Le premier pilote est le joueur, les autres sont des bots (étape 2 : sans réseau). */
  drivers: Driver[]
  onFinish?: (results: RaceResult[]) => void
  autopilot?: boolean
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`
const DRIFT_BG = ['bg-surface', 'bg-[#4CC9F0]', 'bg-[#FF8C42]', 'bg-[#B388FF]']

/** Une course : scène 3D plein écran + HUD (place, tour, chrono) + bouton Drift tactile. */
export default function KartRace({ track, laps, drivers, onFinish, autopilot }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const game = useRef<Game | null>(null)
  const [hud, setHud] = useState<Hud | null>(null)
  const done = useRef(false)

  useEffect(() => {
    if (!host.current) return
    const g = new Game(host.current, track, laps, drivers, setHud)
    g.autopilot = Boolean(autopilot)
    game.current = g
    done.current = false
    return () => g.dispose()
  }, [track, laps, drivers, autopilot])

  useEffect(() => {
    if (hud?.results && !done.current) {
      done.current = true
      onFinish?.(hud.results)
    }
  }, [hud?.results, onFinish])

  const drift = (on: boolean) => (e: React.PointerEvent) => {
    e.preventDefault()
    game.current?.setDrift(on)
  }

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black" style={{ touchAction: 'none' }}>
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
              <div className="text-sm tabular-nums">{fmt(hud.time)}</div>
            </div>
          </div>

          {hud.phase === 'countdown' && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center font-display text-9xl font-extrabold text-white [text-shadow:6px_6px_0_#1B1B2F]">
              {hud.count}
            </div>
          )}
          {hud.phase === 'racing' && hud.count === 0 && hud.time < 1 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center font-display text-7xl font-extrabold text-sun [text-shadow:5px_5px_0_#1B1B2F]">
              PARTEZ !
            </div>
          )}
          {hud.wrongWay && (
            <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center font-display text-4xl font-extrabold text-tomato [text-shadow:3px_3px_0_#1B1B2F]">
              ↩ Mauvais sens !
            </div>
          )}

          {hud.phase !== 'finished' && (
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

          {hud.results && (
            <div className="absolute inset-0 grid place-items-center bg-black/50 p-4">
              <div className="w-full max-w-sm rounded-card border-[3px] border-ink bg-surface p-4 text-text shadow-sticker">
                <h2 className="text-center font-display text-3xl font-extrabold">🏁 Arrivée !</h2>
                <ol className="mt-3 space-y-1">
                  {hud.results.map((r, k) => (
                    <li key={r.id} className={`flex items-center gap-2 rounded-chip border-2 border-ink px-3 py-1 font-bold ${r.me ? 'bg-sun text-ink' : 'bg-sunk'}`}>
                      <span className="w-6">{k + 1}.</span>
                      <span className="flex-1 truncate">{r.name}</span>
                      <span className="tabular-nums">{r.time === null ? '…' : fmt(r.time)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

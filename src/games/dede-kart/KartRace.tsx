import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Game, type Driver, type Hud, type RaceResult } from './engine/Game'
import { ITEM_IDS, ITEMS, type UsePayload } from './engine/items'
import type { TrackDef } from './tracks'

interface Props {
  track: TrackDef
  laps: number
  drivers: Driver[]
  /** Mon kart (null = spectateur). */
  meId: string | null
  /** Tous les bots (conducteur variable, cf. Game.setBotDriver). */
  botIds?: string[]
  /** Bots simulés sur ce téléphone. */
  localBots: string[]
  /** Feu vert (ms, horloge `now`). */
  goAt: number
  now: () => number
  autopilot?: boolean
  autoCut?: boolean
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
const DRIFT_COLORS = ['#4CC9F0', '#FF8C42', '#B388FF']

/** Une course : scène 3D plein écran + HUD (place, tour, chrono) + bouton Drift tactile. */
export default function KartRace(p: Props) {
  const { track, laps, drivers, meId, localBots, goAt, now, autopilot, autoCut, showResults = true, children } = p
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
      track, laps, drivers, meId, localBots, goAt, now, autopilot, autoCut, botIds: p.botIds,
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
            <div className="flex flex-col items-end gap-2">
              <div className="rounded-chip border-[3px] border-ink bg-surface px-3 py-1 text-center text-text shadow-sticker-sm">
                <div className="text-lg leading-tight">Tour {hud.lap}/{hud.laps}</div>
                <div className="text-sm tabular-nums">{fmtTime(hud.time)}</div>
              </div>
              <MiniMap game={game.current} dots={hud.dots} />
            </div>
          </div>

          {(hud.boost || hud.speed > 0.97) && (
            <div
              className="pointer-events-none absolute inset-0 animate-pulse"
              style={{
                opacity: hud.boost ? 1 : 0.35,
                background: 'repeating-conic-gradient(from 0deg at 50% 55%, rgba(255,255,255,0.22) 0deg 1.2deg, transparent 1.2deg 9deg)',
                maskImage: 'radial-gradient(circle at 50% 55%, transparent 32%, black 75%)',
                WebkitMaskImage: 'radial-gradient(circle at 50% 55%, transparent 32%, black 75%)',
              }}
            />
          )}

          {(hud.phase === 'countdown' || (hud.phase === 'racing' && hud.time < 1)) && (
            <div className="pointer-events-none absolute inset-x-0 top-1/4 flex flex-col items-center gap-3">
              <div className="font-display text-2xl font-extrabold text-white [text-shadow:3px_3px_0_#1B1B2F]">
                {track.emoji} {track.name}
              </div>
              {/* feux de départ : rouges un à un, puis tous verts */}
              <div className="flex gap-3 rounded-card border-[4px] border-ink bg-[#1B1B2F] px-4 py-3 shadow-sticker">
                {[3, 2, 1].map((n) => {
                  const go = hud.phase === 'racing'
                  const on = go || (hud.count > 0 && hud.count <= n)
                  return (
                    <span
                      key={n}
                      className="size-12 rounded-full border-[3px] border-black/60"
                      style={{
                        background: on ? (go ? '#38E07B' : '#FF3B3B') : '#3A3A48',
                        boxShadow: on ? `0 0 18px ${go ? '#38E07B' : '#FF3B3B'}` : 'none',
                      }}
                    />
                  )
                })}
              </div>
              {hud.phase === 'racing' && (
                <div className="font-display text-6xl font-extrabold text-sun [text-shadow:5px_5px_0_#1B1B2F]">PARTEZ !</div>
              )}
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
          {(hud.fx.reverse || hud.fx.slow || hud.fx.spin || hud.fx.star || hud.fx.bubble || hud.fx.slip || hud.fx.magnet || hud.fx.draft || hud.fx.cut) && (
            <div className="pointer-events-none absolute inset-x-0 top-20 flex flex-col items-center gap-1 font-display text-2xl font-extrabold text-white [text-shadow:3px_3px_0_#1B1B2F]">
              {hud.fx.spin && <span>💫 Aïe !</span>}
              {hud.fx.slip && !hud.fx.spin && <span>🫠 Ça glisse !</span>}
              {hud.fx.magnet && <span>🧲 Aimanté !</span>}
              {hud.fx.cut && <span className="text-lg">🤫 {track.cutName}</span>}
              {hud.fx.draft && !hud.boost && <span className="text-lg">💨 Aspiration !</span>}
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
          {meId && hud.phase !== 'finished' && hud.item && !rolling && (
            <div className="pointer-events-none absolute bottom-[7.6rem] left-4 max-w-[11rem] rounded-chip border-[3px] border-ink bg-surface px-2 py-0.5 font-display text-sm font-extrabold text-text shadow-sticker-sm">
              {ITEMS[hud.item].label}
            </div>
          )}

          {/* dérapage automatique : jauge de mini-turbo (3 paliers), rien à appuyer */}
          {meId && hud.phase !== 'finished' && hud.driftLevel >= 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-10 flex flex-col items-center gap-1">
              <div className="flex gap-2 rounded-full border-[3px] border-ink bg-surface/90 px-3 py-2 shadow-sticker-sm">
                {DRIFT_COLORS.map((c, k) => (
                  <span
                    key={c}
                    className="size-5 rounded-full border-2 border-ink"
                    style={{ background: hud.driftLevel > k ? c : 'transparent', boxShadow: hud.driftLevel > k ? `0 0 10px ${c}` : 'none' }}
                  />
                ))}
              </div>
              <span className="font-display text-sm font-extrabold text-white [text-shadow:2px_2px_0_#1B1B2F]">
                {hud.driftLevel > 0 ? 'Redresse pour le turbo !' : 'Dérapage…'}
              </span>
            </div>
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

/** Mini-carte : contour du circuit + un point par kart (le mien plus gros, cerclé). */
function MiniMap({ game, dots }: { game: Game | null; dots: Hud['dots'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const outline = useMemo(() => game?.outline() ?? [], [game])
  const cut = useMemo(() => game?.cutOutline() ?? [], [game])
  useEffect(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g || !outline.length) return
    const S = c.width
    g.clearRect(0, 0, S, S)
    g.lineJoin = 'round'
    g.beginPath()
    outline.forEach(([x, y], i) => (i ? g.lineTo(x * S, y * S) : g.moveTo(x * S, y * S)))
    g.closePath()
    g.strokeStyle = 'rgba(27,27,47,0.9)'
    g.lineWidth = 9
    g.stroke()
    g.strokeStyle = '#F4F4F4'
    g.lineWidth = 4
    g.stroke()
    if (cut.length) {
      // raccourci : pointillés violets
      g.beginPath()
      cut.forEach(([x, y], i) => (i ? g.lineTo(x * S, y * S) : g.moveTo(x * S, y * S)))
      g.setLineDash([5, 4])
      g.strokeStyle = '#B388FF'
      g.lineWidth = 3
      g.stroke()
      g.setLineDash([])
    }
    for (const d of [...dots].sort((a, b) => Number(a.me) - Number(b.me))) {
      g.beginPath()
      g.arc(d.x * S, d.y * S, d.me ? 7 : 5, 0, Math.PI * 2)
      g.fillStyle = d.c
      g.fill()
      g.lineWidth = d.me ? 3 : 2
      g.strokeStyle = d.me ? '#FFFFFF' : '#1B1B2F'
      g.stroke()
    }
  }, [outline, cut, dots])
  return <canvas ref={ref} width={120} height={120} className="size-[96px] rounded-card border-[3px] border-ink bg-black/25" />
}

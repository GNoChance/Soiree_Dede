/**
 * La scène du plateau : le plateau 3D (three, chargé en différé) et, par-dessus, les incrustations
 * (qui joue, ce qui vient d'arriver, la bulle de Dédé). Si WebGL est indisponible ou perdu : repli
 * automatique sur le plateau 2D (`Board`), même informations.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { hasTenueArt, tenueArtDir, tenueExtras, tenuePalette } from '@/components/ui/tenueArt'
import { chibiUrl } from '@/data/characters'
import { expressionIn } from '@/data/expressions'
import { DEFAULT_TENUE } from '@/data/tenues'
import { cn } from '@/lib/cn'
import { serverNow } from '@/features/soiree/useServerClock'
import { boardViewAt, type BoardView } from './anim'
import { boardOf } from './board'
import { Board } from './GameBoard'
import { MiniMap, type GridBox } from './MiniMap'
import type { Get } from './Parts'
import type { PartyScene, ScenePlayer } from './scene3d/PartyScene'
import type { DedePartyState } from './types'

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/** Image réellement disponible pour (perso, tenue, expression) : repli sur la tenue de base. */
function chibiSrc(slug: string, tenue: string | undefined, expression: string, thumb: boolean): string {
  const wanted = tenue || DEFAULT_TENUE
  const shown = hasTenueArt(slug, wanted) ? wanted : DEFAULT_TENUE
  const dir = shown === DEFAULT_TENUE ? 'default' : (tenueArtDir(shown, slug) ?? 'default')
  const expr = expressionIn([...tenuePalette(slug, shown), ...tenueExtras(slug, shown).map((x) => x.id)], expression)
  return chibiUrl(slug, expr, dir, thumb)
}

interface StageProps {
  s: DedePartyState
  view: BoardView
  get: Get
  /** Télé : pions en grande définition, ombres fines. */
  big?: boolean
  /** Incrustations sur le plateau 3D (haut : qui joue ; bas : Dédé ou le bouton de lancer). */
  top?: ReactNode
  bottom?: ReactNode
  /** Contenu du milieu du plateau 2D (repli sans WebGL). */
  center?: ReactNode
  className?: string
  /** Mon joueur (téléphone) : en grande taille, pendant le lancer, la caméra cadre mon pion (vue perso). */
  meId?: string
  /** Page de démo : la scène 3D une fois montée (mesures de performance). */
  onScene?: (scene: PartyScene | null) => void
}

export function Stage({ s, view, get, big, top, bottom, center, className, meId, onScene }: StageProps) {
  const onSceneRef = useRef(onScene)
  useEffect(() => {
    onSceneRef.current = onScene
  }, [onScene])
  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<PartyScene | null>(null)
  const [ready, setReady] = useState(false)
  const [flat, setFlat] = useState(() => !webglAvailable())
  const board = boardOf(s.map, s.size)
  const mapId = board.id
  const size = board.size
  const sRef = useRef(s)
  useEffect(() => {
    sRef.current = s
    sceneRef.current?.setPhase(s.phase)
  }, [s])

  const order = s.order.join()
  const players = useMemo<ScenePlayer[]>(
    () =>
      order
        .split(',')
        .filter(Boolean)
        .map((id) => {
          const p = get(id)
          return { id, color: p.color, url: chibiSrc(p.slug, p.equippedTenue, 'joie', !big), fallback: chibiUrl(p.slug, 'joie', 'default', !big) }
        }),
    [order, get, big],
  )
  const playersRef = useRef(players)
  useEffect(() => {
    playersRef.current = players
    sceneRef.current?.setPlayers(players)
  }, [players])

  // Montage de la scène (three chargé à la demande).
  useEffect(() => {
    if (flat) return
    let alive = true
    let scene: PartyScene | null = null
    import('./scene3d/PartyScene')
      .then(({ createPartyScene }) => {
        if (!alive || !host.current) return null
        return createPartyScene(host.current, {
          getView: () => boardViewAt(sRef.current, serverNow()),
          dedeUrl: chibiSrc('dede', 'host', 'joie', false),
          dedeFallback: chibiUrl('dede', 'joie', 'default', false),
          big,
          board: boardOf(mapId, size),
          onLost: () => setFlat(true),
        })
      })
      .then((sc) => {
        if (!sc) return
        if (!alive) return sc.dispose()
        scene = sc
        sceneRef.current = sc
        onSceneRef.current?.(sc)
        sc.setPhase(sRef.current.phase)
        sc.setPlayers(playersRef.current)
        setReady(true)
      })
      .catch((e) => {
        console.warn('[dede-party] plateau 3D indisponible', e)
        if (alive) setFlat(true)
      })
    return () => {
      alive = false
      sceneRef.current = null
      scene?.dispose()
      setReady(false)
    }
    // Le plateau ne change pas pendant une partie : la scène n'est recréée que si l'on change de plateau (ou de taille).
  }, [flat, big, mapId, size])

  // Vue perso (téléphone, grandes tailles) : la caméra cadre mon pion pendant le lancer.
  const focusId = !big && size !== 's' && meId && s.players.includes(meId) ? meId : null
  useEffect(() => {
    if (ready) sceneRef.current?.setFocus(focusId)
  }, [focusId, ready])

  // Bouton « 🗺️ » (téléphone, grandes tailles) : mini-carte plein cadre et vue d'ensemble forcée.
  const [mapOpen, setMapOpen] = useState(false)
  const showMap = mapOpen && !big && size !== 's'
  useEffect(() => {
    if (ready) sceneRef.current?.setOverview(showMap)
  }, [showMap, ready])
  // Télé : mini-carte dans le coin (taille L : toujours ; taille M : pendant les déplacements), avec le cadre de la caméra.
  const tvMap = Boolean(big) && !flat && (size === 'l' || (size === 'm' && s.phase === 'move'))
  const frame = useViewFrame(sceneRef, tvMap && ready)

  if (flat) {
    // Repli 2D : tout est dans le plateau (le milieu porte qui joue et Dédé).
    if (big && size !== 's') {
      // Grandes tailles à la télé : le plateau entier à l'échelle, le milieu au-dessus.
      return (
        <div className="flex size-full flex-col items-center gap-2">
          {center && (
            <div className="shrink-0" style={{ zoom: 0.5 }}>
              {center}
            </div>
          )}
          <div className="flex min-h-0 w-full flex-1 items-center justify-center" style={{ containerType: 'size' }}>
            <div style={{ width: `min(100cqw, calc(100cqh * ${board.cols} / ${board.rows}))` }}>
              <Board s={s} view={view} get={get} big />
            </div>
          </div>
        </div>
      )
    }
    if (big) {
      return (
        <div className="flex size-full items-center justify-center" style={{ containerType: 'size' }}>
          <div style={{ width: `min(100cqw, calc(100cqh * ${board.cols} / ${board.rows}))` }}>
            <Board s={s} view={view} get={get} center={center ? <div style={{ zoom: 0.62 }}>{center}</div> : undefined} />
          </div>
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center gap-2">
        <Board s={s} view={view} get={get} portrait center={center} meId={meId} />
        {bottom}
      </div>
    )
  }

  return (
    <div className={cn('sticker relative w-full overflow-hidden bg-sunk select-none', className)} role="group" aria-label={board.name}>
      <div ref={host} className="absolute inset-0" />
      <AnimatePresence>
        {!ready && (
          <motion.div exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-sunk" aria-busy="true">
            <motion.p animate={{ rotate: [0, 14, -10, 0], scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.1 }} className={big ? 'text-8xl' : 'text-5xl'} aria-hidden>
              🎬
            </motion.p>
            <p className={cn('font-display font-extrabold text-muted', big ? 'text-3xl' : 'text-base')}>On installe le plateau…</p>
          </motion.div>
        )}
      </AnimatePresence>
      {ready && top && <div className={cn('pointer-events-none absolute inset-x-0 top-0 flex justify-center', big ? 'p-4' : 'p-2')}>{top}</div>}
      {ready && bottom && <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 flex justify-center', big ? 'p-4' : 'p-2', tvMap && 'pl-[min(240px,28%)]')}>{bottom}</div>}
      {ready && tvMap && (
        <div className="pointer-events-none absolute bottom-3 left-3 h-[min(130px,22%)] w-[min(210px,24%)] opacity-90">
          <MiniMap board={board} snap={view.snap} order={s.order} get={get} highlight={view.mover?.id ?? null} frame={frame} fit className="size-full" />
        </div>
      )}
      {ready && !big && size !== 's' && (
        <>
          <AnimatePresence>
            {showMap && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="absolute inset-0 z-20 flex flex-col gap-1 bg-paper/90 p-2 pt-14 backdrop-blur-[2px]"
              >
                <MiniMap board={board} snap={view.snap} order={s.order} get={get} meId={meId} highlight={view.mover?.id ?? null} orient="ccw" fit className="min-h-0 w-full flex-1" />
              </motion.div>
            )}
          </AnimatePresence>
          <button
            type="button"
            onClick={() => setMapOpen((x) => !x)}
            className={cn('sticker-sm absolute top-2 right-2 z-30 flex h-11 min-w-11 items-center justify-center px-2 font-display text-2xl leading-none active:translate-y-0.5', showMap ? 'bg-sun text-[#1f1b2e]' : 'bg-surface')}
            aria-label={showMap ? 'Revenir au plateau' : 'Voir la carte du plateau'}
            aria-pressed={showMap}
          >
            {showMap ? '✕' : '🗺️'}
          </button>
        </>
      )}
    </div>
  )
}

/** Cadre de la caméra (grille brute), relu ~5 fois par seconde tant que `on`. */
function useViewFrame(sceneRef: RefObject<PartyScene | null>, on: boolean): GridBox | null {
  const [frame, setFrame] = useState<GridBox | null>(null)
  useEffect(() => {
    if (!on) return
    const read = () => {
      const f = sceneRef.current?.viewFrame() ?? null
      setFrame((old) => {
        if (old === f) return old
        if (old && f && old.c0 === f.c0 && old.r0 === f.r0 && old.c1 === f.c1 && old.r1 === f.r1) return old
        return f ? { ...f } : null
      })
    }
    read()
    const id = window.setInterval(read, 200)
    return () => clearInterval(id)
  }, [sceneRef, on])
  return on ? frame : null
}

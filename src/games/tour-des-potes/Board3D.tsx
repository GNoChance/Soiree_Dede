/**
 * Plateau 3D (three) : charge la scène en différé, la tient à jour depuis le
 * state, affiche le HUD (statut, « Vue 2D », recentrer, invite à piocher).
 * Si WebGL est indisponible, prévient le parent (repli sur le plateau 2D).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hand, LocateFixed, Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { playerOrPlaceholder } from '@/features/soiree/players'
import type { PlayerInfo } from '../types'
import { CARD_AMOUNT_SIGN, cardKeyOf, eur, nowLine } from './format'
import { ownerOf, pendingCard } from './rules'
import type { SceneReveal, SceneView, TdpScene } from './scene3d/TdpScene'
import type { TdpState } from './types'
import { DICE_MS, DRAW_ANIM_MS } from './usePlayback'

interface Props {
  s: TdpState
  players: Record<string, PlayerInfo>
  meId: string
  name: (id: string | null | undefined) => string
  shownPos: Record<string, number>
  selected: number | null
  onCell: (i: number) => void
  onDraw: () => void
  drawPending: boolean
  /** Une carte est affichée en grand (overlay) : la scène range la carte 3D. */
  cardShowing: boolean
  onTwoD: () => void
  onUnsupported: () => void
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function Board3D({ s, players, meId, name, shownPos, selected, onCell, onDraw, drawPending, cardShowing, onTwoD, onUnsupported }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<TdpScene | null>(null)
  const [ready, setReady] = useState(false)
  const initialCard = useState(() => cardKeyOf(s))[0]
  const cb = useRef({ onCell, onDraw, onUnsupported })
  useEffect(() => {
    cb.current = { onCell, onDraw, onUnsupported }
  })

  const draw = pendingCard(s)
  const myDraw = s.phase === 'card' && s.turn === meId

  const moving = useMemo(() => {
    for (const id of s.order) if (shownPos[id] !== undefined && shownPos[id] !== s.pos[id]) return id
    return null
  }, [s.order, s.pos, shownPos])

  const ownerColor = useMemo(() => {
    const out: Record<number, string> = {}
    for (const k of Object.keys(s.owners)) {
      const o = ownerOf(s, Number(k))
      if (o) out[Number(k)] = playerOrPlaceholder(players, o).color
    }
    return out
  }, [s, players])

  const scenePlayers = useMemo(
    () =>
      s.order.map((id) => {
        const p = playerOrPlaceholder(players, id)
        return { id, color: p.color, slug: p.slug, expression: p.equipped, tenue: p.equippedTenue }
      }),
    [s.order, players],
  )

  const reveal = useMemo<SceneReveal | null>(() => {
    const c = s.last_event?.card
    const key = cardKeyOf(s)
    if (!c || !key || key === initialCard) return null
    const sign = CARD_AMOUNT_SIGN[c.kind]
    return {
      key,
      deck: c.deck,
      text: c.text,
      amountText: sign && c.amount ? `${sign > 0 ? '+' : '−'}${eur(Math.abs(c.amount))}` : null,
      positive: sign === 1,
      extra: c.kind === 'jail' ? '🚔 Direction le violon !' : c.kind === 'jail_card' ? '🎟️ Sortie du violon' : null,
    }
  }, [s, initialCard])

  const canDraw = myDraw && !drawPending && !moving
  const view = useMemo<SceneView>(
    () => ({
      players: scenePlayers,
      pos: shownPos,
      turn: s.turn,
      jail: Object.keys(s.jail),
      bankrupt: s.bankrupt,
      ownerColor,
      levels: Object.fromEntries(Object.entries(s.buildings).map(([k, v]) => [Number(k), v])),
      selected,
      dice: s.dice ?? s.last_event?.dice ?? null,
      rollNo: s.last_event?.no ?? 0,
      moving,
      deckFocus: draw?.deck ?? null,
      canDraw,
      reveal,
      cardShowing,
    }),
    [scenePlayers, shownPos, s.turn, s.jail, s.bankrupt, ownerColor, s.buildings, selected, s.dice, s.last_event, moving, draw?.deck, canDraw, reveal, cardShowing],
  )
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
    sceneRef.current?.update(view)
  }, [view])

  // Montage de la scène (three chargé à la demande).
  useEffect(() => {
    let alive = true
    let scene: TdpScene | null = null
    if (!webglAvailable()) {
      cb.current.onUnsupported()
      return
    }
    import('./scene3d/TdpScene')
      .then(({ createScene }) => {
        if (!alive || !host.current) return null
        return createScene(host.current, {
          rollMs: DICE_MS,
          drawMs: DRAW_ANIM_MS,
          onCell: (i) => cb.current.onCell(i),
          onDeck: () => cb.current.onDraw(),
          onLost: () => cb.current.onUnsupported(),
        })
      })
      .then((sc) => {
        if (!sc) return
        if (!alive) {
          sc.dispose()
          return
        }
        scene = sc
        sceneRef.current = sc
        sc.update(viewRef.current)
        setReady(true)
      })
      .catch((e) => {
        console.warn('[tour-des-potes] plateau 3D indisponible', e)
        if (alive) cb.current.onUnsupported()
      })
    return () => {
      alive = false
      sceneRef.current = null
      scene?.dispose()
    }
  }, [])

  const recenter = useCallback(() => sceneRef.current?.resetCamera(), [])
  const waiting = s.phase === 'card' && !myDraw && !moving

  return (
    <div className="sticker relative w-full overflow-hidden bg-sunk select-none" role="group" aria-label="Plateau 3D du Tour des Potes">
      <div ref={host} className="aspect-[1/0.84] max-h-[72dvh] w-full" />
      {!ready && (
        <div className="absolute inset-0 flex animate-pulse flex-col items-center justify-center gap-2 bg-sunk" aria-busy="true">
          <p className="text-4xl" aria-hidden>
            🎲
          </p>
          <p className="font-display text-sm font-extrabold text-muted">Plateau en préparation…</p>
        </div>
      )}
      {ready && (
        <>
          <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
            <button type="button" onClick={onTwoD} className="pointer-events-auto sticker-sm flex min-h-9 items-center gap-1 bg-surface/90 px-2.5 py-1 font-display text-xs font-extrabold text-text">
              <Square className="size-3.5" strokeWidth={3} /> Vue 2D
            </button>
            <p className="sticker-sm min-w-0 flex-1 bg-surface/90 px-2 py-1 text-center text-[11px] leading-tight font-extrabold text-text" aria-live="polite">
              {nowLine(s, name, meId)}
            </p>
            <button type="button" aria-label="Recentrer la caméra" onClick={recenter} className="pointer-events-auto sticker-sm flex size-9 items-center justify-center bg-surface/90 text-text">
              <LocateFixed className="size-4" strokeWidth={3} />
            </button>
          </div>
          {(myDraw || waiting) && (
            <div className="pointer-events-none absolute inset-x-3 bottom-2 flex flex-col items-center gap-2">
              {myDraw ? (
                <>
                  <p className="sticker-sm flex items-center gap-1.5 bg-sun px-3 py-1.5 font-display text-sm font-extrabold text-[#1f1b2e]">
                    <Hand className="size-4" strokeWidth={3} /> Touche le paquet pour piocher
                  </p>
                  <Button size="sm" className="pointer-events-auto" disabled={!canDraw} onClick={onDraw}>
                    Piocher une carte
                  </Button>
                </>
              ) : (
                <p className="sticker-sm bg-surface/95 px-3 py-1.5 font-display text-sm font-extrabold text-text">{name(s.turn)} pioche une carte…</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

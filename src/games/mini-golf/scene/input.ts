/**
 * Geste « lance-pierre » : on pose le doigt N'IMPORTE OÙ, on tire en arrière, on lâche.
 * Le tir part à l'opposé du glissé ; la longueur du glissé donne la puissance.
 * Revenir près du point de départ (moins de CANCEL_PX) puis lâcher = annuler.
 */
export const CANCEL_PX = 16

export interface Drag {
  /** Glissé en pixels écran (fin − début). */
  dx: number
  dy: number
  /** Puissance 0..1. */
  power: number
}

export interface InputHandlers {
  enabled: () => boolean
  onStart?: () => void
  onDrag: (d: Drag | null) => void
  onRelease: (d: Drag | null) => void
}

export function attachInput(el: HTMLElement, h: InputHandlers): () => void {
  let id: number | null = null
  let sx = 0
  let sy = 0
  let last: Drag | null = null

  const read = (e: PointerEvent): Drag | null => {
    const dx = e.clientX - sx
    const dy = e.clientY - sy
    const len = Math.hypot(dx, dy)
    if (len < CANCEL_PX) return null
    const full = Math.max(140, Math.min(el.clientWidth, el.clientHeight) * 0.42)
    return { dx, dy, power: Math.min(1, (len - CANCEL_PX * 0.5) / full) }
  }
  const down = (e: PointerEvent) => {
    if (id !== null || !h.enabled()) return
    id = e.pointerId
    sx = e.clientX
    sy = e.clientY
    last = null
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* navigateur sans capture */
    }
    h.onStart?.()
    h.onDrag(null)
  }
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    if (!h.enabled()) {
      cancel()
      return
    }
    last = read(e)
    h.onDrag(last)
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return
    id = null
    const d = h.enabled() ? read(e) ?? null : null
    h.onRelease(d && last ? d : null)
  }
  const cancel = () => {
    if (id === null) return
    id = null
    h.onRelease(null)
  }
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', cancel)
  return () => {
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', cancel)
  }
}

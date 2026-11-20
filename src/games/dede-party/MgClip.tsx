import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import type { MgKind } from './types'

/** Fond de chaque clip (celui de sa première image) : pas de cadre noir avant que la vidéo ne s'affiche. */
const CLIP_BG: Record<MgKind, string> = { quiz: '#DFF4FF', pif: '#FFE9D2', majorite: '#FFE1E8', buzzer: '#EF476F', etoiles: '#2A2458', chrono: '#DFF9EE' }
const RATIO = '632 / 422'
/** Les unités `cqh` (hauteur du panneau télé) : sans elles, pas de clip à la télé plutôt qu'une annonce qui déborde. */
const CQ_OK = typeof CSS !== 'undefined' && CSS.supports('height', '1cqh')

/**
 * Télé : le clip prend la hauteur qui reste dans le panneau (unités `cqh` du panneau, voir TvView), 360 px au plus,
 * une fois retiré `reserve` (tout le reste de l'annonce). `--mg-on` vaut 0 ou 1px : sous 140 px de haut disponibles,
 * le clip disparaît complètement (hauteur, bordure et ombre à zéro) au lieu de faire déborder l'annonce.
 */
const tvStyle = (reserve: number, bg: string): CSSProperties => ({
  ['--mg-on' as string]: `clamp(0px, calc((100cqh - ${reserve + 140}px) * 9999), 1px)`,
  height: `min(360px, max(0px, calc(100cqh - ${reserve}px)), calc(var(--mg-on) * 9999))`,
  aspectRatio: RATIO,
  border: 'calc(var(--mg-on) * 3) solid var(--ink)',
  borderRadius: 'var(--radius-card)',
  boxShadow: 'calc(var(--mg-on) * 6) calc(var(--mg-on) * 6) 0 0 var(--ink)',
  background: bg,
})

/**
 * Clip « échauffement » d'un mini-jeu : 6 s, muet, en boucle, qui montre le geste à faire
 * (public/tutos/dede-party/mg-<kind>.mp4, rendus par promo-video : `npm run render:mg`).
 * Monté dès le début de l'annonce pour se charger pendant la roulette, il n'apparaît qu'à la révélation (`show`).
 * S'il ne charge pas ou ne peut pas se lancer, il ne rend rien : l'écran d'annonce reste tel quel.
 */
export function MgClip({ kind, show, big, reserve = 580 }: { kind: MgKind; show: boolean; big?: boolean; reserve?: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'wait' | 'ok' | 'ko'>('wait')
  const on = show && state === 'ok'
  const ready = () => setState((s) => (s === 'wait' ? 'ok' : s))

  // Chargement : la lecture muette est autorisée sans geste, même cachée (sur iOS, c'est elle qui lance le téléchargement).
  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = true
    v.play().catch(() => {})
  }, [])

  // Révélation : on repart de la première image.
  useEffect(() => {
    const v = ref.current
    if (!on || !v) return
    v.currentTime = 0
    v.play().catch(() => setState('ko'))
  }, [on])

  if (state === 'ko' || (big && !CQ_OK)) return null
  const bg = CLIP_BG[kind]
  return (
    <motion.div
      aria-hidden
      initial={false}
      animate={on ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 }}
      transition={on ? { type: 'spring', stiffness: 300, damping: 16, delay: 0.2 } : { duration: 0 }}
      className={cn('overflow-hidden', on ? 'shrink-0' : 'pointer-events-none absolute top-0 left-0 size-px', on && !big && 'sticker')}
      style={on ? (big ? tvStyle(reserve, bg) : { width: 'min(100%, 46vh)', aspectRatio: RATIO, background: bg }) : undefined}
    >
      <video
        ref={ref}
        src={`/tutos/dede-party/mg-${kind}.mp4`}
        className="pointer-events-none block size-full object-cover"
        muted
        playsInline
        loop
        autoPlay
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        onLoadedData={ready}
        onPlaying={ready}
        onError={() => setState('ko')}
      />
    </motion.div>
  )
}

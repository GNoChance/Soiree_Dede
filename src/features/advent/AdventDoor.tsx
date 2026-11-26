import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { animate, motion, useMotionTemplate, useMotionValue, useTransform, type MotionValue } from 'framer-motion'
import { Rays, Sparks } from './AdventEffects'
import type { CaseStatus, DoorDef, DoorSize } from './layout'

const INK = '#1f1b2e'
/** Angle d'ouverture (degrés) : entrouverte et bien visible ; les grandes portes s'ouvrent moins pour ne pas cacher leurs voisines. */
const OPEN_DEG: Record<DoorSize, number> = { sm: 105, tall: 104, wide: 99, big: 96, front: 100 }
/** Rayon des coins des portes (suit la taille d'une case). */
const RADIUS = 'min(calc(var(--u) * 0.2), 12px)'

/** Taille du numéro et de l'emoji, en fraction d'une case (--u). */
const NUM: Record<DoorSize, number> = { sm: 0.54, wide: 0.6, tall: 0.62, big: 1.02, front: 1 }
const EMO: Record<DoorSize, number> = { sm: 0.62, wide: 0.74, tall: 0.8, big: 1.3, front: 1.55 }

export type DoorPhase = 'shake' | 'swing' | null

interface DoorProps {
  def: DoorDef
  /** Statut effectif (l'animation d'ouverture en cours est déjà prise en compte par le calendrier). */
  status: CaseStatus
  phase: DoorPhase
  emoji: string
  reduce: boolean
  onTap: () => void
  elRef: (el: HTMLElement | null) => void
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  opened: 'déjà ouverte',
  ready: 'à ouvrir !',
  today: 'finis le défi du jour pour l’ouvrir',
  future: 'pas encore',
  missed: 'ratée',
}

/** Décor imprimé du carton, selon le jour : uni, ruban, rayures, pois. */
function decoStyle(day: number): CSSProperties {
  switch (day % 4) {
    case 1:
      return { backgroundImage: 'linear-gradient(90deg, transparent 43%, rgba(255,255,255,.55) 43% 57%, transparent 57%)' }
    case 2:
      return { backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.2) 0 7px, transparent 7px 14px)' }
    case 3:
      return { backgroundImage: 'radial-gradient(rgba(255,255,255,.4) 22%, transparent 24%)', backgroundSize: '12px 12px' }
    default:
      return {}
  }
}

function Lock({ big }: { big?: boolean }) {
  return (
    <svg viewBox="0 0 20 24" style={{ width: `calc(var(--u) * ${big ? 0.5 : 0.3})` }} aria-hidden>
      <path d="M5 11V7.5a5 5 0 0 1 10 0V11" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M5 11V7.5a5 5 0 0 1 10 0V11" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="2" y="10.5" width="16" height="11.5" rx="3.5" fill="#fff3c4" stroke={INK} strokeWidth="2.2" />
      <circle cx="10" cy="16" r="1.9" fill={INK} />
    </svg>
  )
}

function Bow() {
  return (
    <svg viewBox="0 0 30 18" className="absolute left-1/2 z-[3]" style={{ width: 'calc(var(--u) * 0.62)', top: 'calc(var(--u) * -0.3)', transform: 'translateX(-50%)' }} aria-hidden>
      <ellipse cx="8" cy="9" rx="7.5" ry="4.6" transform="rotate(-24 8 9)" fill="#fff" stroke={INK} strokeWidth="2" />
      <ellipse cx="22" cy="9" rx="7.5" ry="4.6" transform="rotate(24 22 9)" fill="#fff" stroke={INK} strokeWidth="2" />
      <circle cx="15" cy="10" r="3.6" fill="#ef476f" stroke={INK} strokeWidth="2" />
    </svg>
  )
}

function Knob({ side, top = '50%' }: { side: 'left' | 'right'; top?: string }) {
  return (
    <span
      aria-hidden
      className="absolute rounded-full"
      style={{
        top,
        [side]: 'calc(var(--u) * 0.1)',
        width: 'calc(var(--u) * 0.15)',
        height: 'calc(var(--u) * 0.15)',
        marginTop: 'calc(var(--u) * 0.1)',
        background: 'radial-gradient(circle at 35% 30%, #fff6b0, #ffc400 60%)',
        border: `2px solid ${INK}`,
      }}
    />
  )
}

interface FaceProps {
  def: DoorDef
  status: CaseStatus
  /** Contenu du numéro (la double porte affiche un chiffre par battant). */
  digit: string
  hinge: 'left' | 'right'
}

/** Face avant d'un battant : carton coloré, numéro dessiné, poignée, signes du statut. */
function Front({ def, status, digit, hinge }: FaceProps) {
  const wide = def.w >= 2 && def.size !== 'front'
  const iconPx = def.size === 'big' ? 0.62 : def.size === 'front' ? 0.62 : 0.34
  const muted = status === 'future'
  return (
    <span
      className="absolute inset-0"
      style={{
        background: def.color,
        border: `3px solid ${INK}`,
        borderRadius: RADIUS,
        boxShadow: 'inset 0 -5px 0 rgba(0,0,0,.2), inset 0 4px 0 rgba(255,255,255,.42)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        filter: muted ? 'saturate(0.72) brightness(0.97)' : undefined,
      }}
    >
      <span className="absolute inset-0 overflow-hidden" style={{ borderRadius: `calc(${RADIUS} - 3px)`, ...decoStyle(def.day) }}>
        {status === 'ready' && (
          <span
            className="absolute inset-x-0"
            style={
              def.size === 'front'
                ? { top: '50%', height: '15%', background: 'linear-gradient(#ffd23f, #fff1a8, #ffd23f)', borderBlock: `2px solid ${INK}` }
                : { left: '41%', width: '18%', top: 0, bottom: 0, background: 'linear-gradient(90deg, #ffd23f, #fff1a8, #ffd23f)', borderInline: `2px solid ${INK}` }
            }
          />
        )}
      </span>
      {status === 'ready' && def.size !== 'front' && <Bow />}

      {status === 'missed' && (
        <span
          className="absolute inset-0"
          style={{
            borderRadius: `calc(${RADIUS} - 3px)`,
            background: 'linear-gradient(150deg, rgba(240,252,255,.8), rgba(168,214,245,.68) 52%, rgba(232,247,255,.82))',
            boxShadow: 'inset 0 0 10px 3px #fff',
          }}
        />
      )}
      <span className="absolute inset-0 flex flex-col items-center justify-center" style={{
          gap: 'calc(var(--u) * 0.04)',
          opacity: status === 'missed' ? 0.8 : 1,
          ...(def.size === 'front' ? (hinge === 'left' ? { paddingLeft: '26%' } : { paddingRight: '26%' }) : null),
        }}
      >
        <span className="advent-door-num" style={{ fontSize: `calc(var(--u) * ${NUM[def.size]})` }}>
          {digit}
        </span>
        {status === 'ready' && (
          <span className="flex items-center" style={{ gap: 'calc(var(--u) * 0.08)', fontSize: `calc(var(--u) * ${iconPx})`, lineHeight: 1 }}>
            <span>🎁</span>
            {wide && (
              <span
                className="rounded-full border-2 border-[#1f1b2e] bg-[#fff3c4] px-1.5 font-display font-extrabold whitespace-nowrap text-[#1f1b2e]"
                style={{ fontSize: 'calc(var(--u) * 0.26)', lineHeight: 1.35 }}
              >
                À ouvrir !
              </span>
            )}
          </span>
        )}
        {status === 'today' && (
          <span className="flex items-center" style={{ gap: 'calc(var(--u) * 0.08)' }}>
            <Lock big={def.size === 'big' || def.size === 'front'} />
            {wide && (
              <span
                className="rounded-full border-2 border-[#1f1b2e] bg-white/85 px-1.5 font-display font-extrabold whitespace-nowrap text-[#1f1b2e]"
                style={{ fontSize: 'calc(var(--u) * 0.2)', lineHeight: 1.35 }}
              >
                Défi du jour
              </span>
            )}
          </span>
        )}
      </span>

      <Knob side={hinge === 'left' ? 'right' : 'left'} top={def.size === 'front' ? '64%' : '50%'} />

      {status === 'missed' && (
        <span className="absolute inset-0 overflow-hidden" style={{ borderRadius: `calc(${RADIUS} - 3px)` }}>
          <span
            className="absolute top-1/2 left-1/2"
            style={{
              width: '150%',
              height: 'max(calc(var(--u) * 0.2), 9px)',
              transform: 'translate(-50%, -50%) rotate(-32deg)',
              background: 'linear-gradient(#fff, #bfe3ff)',
              border: '2px solid #5c9ccb',
              borderRadius: 99,
              boxShadow: '0 2px 0 rgba(31,27,46,.28)',
            }}
          />
          <span className="absolute top-[8%] left-[12%] opacity-80" style={{ fontSize: 'calc(var(--u) * 0.28)', lineHeight: 1 }}>❄</span>
          <span className="absolute right-[12%] bottom-[8%] opacity-80" style={{ fontSize: 'calc(var(--u) * 0.24)', lineHeight: 1 }}>❄</span>
        </span>
      )}
    </span>
  )
}

/** Envers du battant (visible quand la porte est ouverte) : carton uni, plus sombre. */
function Back({ color }: { color: string }) {
  return (
    <span
      className="absolute inset-0"
      style={{
        background: `repeating-linear-gradient(90deg, rgba(0,0,0,.1) 0 3px, transparent 3px 9px), ${color}`,
        filter: 'brightness(0.8)',
        border: `3px solid ${INK}`,
        borderRadius: RADIUS,
        transform: 'rotateY(180deg)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    />
  )
}

function Leaf({ hinge, rotateY, className, style, children }: { hinge: 'left' | 'right'; rotateY: MotionValue<number>; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <motion.span
      className={'absolute inset-y-0 ' + (className ?? '')}
      style={{ ...style, rotateY, transformOrigin: hinge === 'left' ? '0% 50%' : '100% 50%', transformStyle: 'preserve-3d' }}
    >
      {children}
    </motion.span>
  )
}

/**
 * Une porte du calendrier : alvéole (lumière + emoji) cachée derrière un battant de carton qui pivote sur sa charnière.
 * `phase` pilote la séquence d'ouverture (tremblement puis envol de l'emoji) ; le calendrier la contrôle.
 */
export function AdventDoor({ def, status, phase, emoji, reduce, onTap, elRef }: DoorProps) {
  const { day, size } = def
  const open = status === 'opened'
  const peek = status === 'ready' && phase === null
  const double = def.hinge === 'double'

  // 0 = fermée, 1 = grande ouverte (OPEN_DEG). Peut dépasser 1 : rebond du ressort.
  const p = useMotionValue(open ? 1 : 0)
  useEffect(() => {
    if (reduce) {
      p.set(open ? 1 : 0)
      return
    }
    const c = open
      ? animate(p, 1, { type: 'spring', stiffness: 62, damping: 9.5, mass: 0.9, delay: 0.05 })
      : peek
        ? animate(p, [0, 0.13, 0, 0.08, 0], { duration: 1.5, times: [0, 0.2, 0.45, 0.65, 1], repeat: Infinity, repeatDelay: 1.3 + (day % 5) * 0.35, delay: (day % 7) * 0.2 })
        : animate(p, 0, { type: 'spring', stiffness: 240, damping: 22 })
    return () => c.stop()
  }, [open, peek, reduce, p, day])

  const leftDeg = useTransform(p, (v) => v * -OPEN_DEG[size])
  const rightDeg = useTransform(p, (v) => v * OPEN_DEG[size])
  const sx = useTransform(p, (v) => Math.min(Math.max(v, 0), 1.25) * 8)
  const sy = useTransform(p, (v) => Math.min(Math.max(v, 0), 1.25) * 5)
  const blur = useTransform(p, (v) => Math.min(Math.max(v, 0), 1.25) * 4)
  const shadow = useMotionTemplate`drop-shadow(${sx}px ${sy}px ${blur}px rgba(20, 10, 50, 0.5))`

  // Le battant garde son habit de cadeau (ruban, noeud) pendant qu'il pivote.
  const faceStatus: CaseStatus = phase ? 'ready' : status
  const hingeSide = def.hinge === 'right' ? 'right' : 'left'
  const lightOn = open || status === 'ready' || phase === 'swing'
  const shaking = phase === 'shake'
  const swing = phase === 'swing'
  // Les grandes portes ont déjà un grand emoji : il jaillit moins fort.
  const peak = size === 'front' ? 1.9 : size === 'big' ? 2.1 : 2.7

  const wiggle = status === 'ready' && !shaking && !reduce
  const animateProp = shaking && !reduce
    ? { x: [0, -3, 3, -3, 3, -2, 2, 0], rotate: [0, -2.6, 2.6, -2.6, 2.6, -1.6, 1.6, 0], scale: 1.07 }
    : wiggle
      ? { rotate: [0, -3, 3, -3, 3, 0, 0, 0], scale: 1, x: 0 }
      : { x: 0, rotate: 0, scale: 1 }
  const transitionProp = shaking
    ? { duration: 0.42, repeat: Infinity, ease: 'linear' as const }
    : wiggle
      ? { duration: 3, repeat: Infinity, delay: (day % 6) * 0.3 }
      : { duration: 0.2 }

  const isRight = def.hinge === 'right'
  return (
    <motion.button
      ref={elRef}
      type="button"
      onClick={onTap}
      aria-label={`Case ${day} : ${STATUS_LABEL[status]}`}
      whileTap={{ scale: 0.94 }}
      animate={animateProp}
      transition={transitionProp}
      className="relative block cursor-pointer"
      style={{
        gridColumn: `${def.col} / span ${def.w}`,
        gridRow: `${def.row} / span ${def.h}`,
        zIndex: phase ? 40 : open ? 3 : status === 'ready' ? 2 : 1,
      }}
    >
      {/* halo des cases à ouvrir / anneau de la case du jour */}
      {status === 'ready' && !shaking && <span aria-hidden className="advent-glow pointer-events-none absolute -inset-1" style={{ borderRadius: `calc(${RADIUS} + 3px)` }} />}
      {status === 'today' && (
        <span aria-hidden className="advent-ring pointer-events-none absolute -inset-1" style={{ borderRadius: `calc(${RADIUS} + 4px)`, border: '3px dashed #fff3c4' }} />
      )}

      {/* alvéole : fond sombre, lumière dorée et emoji du jour */}
      <span
        aria-hidden
        className="absolute inset-0 overflow-hidden"
        style={{ background: '#3a2858', border: `3px solid ${INK}`, borderRadius: RADIUS, boxShadow: 'inset 5px 5px 0 rgba(0,0,0,.4)' }}
      >
        <span
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(circle at 50% 58%, #fffbe3 0%, #ffe48a 38%, #ffb52e 100%)',
            opacity: lightOn ? (status === 'ready' && phase === null ? 0.92 : 1) : 0,
            transition: reduce ? undefined : 'opacity 0.35s',
          }}
        />
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{ fontSize: `calc(var(--u) * ${EMO[size]})`, lineHeight: 1, opacity: open && !swing ? 1 : 0, filter: 'drop-shadow(0 2px 0 rgba(120,60,0,.35))' }}
        >
          {emoji}
        </span>
      </span>

      {/* battant(s) : perspective partagée, ombre portée qui s'allonge avec l'ouverture */}
      <motion.span aria-hidden className="pointer-events-none absolute inset-0" style={{ filter: shadow }}>
        <span className="absolute inset-0" style={{ perspective: '900px', perspectiveOrigin: '50% 50%' }}>
          {double ? (
            <>
              <Leaf hinge="left" rotateY={leftDeg} className="left-0 w-1/2">
                <Front def={def} status={faceStatus} digit="2" hinge="left" />
                <Back color={def.color} />
              </Leaf>
              <Leaf hinge="right" rotateY={rightDeg} className="right-0 w-1/2">
                <Front def={def} status={faceStatus} digit="4" hinge="right" />
                <Back color={def.color} />
              </Leaf>
            </>
          ) : (
            <Leaf hinge={hingeSide} rotateY={isRight ? rightDeg : leftDeg} className="inset-x-0">
              <Front def={def} status={faceStatus} digit={String(day)} hinge={hingeSide} />
              <Back color={def.color} />
            </Leaf>
          )}
        </span>
      </motion.span>

      {/* éruption : rayons, étincelles et emoji qui jaillit de la case */}
      {swing && !reduce && (
        <span aria-hidden className="pointer-events-none absolute inset-0 z-10">
          <Rays />
          <Sparks />
          <motion.span
            className="absolute top-1/2 left-1/2 flex items-center justify-center"
            style={{ width: '2em', height: '2em', marginLeft: '-1em', marginTop: '-1em', fontSize: `calc(var(--u) * ${EMO[size]})`, lineHeight: 1, filter: 'drop-shadow(0 4px 0 rgba(31,27,46,.35))' }}
            initial={{ scale: 0.2, y: 0, opacity: 0, rotate: -25 }}
            animate={{ scale: [0.2, peak, peak * 0.93, peak * 0.97, 1], y: ['0%', '-95%', '-82%', '-90%', '0%'], rotate: [-25, 14, -8, 6, 0], opacity: [0, 1, 1, 1, 1] }}
            transition={{ duration: 1.7, delay: 0.25, times: [0, 0.3, 0.5, 0.78, 1], ease: 'easeOut' }}
          >
            {emoji}
          </motion.span>
        </span>
      )}
    </motion.button>
  )
}

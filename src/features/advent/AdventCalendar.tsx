import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'framer-motion'
import { burst, confettiRain } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { AdventScene } from './AdventHouse'
import { AdventDoor, type DoorPhase } from './AdventDoor'
import { DOORS, GRID_COLS, type CaseStatus } from './layout'
import { ADVENT_TEXTS } from './texts'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Durées de la séquence d'ouverture (ms). */
const SHAKE_MIN = 750
const SWING = 1750

interface Props {
  /** Statut de chaque case, indexé par jour - 1 (24 entrées). */
  statuses: readonly CaseStatus[]
  /**
   * Ouvre la case côté serveur (appelé dès le tap, pendant que la porte tremble).
   * Si la promesse est rejetée, la porte se referme (la page a déjà affiché l'erreur).
   */
  onOpenDay: (day: number) => Promise<void>
  /** L'animation est terminée : la page peut afficher la récompense. */
  onRevealed: (day: number) => void
  /** Tap sur une case qui n'est pas à ouvrir (ouverte : revoir la surprise ; sinon : message). */
  onTapStatic: (day: number, status: CaseStatus) => void
}

/** Calendrier de l'Avent : la maison, ses 24 portes et la mise en scène de l'ouverture. Aucune donnée serveur ici. */
export function AdventCalendar({ statuses, onOpenDay, onRevealed, onTapStatic }: Props) {
  const reduce = !!useReducedMotion()
  const [opening, setOpening] = useState<{ day: number; phase: Exclude<DoorPhase, null> } | null>(null)
  // Cases ouvertes pendant cette visite : restent ouvertes même si les données n'ont pas encore suivi.
  const [justOpened, setJustOpened] = useState<ReadonlySet<number>>(() => new Set())
  const els = useRef(new Map<number, HTMLElement>())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const effective = (day: number): CaseStatus => {
    if (opening?.day === day) return opening.phase === 'shake' ? 'ready' : 'opened'
    if (justOpened.has(day)) return 'opened'
    return statuses[day - 1] ?? 'future'
  }

  const lit = useMemo(
    () => Array.from({ length: 24 }, (_, i) => i + 1).filter((d) => (opening?.day === d ? opening.phase === 'swing' : justOpened.has(d) || statuses[d - 1] === 'opened')).length,
    [opening, justOpened, statuses],
  )

  const run = async (day: number) => {
    setOpening({ day, phase: 'shake' })
    fx.rattle()
    try {
      await Promise.all([onOpenDay(day), sleep(reduce ? 0 : SHAKE_MIN)])
    } catch {
      if (alive.current) setOpening(null)
      return
    }
    if (!alive.current) return
    setJustOpened((s) => new Set(s).add(day))
    setOpening({ day, phase: 'swing' })
    fx.rip()
    fx.creak()
    window.setTimeout(() => {
      fx.fanfare()
      fx.sparkle()
    }, 260)
    if (!reduce) {
      const r = els.current.get(day)?.getBoundingClientRect()
      if (r) burst({ x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight }, 90)
      window.setTimeout(() => confettiRain(1500), 350)
    }
    await sleep(reduce ? 300 : SWING)
    if (!alive.current) return
    setOpening(null)
    onRevealed(day)
  }

  const tap = (day: number) => {
    if (opening) return
    const st = effective(day)
    if (st === 'ready') void run(day)
    else onTapStatic(day, st)
  }

  return (
    <AdventScene lit={lit}>
      <div
        className="grid"
        style={
          {
            '--gap': '5px',
            '--u': `calc((100cqw - ${GRID_COLS - 1} * var(--gap)) / ${GRID_COLS})`,
            gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
            gridAutoRows: 'calc(var(--u) * 1.14)',
            gap: 'var(--gap)',
          } as CSSProperties
        }
      >
        {DOORS.map((def) => (
          <AdventDoor
            key={def.day}
            def={def}
            status={effective(def.day)}
            phase={opening?.day === def.day ? opening.phase : null}
            emoji={ADVENT_TEXTS[def.day - 1].emoji}
            reduce={reduce}
            onTap={() => tap(def.day)}
            elRef={(el) => {
              if (el) els.current.set(def.day, el)
              else els.current.delete(def.day)
            }}
          />
        ))}
      </div>
    </AdventScene>
  )
}

import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { GameOptionsProps } from '../types'
import type { MgCourse, MgOptions } from './types'

export const MG_COURSES = ['random', 'kermesse', 'express', 'defi'] as const
export const MG_TIMERS = [60, 90, 0] as const
export const MG_DEFAULT_OPTIONS: MgOptions = { course: 'random', timer: 90 }

const COURSE_HELP: Record<MgCourse, string> = {
  random: '9 trous tirés au sort parmi les 20, du plus facile au plus dur (≈ 12 min).',
  kermesse: 'Les 9 trous de La Kermesse du village, dans l’ordre, par 26 (≈ 12 min).',
  express: '5 trous tirés au sort parmi les 20 (≈ 6 min).',
  defi: 'Le Défi : 9 longs trous au château hanté, au Far-West et à la station de ski, par 39 (≈ 20 min). Glace, vide, herses, tremplins… pour les costauds !',
}

/**
 * p_options de start_match : {course: random|kermesse|express|defi, timer: 60|90|0} (le serveur revalide et tire les trous).
 * Anciennes options {holes: 9|5} : 9 = La Kermesse, 5 = express.
 */
export function normalizeOptions(o: Record<string, unknown>): Record<string, unknown> {
  const timer = Number(o.timer)
  const legacy = o.course === undefined ? (Number(o.holes) === 9 ? 'kermesse' : Number(o.holes) === 5 ? 'express' : undefined) : undefined
  const course = (MG_COURSES as readonly unknown[]).includes(o.course) ? (o.course as MgCourse) : (legacy ?? MG_DEFAULT_OPTIONS.course)
  return {
    course,
    timer: o.timer !== undefined && (MG_TIMERS as readonly number[]).includes(timer) ? timer : MG_DEFAULT_OPTIONS.timer,
  }
}

export function MiniGolfOptions({ options, onChange }: GameOptionsProps) {
  const o = normalizeOptions(options)
  const course = o.course as MgCourse
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Parcours</span>
        <SegmentedControl
          ariaLabel="Parcours"
          value={course}
          onChange={(v) => onChange({ ...options, course: v })}
          options={[
            { value: 'random', label: '🎲 Aléatoire' },
            { value: 'kermesse', label: 'Kermesse' },
            { value: 'express', label: 'Express' },
            { value: 'defi', label: '🏔️ Défi' },
          ]}
        />
        <p className="text-sm text-muted">{COURSE_HELP[course]}</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Chrono par trou</span>
        <SegmentedControl
          ariaLabel="Chrono par trou"
          value={String(o.timer)}
          onChange={(v) => onChange({ ...options, timer: Number(v) })}
          options={MG_TIMERS.map((n) => ({ value: String(n), label: n ? `${n} s` : 'Sans' }))}
        />
        <p className="text-sm text-muted">
          {o.timer ? 'À la fin du chrono, ceux qui n’ont pas rentré leur balle marquent 7.' : 'Sans chrono : l’hôte passe au trou suivant quand il veut.'}
        </p>
      </div>
    </div>
  )
}

import { Avatar } from '@/components/ui/Avatar'
import { fmtDuration } from '@/features/stats/api'
import type { AlbumSoiree } from './api'

/** Couverture du livre : « Les Soirées de Dédé — AAAA » + quelques chiffres et les habitués. */
export function AlbumCover({ year, soirees }: { year: number; soirees: AlbumSoiree[] }) {
  const games = soirees.reduce((n, s) => n + s.games_played, 0)
  const minutes = soirees.reduce((n, s) => n + s.duration_min, 0)
  const count = new Map<string, { p: AlbumSoiree['players'][number]; n: number }>()
  for (const s of soirees) for (const p of s.players) count.set(p.profile_id, { p, n: (count.get(p.profile_id)?.n ?? 0) + 1 })
  const regulars = [...count.values()].sort((a, b) => b.n - a.n).slice(0, 5)
  return (
    <div className="album-leaf flex flex-col items-center gap-4 rounded-card border-[3px] border-ink bg-sun p-6 text-center text-[#1f1b2e] shadow-sticker">
      <span className="text-6xl">📖</span>
      <h2 className="text-4xl font-extrabold leading-tight">Les Soirées de Dédé</h2>
      <p className="text-5xl font-extrabold">{year}</p>
      {soirees.length === 0 ? (
        <p className="font-bold">Aucune soirée terminée cette année pour le moment. Le livre se remplira tout seul !</p>
      ) : (
        <>
          <p className="text-lg font-bold">
            {soirees.length} soirée{soirees.length > 1 ? 's' : ''} · {games} partie{games > 1 ? 's' : ''} · {fmtDuration(minutes)} de bonne humeur
          </p>
          <div className="flex justify-center -space-x-2">
            {regulars.map(({ p }) => (
              <Avatar key={p.profile_id} slug={p.slug} tenue={p.equipped_tenue} frame={null} size={56} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

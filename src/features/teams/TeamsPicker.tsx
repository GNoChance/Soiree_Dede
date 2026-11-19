import { LayoutGroup, motion } from 'framer-motion'
import { Shuffle } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { fx } from '@/lib/feedback'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { TEAM_COLORS, TEAM_INFO, distributeTeams, type TeamColor, type TeamCount } from './teams'

type Teams = Partial<Record<TeamColor, string[]>>
type Slot = TeamColor | 'bench'

/**
 * Sélecteur 2 à 4 équipes + banc (réutilisable). Toucher un avatar le fait passer à l'équipe
 * suivante (… → banc → première équipe). Les joueurs absents de `playerIds` sont ignorés ;
 * un joueur placé nulle part est sur le banc.
 */
export function TeamsPicker({
  teamCount,
  teams,
  playerIds,
  onChange,
}: {
  teamCount: TeamCount
  teams: Teams
  playerIds: string[]
  onChange: (teams: Teams, teamCount: TeamCount) => void
}) {
  const { byId } = usePlayers()
  const colors = TEAM_COLORS.slice(0, teamCount)
  const present = new Set(playerIds)
  const cols: Record<TeamColor, string[]> = Object.fromEntries(
    colors.map((c) => [c, (teams[c] ?? []).filter((id) => present.has(id))]),
  ) as Record<TeamColor, string[]>
  const placed = new Set(colors.flatMap((c) => cols[c]))
  const bench = playerIds.filter((id) => !placed.has(id))
  const counts = ([2, 3, 4] as const).filter((n) => n === 2 || playerIds.length >= n * 2)

  const slotOf = (id: string): Slot => colors.find((c) => cols[c].includes(id)) ?? 'bench'
  const order: Slot[] = [...colors, 'bench']
  const move = (id: string) => {
    const from = slotOf(id)
    const to = order[(order.indexOf(from) + 1) % order.length]
    const next: Teams = Object.fromEntries(colors.map((c) => [c, cols[c].filter((x) => x !== id)]))
    if (to !== 'bench') next[to] = [...(next[to] ?? []), id]
    fx.whoosh()
    onChange(next, teamCount)
  }
  const mix = (n: TeamCount) => {
    fx.pop()
    onChange(distributeTeams(playerIds, n), n)
  }

  if (!playerIds.length) return <p className="text-sm text-muted">Chargement des joueurs…</p>
  const tooSmall = colors.some((c) => cols[c].length < 2)

  const token = (id: string) => {
    const p = playerOrPlaceholder(byId, id)
    const to = order[(order.indexOf(slotOf(id)) + 1) % order.length]
    return (
      <motion.button
        key={id}
        type="button"
        layout
        layoutId={`teams-picker-${id}`}
        whileTap={{ scale: 0.9 }}
        onClick={() => move(id)}
        className="flex w-16 flex-col items-center"
        aria-label={`${p.nickname} : passer ${to === 'bench' ? 'sur le banc' : `chez les ${TEAM_INFO[to].short}`}`}
      >
        <Avatar slug={p.slug} tenue={p.equippedTenue} size={44} />
        <span className="w-full truncate text-center text-xs font-extrabold">{p.nickname}</span>
      </motion.button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {counts.length > 1 && (
        <SegmentedControl
          ariaLabel="Nombre d’équipes"
          value={String(teamCount)}
          onChange={(v) => mix(Number(v) as TeamCount)}
          options={counts.map((n) => ({ value: String(n), label: `${n} équipes` }))}
        />
      )}
      <LayoutGroup>
        <div className="grid grid-cols-2 gap-2">
          {colors.map((c) => {
            const meta = TEAM_INFO[c]
            return (
              <div key={c} className="sticker-sm flex min-h-28 flex-col gap-1.5 rounded-card p-2" style={{ backgroundColor: meta.soft, color: '#1f1b2e' }}>
                <p className="text-center font-display text-base font-extrabold" style={{ color: meta.color }}>
                  {meta.emoji} {meta.short} · {cols[c].length}
                </p>
                <div className="flex flex-wrap justify-center gap-1.5">{cols[c].map(token)}</div>
              </div>
            )
          })}
          <div className="sticker-sm col-span-2 flex flex-col gap-1.5 rounded-card bg-sunk p-2">
            <p className="text-center font-display text-base font-extrabold">👀 Banc · {bench.length}</p>
            {bench.length ? (
              <div className="flex flex-wrap justify-center gap-1.5">{bench.map(token)}</div>
            ) : (
              <p className="text-center text-xs text-muted">Personne : tout le monde joue.</p>
            )}
          </div>
        </div>
      </LayoutGroup>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">Touche un avatar pour le changer d’équipe (ou le mettre sur le banc).</p>
        <Button variant="secondary" size="sm" icon={<Shuffle className="size-4" />} onClick={() => mix(teamCount)}>
          Mélanger
        </Button>
      </div>
      {tooSmall && <p className="text-sm font-bold text-tomato">Il faut au moins 2 joueurs par équipe (sinon on mélange au lancement).</p>}
    </div>
  )
}

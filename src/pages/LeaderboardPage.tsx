import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Crown } from 'lucide-react'
import { getCharacter } from '@/data/characters'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Skeleton } from '@/components/ui/Skeleton'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'
import { rpcErrorMessage } from '@/lib/rpcError'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { useSession } from '@/store/session'
import type { ExpressionId, GameId, UUID } from '@/types/db'

type Board = 'general' | GameId
type Scope = 'all' | 'friends'

interface Row {
  profile_id: UUID
  slug: string
  nickname: string
  equipped_expression: ExpressionId
  equipped_tenue: string
  wins: number
  games_played: number
  level: number
  points?: number
  rank: number
}

/** Classement « compétition » (1,1,3…) sur les victoires, recalculé après filtrage. */
function reRank(rows: Row[]): Row[] {
  let prev = -1
  let rank = 0
  return rows.map((r, i) => {
    if (r.wins !== prev || r.points !== rows[i - 1]?.points) rank = i + 1
    prev = r.wins
    return { ...r, rank }
  })
}

const podiumExpr = (slug: string, ...wanted: ExpressionId[]): ExpressionId =>
  wanted.find((e) => getCharacter(slug)?.expressions.includes(e)) ?? 'joie'

export function LeaderboardPage() {
  const me = useSession((s) => s.profile?.id)
  const [board, setBoard] = useState<Board>('general')
  const [scope, setScope] = useState<Scope>('all')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [friendIds, setFriendIds] = useState<Set<UUID>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!me) return
    try {
      const [gen, fr, game] = await Promise.all([
        supabase.from('leaderboard_general').select('*').order('rank', { ascending: true }),
        supabase
          .from('friendships')
          .select('*')
          .eq('status', 'accepted')
          .or(`requester_id.eq.${me},addressee_id.eq.${me}`),
        board === 'general'
          ? Promise.resolve(null)
          : supabase.from('leaderboard_by_game').select('*').eq('game_id', board).order('rank', { ascending: true }),
      ])
      if (gen.error) throw gen.error
      if (fr.error) throw fr.error
      if (game?.error) throw game.error
      const levels = new Map((gen.data ?? []).map((g) => [g.profile_id, g.level]))
      const mapped: Row[] =
        board === 'general'
          ? (gen.data ?? []).map((g) => ({ ...g, level: g.level }))
          : (game?.data ?? []).map((g) => ({ ...g, level: levels.get(g.profile_id) ?? 1, points: g.points_total }))
      setRows(mapped)
      setFriendIds(new Set((fr.data ?? []).map((f) => (f.requester_id === me ? f.addressee_id : f.requester_id))))
      setError(null)
    } catch (e) {
      setError(rpcErrorMessage(e))
    }
  }, [me, board])

  useEffect(() => {
    void load()
  }, [load])
  useRefetchOnFocus(() => void load())

  const changeBoard = (b: Board) => {
    setRows(null)
    setBoard(b)
  }

  const visible = rows
    ? reRank(scope === 'friends' ? rows.filter((r) => r.profile_id === me || friendIds.has(r.profile_id)) : rows)
    : null
  const podium = visible?.filter((r) => r.games_played > 0 && r.rank <= 3).slice(0, 3) ?? []
  const rest = visible?.filter((r) => !podium.includes(r)) ?? []

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-4xl">Classement</h1>
      <SegmentedControl<Board>
        ariaLabel="Jeu"
        value={board}
        onChange={changeBoard}
        options={[
          { value: 'general', label: 'Général' },
          { value: 'qui-de-nous', label: 'Qui de nous ?' },
          { value: 'undercover', label: 'Undercover' },
        ]}
      />
      <SegmentedControl<Scope>
        ariaLabel="Portée"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'all', label: 'Tous' },
          { value: 'friends', label: 'Mes amis' },
        ]}
      />

      {error ? (
        <p className="text-center font-bold text-tomato">{error}</p>
      ) : !visible ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-44 rounded-card" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-card" />
          ))}
        </div>
      ) : (
        <motion.div key={`${board}-${scope}`} className="flex flex-col gap-4" initial="hidden" animate="show">
          {podium.length === 0 ? (
            <p className="sticker rounded-card bg-surface p-5 text-center font-display text-lg font-bold text-muted">
              Personne n'a encore joué ici. Lancez une soirée !
            </p>
          ) : (
            <Podium rows={podium} me={me} />
          )}
          <StaggerList className="flex flex-col gap-2.5">
            {rest.map((r) => (
              <StaggerItem key={r.profile_id}>
                <RowCard row={r} me={r.profile_id === me} game={board !== 'general'} />
              </StaggerItem>
            ))}
          </StaggerList>
        </motion.div>
      )}
    </div>
  )
}

function Podium({ rows, me }: { rows: Row[]; me?: UUID }) {
  // Disposition 2 - 1 - 3
  const first = rows[0]
  const second = rows[1]
  const third = rows[2]
  const slots = [
    { row: second, h: 96, medal: '🥈', color: 'bg-sky' },
    { row: first, h: 132, medal: '🥇', color: 'bg-sun' },
    { row: third, h: 70, medal: '🥉', color: 'bg-tangerine' },
  ]
  return (
    <div className="flex items-end justify-center gap-2 pt-6">
      {slots.map(({ row, h, medal, color }, i) => (
        <div key={i} className="flex w-1/3 flex-col items-center">
          {row && (
            <>
              <motion.div
                initial={{ y: -80, opacity: 0, scale: 0.5 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.5 + i * 0.12 }}
                className="relative"
              >
                {row === first && (
                  <motion.span
                    initial={{ scale: 0, rotate: -40 }}
                    animate={{ scale: 1, rotate: -12 }}
                    transition={{ type: 'spring', delay: 1.1, stiffness: 300, damping: 8 }}
                    className="absolute -top-6 left-1/2 z-10 -translate-x-1/2 text-sun"
                  >
                    <Crown className="size-8 fill-sun stroke-ink" strokeWidth={2.5} />
                  </motion.span>
                )}
                <Avatar
                  slug={row.slug}
                  expression={podiumExpr(row.slug, row === first ? 'cool' : 'joie', 'joie')}
                  tenue={row.equipped_tenue}
                  size={row === first ? 92 : 72}
                  selected={row.profile_id === me}
                />
              </motion.div>
              <p className="mt-1 max-w-full truncate font-display text-base font-extrabold">{row.nickname}</p>
              <p className="text-xs font-bold text-muted">{row.wins} victoire{row.wins > 1 ? 's' : ''}</p>
            </>
          )}
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: row ? h : 40 }}
            transition={{ type: 'spring', stiffness: 120, damping: 14, delay: i * 0.12 }}
            className={cn(
              'mt-2 flex w-full items-start justify-center rounded-t-card border-[3px] border-ink pt-2 text-3xl shadow-sticker',
              row ? color : 'bg-sunk',
            )}
          >
            {row && medal}
          </motion.div>
        </div>
      ))}
    </div>
  )
}

function RowCard({ row, me, game }: { row: Row; me: boolean; game: boolean }) {
  return (
    <div
      className={cn(
        'sticker flex items-center gap-3 rounded-card p-3',
        me ? 'bg-sun text-[#1f1b2e]' : 'bg-surface text-text',
      )}
    >
      <span className="w-8 text-center font-display text-2xl font-extrabold">{row.rank}</span>
      <Avatar slug={row.slug} expression={row.equipped_expression} tenue={row.equipped_tenue} size={48} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-extrabold">
          {row.nickname}
          {me && ' (toi)'}
        </p>
        <p className={cn('text-xs font-bold', me ? 'text-[#1f1b2e]/70' : 'text-muted')}>
          {row.games_played} partie{row.games_played > 1 ? 's' : ''}
          {game && row.points != null && ` · ${row.points} pts`}
        </p>
      </div>
      <div className="text-right">
        <p className="font-display text-xl font-extrabold">
          <AnimatedNumber value={row.wins} /> 🏆
        </p>
        <Badge tone="grape" tilted={false}>Niv. {row.level}</Badge>
      </div>
    </div>
  )
}

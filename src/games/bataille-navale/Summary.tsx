import { useMemo } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { DuelSummary } from '@/features/duel/DuelSummary'
import { mood, pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'
import { Sea, type SeaShip } from './Sea'
import { accuracy } from './logic'
import type { BnBoard, BnState } from './types'

/**
 * Fin de session : classement du socle + la dernière bataille (flottes
 * révélées, précision des tirs, meilleur enchaînement de touchés), la
 * bataille la plus courte et le nombre d'obus tirés pendant la session.
 * (Le socle ne garde de chaque manche que son nombre de coups : la précision
 * détaillée n'est connue que pour la dernière bataille.)
 */
export default function BatailleNavaleSummary(props: GameSummaryProps) {
  const s = props.state as unknown as BnState
  const get = (id: string) => playerOrPlaceholder(props.players, id)
  const games = (s.session?.history ?? []).flatMap((h) => h.games)
  const shortest = games.filter((g) => g.winner).sort((x, y) => x.moves - y.moves)[0]
  const totalShots = games.reduce((n, g) => n + g.moves, 0)
  const board = s.board && s.board.stats && s.board.waters ? s.board : null
  const hero = shortest?.winner ? get(shortest.winner) : null

  const extra =
    board || hero ? (
      <div className="flex flex-col gap-2">
        {board && <LastBattle board={board} meId={props.meId} get={get} />}
        <div className="grid grid-cols-2 gap-2">
          {hero && shortest && (
            <div className="sticker flex flex-col items-center gap-1 bg-sky p-2 text-center text-[#1f1b2e]">
              <span className="text-xs font-extrabold uppercase">Bataille éclair ⚡</span>
              <Avatar slug={hero.slug} expression={mood(hero, 'sly')} size={40} />
              <span className="text-sm leading-tight font-bold">
                {hero.nickname} coule tout en {shortest.moves} tirs (à deux)
              </span>
            </div>
          )}
          <div className="sticker flex flex-col items-center justify-center gap-1 bg-sun p-2 text-center text-[#1f1b2e]">
            <span className="text-xs font-extrabold uppercase">Obus tirés 💣</span>
            <span className="font-display text-4xl font-extrabold tabular-nums">{totalShots}</span>
          </div>
        </div>
      </div>
    ) : null
  return <DuelSummary {...props} extra={extra} />
}

function LastBattle({ board, meId, get }: { board: BnBoard; meId: string; get: (id: string) => ReturnType<typeof playerOrPlaceholder> }) {
  const ids = [board.a, board.b]
  const best = ids.reduce((b, id) => ((board.stats[id]?.best ?? 0) > (board.stats[b]?.best ?? 0) ? id : b), ids[0])
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-3">
      <p className="font-display font-extrabold">La dernière bataille 🌊</p>
      <div className="grid grid-cols-2 gap-2">
        {ids.map((owner) => (
          <FinalSea key={owner} board={board} owner={owner} name={owner === meId ? 'Toi' : get(owner).nickname} />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {ids.map((id) => {
          const p = get(id)
          const st = board.stats[id]
          const acc = accuracy(st)
          const left = board.waters[id]?.left ?? 0
          return (
            <div key={id} className="flex items-center gap-2 text-sm">
              <Avatar slug={p.slug} expression={left > 0 ? pickExpression(p, 'cool', 'pouces', 'joie') : mood(p, 'sad')} size={28} />
              <span className="min-w-0 flex-1 truncate font-bold">{id === meId ? 'Toi' : p.nickname}</span>
              <span className="text-xs font-bold tabular-nums" title="Précision des tirs">
                🎯 {acc === null ? '—' : `${acc} %`}
              </span>
              <span className="w-20 text-right text-xs font-bold tabular-nums" title="Meilleur enchaînement de touchés">
                🔥 {st?.best ?? 0} d’affilée{id === best && (st?.best ?? 0) > 1 ? ' 👑' : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FinalSea({ board, owner, name }: { board: BnBoard; owner: string; name: string }) {
  const w = board.waters[owner]
  const ships = useMemo<SeaShip[]>(() => {
    const sunk = new Set<string>((w?.sunk ?? []).map((x) => x.id))
    const list: SeaShip[] = (w?.sunk ?? []).map((x) => ({ ship: x, look: 'sunk', accent: '#FFB703' }))
    for (const x of board.reveal?.[owner] ?? []) if (!sunk.has(x.id)) list.push({ ship: x, look: 'revealed', accent: '#FFB703' })
    return list
  }, [w, board.reveal, owner])
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-center text-xs font-extrabold">Flotte : {name}</span>
      <Sea shots={w?.shots ?? []} ships={ships} size="sm" label={`Flotte finale : ${name}`} />
    </div>
  )
}

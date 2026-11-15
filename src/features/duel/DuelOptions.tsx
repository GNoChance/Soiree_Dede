import type { ComponentType } from 'react'
import { useParams } from 'react-router'
import { motion } from 'framer-motion'
import { Shuffle } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useSoiree } from '@/features/soiree/hooks'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { GameOptionsProps } from '@/games/types'
import { DUEL_MODES, normalizeDuelOptions } from './logic'
import type { DuelBoardOptionsProps, DuelOptionsValue } from './types'

export interface DuelOptionsProps extends GameOptionsProps {
  /** Joueurs sélectionnables pour le mode duel (défaut : joueurs de la soirée de la page, route /soiree/:id). */
  playerIds?: string[]
  /** Options propres au jeu (stockées sous `options.board`). */
  BoardOptions?: ComponentType<DuelBoardOptionsProps>
}

/**
 * Joueurs de la soirée affichée (GameOptionsProps ne transmet que leur nombre).
 * Multi-soirées : la soirée de la PAGE (paramètre de route `:id` du salon), pas
 * « ma soirée la plus récente ».
 */
function useSoireePlayerIds(override?: string[]): string[] {
  const { id } = useParams()
  const { data } = useSoiree(override ? undefined : id)
  return override ?? data?.playerIds ?? []
}

/**
 * Options communes des jeux en duel : mode de session, meilleur de 1/3 et
 * duellistes (mode duel), + options propres au jeu (`BoardOptions`).
 * Valeur : DuelOptionsValue (cf. types.ts), normalisée par prepareDuelOptions.
 */
export function DuelOptions({ options, onChange, playerCount, playerIds, BoardOptions }: DuelOptionsProps) {
  const o = normalizeDuelOptions(options)
  const ids = useSoireePlayerIds(playerIds)
  const { byId } = usePlayers()
  const set = (patch: Partial<DuelOptionsValue>) => onChange({ ...options, ...o, ...patch })
  const chosen: string[] = o.duel_players ?? []
  const info = DUEL_MODES.find((m) => m.value === o.mode) ?? DUEL_MODES[0]

  const togglePlayer = (id: string) => {
    fx.pop()
    let next: string[]
    if (chosen.includes(id)) next = chosen.filter((x) => x !== id)
    else next = [...chosen, id].slice(-2)
    // On garde une sélection partielle dans les options brutes (1 joueur) pour l'UI.
    onChange({ ...options, ...o, duel_players: next.length === 2 ? next : null, duel_pick: next })
  }
  const partial = Array.isArray(options.duel_pick) ? (options.duel_pick as string[]) : chosen

  return (
    <div className="flex flex-col gap-3">
      <span className="font-display text-lg font-extrabold">Format de la session</span>
      <div className="grid grid-cols-3 gap-2">
        {DUEL_MODES.map((m) => {
          const sel = m.value === o.mode
          return (
            <motion.button
              key={m.value}
              type="button"
              onClick={() => {
                if (sel) return
                fx.pop()
                set({ mode: m.value })
              }}
              animate={{ scale: sel ? 1.04 : 0.96, rotate: sel ? -2 : 0 }}
              whileTap={{ scale: 0.9 }}
              aria-pressed={sel}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-card border-[3px] border-ink p-2 text-center',
                sel ? 'bg-sun text-[#1f1b2e] shadow-sticker' : 'bg-sunk text-muted',
              )}
            >
              <span className="text-3xl leading-none">{m.emoji}</span>
              <span className="font-display text-sm leading-tight font-extrabold">{m.label}</span>
            </motion.button>
          )
        })}
      </div>
      <p className="text-sm leading-snug text-muted">{info.help}</p>
      {o.mode === 'tournament' && playerCount > 2 && (playerCount & (playerCount - 1)) !== 0 && (
        <p className="text-xs text-muted">
          {playerCount} joueurs : {nextPow2(playerCount) - playerCount} exempt{nextPow2(playerCount) - playerCount > 1 ? 's' : ''} tiré{nextPow2(playerCount) - playerCount > 1 ? 's' : ''} au sort passe{nextPow2(playerCount) - playerCount > 1 ? 'nt' : ''} directement au 2e tour.
        </p>
      )}

      {o.mode === 'duel' && (
        <>
          <div className="flex flex-col gap-2">
            <span className="font-display text-lg font-extrabold">Nombre de manches</span>
            <SegmentedControl
              ariaLabel="Nombre de manches"
              value={String(o.best_of) as '1' | '3'}
              onChange={(v) => set({ best_of: v === '3' ? 3 : 1 })}
              options={[
                { value: '1', label: 'Une manche' },
                { value: '3', label: 'Meilleur des 3' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-extrabold">Les duellistes</span>
              <button
                type="button"
                onClick={() => {
                  fx.pop()
                  onChange({ ...options, ...o, duel_players: null, duel_pick: [] })
                }}
                className={cn(
                  'flex items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-sm font-extrabold',
                  partial.length === 0 ? 'bg-sun text-[#1f1b2e]' : 'bg-surface',
                )}
              >
                <Shuffle className="size-4" /> Au hasard
              </button>
            </div>
            {ids.length > 0 ? (
              <div className="grid grid-cols-5 gap-1">
                {ids.map((id) => {
                  const p = playerOrPlaceholder(byId, id)
                  const idx = partial.indexOf(id)
                  return (
                    <motion.button
                      key={id}
                      type="button"
                      onClick={() => togglePlayer(id)}
                      whileTap={{ scale: 0.85 }}
                      aria-pressed={idx >= 0}
                      className={cn('relative flex flex-col items-center gap-0.5 rounded-card p-1', idx < 0 && partial.length > 0 && 'opacity-50')}
                    >
                      <Avatar slug={p.slug} expression={idx >= 0 ? 'colere' : p.equipped} tenue={p.equippedTenue} size={44} selected={idx >= 0} />
                      <span className="max-w-full truncate text-[11px] font-extrabold">{p.nickname}</span>
                      {idx >= 0 && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute top-0 right-0 flex size-5 items-center justify-center rounded-full border-2 border-ink bg-tomato text-[11px] font-extrabold text-white"
                        >
                          {idx + 1}
                        </motion.span>
                      )}
                    </motion.button>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">Les duellistes seront tirés au sort.</p>
            )}
            <p className="text-xs text-muted">
              {partial.length === 2
                ? `${playerOrPlaceholder(byId, partial[0]).nickname} contre ${playerOrPlaceholder(byId, partial[1]).nickname} — les autres parient.`
                : partial.length === 1
                  ? 'Choisis son adversaire (sinon : tirage au sort complet).'
                  : 'Touche deux joueurs, ou laisse le hasard choisir. Un joueur décoché dans « Qui joue ? » est remplacé au hasard.'}
            </p>
          </div>
        </>
      )}

      {BoardOptions && (
        <BoardOptions value={o.board} onChange={(board) => onChange({ ...options, ...o, board })} playerCount={playerCount} />
      )}
    </div>
  )
}

function nextPow2(n: number) {
  let s = 2
  while (s < n) s *= 2
  return s
}

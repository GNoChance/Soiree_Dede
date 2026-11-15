import { useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router'
import { LayoutGroup, motion } from 'framer-motion'
import { Shuffle } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { fx } from '@/lib/feedback'
import { useSoiree } from '@/features/soiree/hooks'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import type { GameOptionsProps } from '../types'
import { TEAMS, TEAM_DIFFICULTIES, TEAM_META, TEAM_SECONDS_CHOICES, TEAM_WORD_CHOICES, normalizeTeams, other, readOptions } from './setup'
import type { Team, WordDifficulty } from './types'

const DIFF_LABEL: Record<WordDifficulty, string> = { facile: 'Facile', mixte: 'Mixte' }

export function TeamOptions({ options, onChange, playerCount }: GameOptionsProps) {
  const o = readOptions(options)
  const set = (patch: Record<string, unknown>) => onChange({ ...options, ...patch })
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Cartes</span>
        <SegmentedControl
          ariaLabel="Nombre de mots"
          value={String(o.words)}
          onChange={(v) => set({ words: Number(v) })}
          options={TEAM_WORD_CHOICES.map((n) => ({ value: String(n), label: `${n} mots` }))}
        />
        <p className="text-sm text-muted">Les mêmes mots servent aux 3 manches : décris, un seul mot, mime.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Temps par passage</span>
        <SegmentedControl
          ariaLabel="Temps par passage"
          value={String(o.turnSeconds)}
          onChange={(v) => set({ turnSeconds: Number(v) })}
          options={TEAM_SECONDS_CHOICES.map((n) => ({ value: String(n), label: `${n} s` }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Mots</span>
        <SegmentedControl
          ariaLabel="Difficulté des mots"
          value={o.difficulty}
          onChange={(v) => set({ difficulty: v })}
          options={TEAM_DIFFICULTIES.map((d) => ({ value: d, label: DIFF_LABEL[d] }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-lg font-extrabold">Équipes</span>
        <SegmentedControl
          ariaLabel="Formation des équipes"
          value={o.teamMode}
          onChange={(v) => set({ teamMode: v })}
          options={[
            { value: 'random', label: '🎲 Au hasard' },
            { value: 'manual', label: '✋ Je compose' },
          ]}
        />
        {o.teamMode === 'manual' && <TeamComposer options={options} onChange={onChange} playerCount={playerCount} />}
      </div>
    </div>
  )
}

/** Composition manuelle : taper un avatar le fait changer d'équipe, ou le glisser dans l'autre colonne. */
function TeamComposer({ options, onChange, playerCount }: GameOptionsProps) {
  const { id: soireeId } = useParams()
  const { data } = useSoiree(soireeId)
  const { byId } = usePlayers()
  const ids = useMemo(() => data?.playerIds ?? [], [data?.playerIds])
  const stored = readOptions(options).teams
  const teams = useMemo(() => normalizeTeams(stored, ids, false), [stored, ids])
  const boxRef = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)

  // Mémorise la composition recalée (nouveaux joueurs, départs).
  const key = JSON.stringify(teams)
  useEffect(() => {
    if (ids.length && key !== JSON.stringify(stored ?? null)) onChange({ ...options, teams })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ids.length])

  const move = (id: string, to: Team) => {
    const from = other(to)
    if (!teams[from].includes(id)) return
    fx.whoosh()
    onChange({ ...options, teams: { [from]: teams[from].filter((x) => x !== id), [to]: [...teams[to], id] } })
  }
  const shuffleTeams = () => {
    const a = [...ids].sort(() => Math.random() - 0.5)
    fx.pop()
    onChange({ ...options, teams: { red: a.filter((_, i) => i % 2 === 0), blue: a.filter((_, i) => i % 2 === 1) } })
  }

  if (!ids.length) return <p className="text-sm text-muted">Chargement des joueurs…</p>
  const unbalanced = teams.red.length < 2 || teams.blue.length < 2
  return (
    <div className="flex flex-col gap-2">
      <LayoutGroup>
        <div ref={boxRef} className="grid grid-cols-2 gap-2">
          {TEAMS.map((t) => {
            const meta = TEAM_META[t]
            return (
              <div
                key={t}
                className="sticker-sm flex min-h-32 flex-col gap-1.5 rounded-card p-2"
                style={{ backgroundColor: meta.soft, color: '#1f1b2e' }}
              >
                <p className="text-center font-display text-base font-extrabold" style={{ color: meta.color }}>
                  {meta.emoji} {meta.short} · {teams[t].length}
                </p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {teams[t].map((id) => {
                    const p = playerOrPlaceholder(byId, id)
                    return (
                      <motion.button
                        key={id}
                        type="button"
                        layout
                        layoutId={`dee-team-${id}`}
                        drag
                        dragSnapToOrigin
                        dragElastic={0.6}
                        whileDrag={{ scale: 1.25, zIndex: 20, rotate: 8 }}
                        whileTap={{ scale: 0.9 }}
                        onDragStart={() => {
                          dragged.current = true
                        }}
                        onDragEnd={(_, info) => {
                          const r = boxRef.current?.getBoundingClientRect()
                          if (!r) return
                          const x = info.point.x - window.scrollX
                          const side: Team = x < r.left + r.width / 2 ? 'red' : 'blue'
                          if (side !== t) move(id, side)
                        }}
                        onClick={() => {
                          if (dragged.current) {
                            dragged.current = false
                            return
                          }
                          move(id, other(t))
                        }}
                        className="flex w-16 touch-none flex-col items-center"
                        aria-label={`${p.nickname} : passer chez les ${TEAM_META[other(t)].short}`}
                      >
                        <Avatar slug={p.slug} tenue={p.equippedTenue} size={44} />
                        <span className="w-full truncate text-center text-xs font-extrabold">{p.nickname}</span>
                      </motion.button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </LayoutGroup>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">Tape ou glisse un avatar pour le changer d’équipe.</p>
        <Button variant="secondary" size="sm" icon={<Shuffle className="size-4" />} onClick={shuffleTeams}>
          Mélanger
        </Button>
      </div>
      {unbalanced && <p className="text-sm font-bold text-tomato">Il faut au moins 2 joueurs par équipe.</p>}
      {playerCount < ids.length && <p className="text-sm text-muted">Les joueurs qui ne jouent pas seront retirés (équipes rééquilibrées si besoin).</p>}
    </div>
  )
}

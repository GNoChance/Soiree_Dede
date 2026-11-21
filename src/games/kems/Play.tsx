import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { supabase } from '@/lib/supabase'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { TEAM_INFO } from '@/features/teams/teams'
import { TvButton } from '@/features/tv/TvButton'
import { useTv } from '@/features/tv/tv'
import type { GamePlayProps, PlayerInfo } from '../types'
import { CardBack, KemsCard } from './Card'
import { HoldButton } from './HoldButton'
import { applySwap, partnerOf, sortHand, teamOf } from './logic'
import { Feed, ScorePills } from './Parts'
import { RevealPanel } from './Reveal'
import { kemsActions } from './setup'
import { kemsFx } from './sound'
import { KemsTv } from './TvView'
import type { KemsSecret, KemsState } from './types'

/* -------------------------------------------------------------------------- */
/* Mon secret (main) : relu dès que state.hand_ver[moi] augmente               */
/* -------------------------------------------------------------------------- */

const isSecret = (x: unknown): x is KemsSecret => !!x && typeof x === 'object' && Array.isArray((x as KemsSecret).hand)

/**
 * Le moteur met à jour `match_secrets` à chaque échange ; le Realtime le pousse, mais s'il est manqué
 * ou en retard on relit nous-mêmes quand le state public annonce une version plus récente (`hand_ver`).
 */
function useMySecret(matchId: string, propSecret: unknown, ver: number | undefined): KemsSecret | null {
  const [fetched, setFetched] = useState<KemsSecret | null>(null)
  const prop = isSecret(propSecret) ? propSecret : null
  const best = !fetched ? prop : !prop ? fetched : fetched.v >= prop.v ? fetched : prop
  const bestV = best?.v ?? 0

  useEffect(() => {
    if (!ver || ver <= bestV) return
    let cancelled = false
    let timer = 0
    const load = async (attempt: number) => {
      const { data } = await supabase.from('match_secrets').select('secret').eq('match_id', matchId).maybeSingle()
      if (cancelled) return
      const sec = (data?.secret ?? null) as unknown
      if (isSecret(sec)) setFetched((cur) => (!cur || sec.v > cur.v ? sec : cur))
      if ((!isSecret(sec) || sec.v < ver) && attempt < 5) timer = window.setTimeout(() => void load(attempt + 1), 300 * (attempt + 1))
    }
    timer = window.setTimeout(() => void load(0), 400) // d'abord une chance au Realtime
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [matchId, ver, bestV])

  return best
}

/** Sous TvContext (route /soiree/:id/tele) : vue télé en lecture seule. */
export default function KemsPlay(props: GamePlayProps) {
  return useTv() ? <KemsTv {...props} /> : <KemsScreen {...props} />
}

function KemsScreen({ matchId, soireeId, state, secret, meId, isHost, players, act }: GamePlayProps) {
  const s = state as unknown as KemsState
  const myTeam = teamOf(s, meId)
  const isPlayer = Boolean(myTeam)
  const sec = useMySecret(matchId, secret, isPlayer ? s.hand_ver?.[meId] : undefined)
  const live = s.phase === 'signs' || s.phase === 'playing' || s.phase === 'reveal'
  const left = useCountdown(live ? s.deadline : null)
  const timeUp = live && Boolean(s.deadline) && left <= 0

  // Échéance : un tick idempotent, petit délai aléatoire, ré-essayé tant que la phase n'a pas bougé.
  useEffect(() => {
    if (!timeUp || !(isPlayer || isHost)) return
    let t = 0
    let cancelled = false
    const send = async () => {
      if (cancelled) return
      await act(kemsActions.tick())
      if (!cancelled) t = window.setTimeout(() => void send(), 2500)
    }
    t = window.setTimeout(() => void send(), 150 + Math.random() * 500)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [timeUp, act, isPlayer, isHost, s.deadline])

  // Sons : nouvelle manche, centre balayé.
  const lastRound = useRef(s.round)
  const lastSweeps = useRef(s.sweeps)
  useEffect(() => {
    if (s.round !== lastRound.current) {
      lastRound.current = s.round
      if (s.phase === 'playing') kemsFx.deal()
    }
    if (s.sweeps !== lastSweeps.current) {
      lastSweeps.current = s.sweeps
      kemsFx.sweep()
    }
  }, [s.round, s.sweeps, s.phase])

  const goNext = () => void act(kemsActions.next())

  return (
    <div className="flex flex-col gap-3 pb-6">
      {s.phase === 'signs' && <SignsScreen s={s} meId={meId} sec={sec} players={players} act={act} />}
      {s.phase === 'playing' && <PlayingScreen s={s} meId={meId} sec={sec} players={players} act={act} />}
      {s.phase === 'reveal' && s.call && (
        <>
          <ScorePills s={s} meTeam={myTeam?.id} />
          <RevealPanel key={s.round} s={s} call={s.call} players={players} showTimer />
          {isHost ? (
            <Button fullWidth size="lg" icon={<ArrowRight className="size-5" />} onClick={goNext}>
              Manche suivante
            </Button>
          ) : (
            <p className="text-center text-sm font-bold text-muted">La manche suivante arrive…</p>
          )}
        </>
      )}
      {(isHost || !isPlayer) && <TvButton soireeId={soireeId} />}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Signes                                                                      */
/* -------------------------------------------------------------------------- */

function SignsScreen({ s, meId, sec, players, act }: { s: KemsState; meId: string; sec: KemsSecret | null; players: Record<string, PlayerInfo>; act: GamePlayProps['act'] }) {
  const get = (id: string) => playerOrPlaceholder(players, id)
  const team = teamOf(s, meId)
  const partnerId = partnerOf(s, meId)
  const partner = partnerId ? get(partnerId) : null
  const ready = s.ready.includes(meId)
  const left = Math.ceil(useCountdown(s.deadline) / 1000)

  return (
    <div className="flex flex-col gap-3">
      {team && partner ? (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="sticker flex flex-col items-center gap-3 rounded-card p-4 text-center"
          style={{ backgroundColor: TEAM_INFO[team.id].soft, color: '#1f1b2e' }}
        >
          <p className="font-display text-2xl font-extrabold">
            {TEAM_INFO[team.id].emoji} Équipe {TEAM_INFO[team.id].short.toLowerCase()}
          </p>
          <div className="flex items-center gap-2">
            <Avatar slug={get(meId).slug} tenue={get(meId).equippedTenue} size={72} />
            <span className="text-3xl">🤝</span>
            <Avatar slug={partner.slug} tenue={partner.equippedTenue} expression={mood(partner, 'happy')} size={72} bounce />
          </div>
          <p className="font-display text-xl font-extrabold">🤫 Choisis un signe secret avec {partner.nickname}</p>
          <p className="text-sm font-bold">Assieds-toi en face de {partner.nickname} : le signe se fait en vrai, pas sur l’écran !</p>
          {sec && sec.sign_ideas.length > 0 && (
            <ul className="flex w-full flex-col gap-1.5">
              {sec.sign_ideas.map((idea) => (
                <li key={idea} className="sticker-sm rounded-chip bg-white px-3 py-2 text-base font-bold">
                  💡 {idea}
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      ) : (
        <p className="sticker rounded-card bg-surface p-4 text-center font-display text-xl font-extrabold">👀 Les équipes choisissent leur signe secret…</p>
      )}

      {team && (
        <Button fullWidth size="lg" disabled={ready} onClick={() => void act(kemsActions.ready())}>
          {ready ? 'En attente des autres…' : 'Prêt !'}
        </Button>
      )}

      <div className="flex flex-wrap justify-center gap-2" aria-label="Joueurs prêts">
        {s.players.map((id) => {
          const p = get(id)
          const ok = s.ready.includes(id)
          return (
            <div key={id} className={cn('flex w-14 flex-col items-center transition-opacity', !ok && 'opacity-40')}>
              <Avatar slug={p.slug} tenue={p.equippedTenue} size={44} badge={ok ? '✓' : undefined} />
              <span className="w-full truncate text-center text-xs font-extrabold">{p.nickname}</span>
            </div>
          )
        })}
      </div>
      <p className="text-center text-sm font-bold text-muted">On commence dans {Math.max(0, left)} s ou dès que tout le monde est prêt.</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Manche en cours                                                             */
/* -------------------------------------------------------------------------- */

type Sel = { zone: 'hand' | 'center'; id: string } | null

/** `above` / `signSlot` : ajouts du mode solo (bots + bouton « Faire le signe »), absents en soirée. */
export function PlayingScreen({ s, meId, sec, players, act, above, signSlot }: { s: KemsState; meId: string; sec: KemsSecret | null; players: Record<string, PlayerInfo>; act: GamePlayProps['act']; above?: ReactNode; signSlot?: ReactNode }) {
  const team = teamOf(s, meId)
  const serverHand = useMemo(() => sec?.hand ?? [], [sec])
  const [sel, setSel] = useState<Sel>(null)
  const [pending, setPending] = useState<{ give: string; take: string } | null>(null)
  const [taken, setTaken] = useState<string | null>(null)
  const [calling, setCalling] = useState(false)
  const [picking, setPicking] = useState(false)
  const [ideas, setIdeas] = useState(false)

  // Échange optimiste : la carte part dès la 2e touche ; la main affichée finit toujours par suivre le secret serveur.
  useEffect(() => {
    if (!pending) return
    if (serverHand.includes(pending.take)) {
      setPending(null)
      return
    }
    const t = window.setTimeout(() => setPending(null), 1800)
    return () => clearTimeout(t)
  }, [pending, serverHand])
  useEffect(() => {
    setSel(null)
    setPending(null)
    setCalling(false)
    setPicking(false)
  }, [s.round])

  const hand = useMemo(() => sortHand(pending ? applySwap(serverHand, pending.give, pending.take) : serverHand), [serverHand, pending])
  const center = pending ? applySwap(s.center, pending.take, pending.give) : s.center
  const square = hand.length === 4 && new Set(hand.map((c) => c.slice(0, -1))).size === 1
  const wasSquare = useRef(false)
  useEffect(() => {
    if (square && !wasSquare.current) kemsFx.square()
    wasSquare.current = square
  }, [square])

  const doSwap = useCallback(
    async (give: string, take: string) => {
      setSel(null)
      setPending({ give, take })
      kemsFx.swap()
      const r = await act(kemsActions.swap(give, take))
      if (!r) {
        setPending(null)
        setTaken(take)
        kemsFx.taken()
        window.setTimeout(() => setTaken(null), 1100)
      }
    },
    [act],
  )

  const tapHand = (c: string) => {
    if (pending) return
    if (sel?.zone === 'center') void doSwap(c, sel.id)
    else setSel(sel?.id === c ? null : { zone: 'hand', id: c })
  }
  const tapCenter = (c: string) => {
    if (pending) return
    if (sel?.zone === 'hand') void doSwap(sel.id, c)
    else setSel(sel?.id === c ? null : { zone: 'center', id: c })
  }

  const n = s.players.length
  const votes = s.sweep.votes.length
  const voted = s.sweep.votes.includes(meId)
  const sweepLeft = useCountdown(s.sweep.deadline, 100)
  const others = s.teams.filter((t) => t.id !== team?.id)
  const call = async (a: ReturnType<typeof kemsActions.kems>) => {
    setCalling(true)
    const r = await act(a)
    if (!r) setCalling(false)
  }

  return (
    <div className="flex flex-col gap-2.5">
      {above}
      <ScorePills s={s} meTeam={team?.id} />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Feed items={s.feed} players={players} count={3} />
        </div>
        <span className="sticker-sm flex shrink-0 items-center gap-1.5 rounded-chip bg-surface px-2 py-1 text-sm font-extrabold" aria-label={`Pioche : ${s.deck_count} cartes`}>
          <span className="w-4">
            <CardBack />
          </span>
          {s.deck_count}
        </span>
      </div>

      {/* Centre */}
      <div className="grid grid-cols-4 gap-2" aria-label="Cartes du centre">
        <AnimatePresence mode="popLayout" initial={false}>
          {center.map((c) => (
            <motion.div
              key={c}
              layout
              initial={{ opacity: 0, y: -24, rotate: -6 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="relative"
            >
              <KemsCard card={c} selected={sel?.zone === 'center' && sel.id === c} onClick={team ? () => tapCenter(c) : undefined} />
              {taken === c && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute inset-x-0 top-1/2 -translate-y-1/2 -rotate-6 rounded-md border-2 border-ink bg-tomato py-1 text-center font-display text-sm font-extrabold text-white"
                >
                  Trop tard !
                </motion.span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Balayage */}
      <div className="flex items-center gap-2">
        {team ? (
          <button
            type="button"
            onClick={() => void act(kemsActions.sweep())}
            className={cn(
              'sticker-sm relative flex min-h-11 flex-1 items-center justify-center gap-2 overflow-hidden rounded-chip border-[3px] border-ink px-3 font-display text-base font-extrabold active:translate-x-0.5 active:translate-y-0.5',
              voted ? 'bg-sun text-[#1f1b2e]' : 'bg-surface',
            )}
            aria-pressed={voted}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 bg-sky/40" style={{ width: `${Math.min(100, ((10000 - sweepLeft) / 10000) * 100)}%` }} />
            <span className="relative">🧹 Suivantes</span>
            <span className="relative rounded-full bg-ink px-2 text-sm text-white">
              {votes} sur {n}
            </span>
          </button>
        ) : (
          <p className="flex-1 text-center text-sm font-bold text-muted">
            🧹 Suivantes : {votes} sur {n}
          </p>
        )}
      </div>

      {/* Ma main */}
      {team ? (
        <>
          <div className="flex items-center justify-between">
            <span className="font-display text-base font-extrabold">Ma main</span>
            {square ? (
              <motion.span animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="rounded-full border-2 border-ink bg-mint px-3 py-0.5 text-sm font-extrabold text-ink">
                🃏 Carré ! Fais ton signe 🤫
              </motion.span>
            ) : signSlot ? null : (
              <button type="button" onClick={() => setIdeas((v) => !v)} className="text-xs font-bold text-muted underline">
                🤫 Le signe se fait en vrai ! · idées
              </button>
            )}
          </div>
          {ideas && !square && !signSlot && (
            <ul className="sticker-sm flex flex-col gap-0.5 rounded-chip bg-surface p-2 text-xs font-bold">
              {(sec?.sign_ideas ?? []).map((i) => (
                <li key={i}>💡 {i}</li>
              ))}
              {!sec?.sign_ideas.length && <li>Invente-en un avec {partnerOf(s, meId) ? playerOrPlaceholder(players, partnerOf(s, meId) as string).nickname : 'ton coéquipier'} !</li>}
            </ul>
          )}
          <div className="grid grid-cols-4 gap-2" aria-label="Ma main">
            {hand.map((c) => (
              <KemsCard key={c} card={c} glow={square} selected={sel?.zone === 'hand' && sel.id === c} onClick={() => tapHand(c)} />
            ))}
            {hand.length === 0 && [0, 1, 2, 3].map((i) => <div key={i} className="aspect-[5/7] animate-pulse rounded-xl border-[3px] border-dashed border-ink/40" />)}
          </div>

          {signSlot}
          {/* KEMS / CONTRE-KEMS : loin des cartes, appui long */}
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex gap-2">
              <HoldButton
                background={TEAM_INFO[team.id].color}
                color={TEAM_INFO[team.id].text}
                hint="Maintiens ✋ si ton partenaire a un carré"
                disabled={calling}
                ariaLabel="KEMS : maintenir appuyé"
                onTrigger={() => void call(kemsActions.kems())}
              >
                KEMS !
              </HoldButton>
              {s.teams.length === 2 ? (
                <HoldButton
                  background="#1f1b2e"
                  color="#ffffff"
                  hint="Maintiens ✋ si tu repères leur signe"
                  labelClass="text-xl"
                  disabled={calling}
                  ariaLabel="CONTRE-KEMS : maintenir appuyé"
                  onTrigger={() => void call(kemsActions.counter(others[0]?.id))}
                >
                  CONTRE-KEMS !
                </HoldButton>
              ) : (
                <button
                  type="button"
                  disabled={calling}
                  onClick={() => setPicking((v) => !v)}
                  className="flex min-h-[5rem] min-w-0 flex-1 basis-0 select-none flex-col items-center justify-center rounded-bubble border-[3px] border-ink bg-ink font-display font-extrabold text-white shadow-sticker active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50"
                >
                  <span className="whitespace-nowrap text-xl leading-none">CONTRE-KEMS !</span>
                  <span className="mt-1 text-xs font-bold opacity-90">{picking ? 'Choisis l’équipe visée ↓' : 'Touche pour choisir l’équipe'}</span>
                </button>
              )}
            </div>
            {picking && s.teams.length > 2 && (
              <div className="flex gap-2">
                {others.map((t) => (
                  <HoldButton
                    key={t.id}
                    background={TEAM_INFO[t.id].color}
                    color={TEAM_INFO[t.id].text}
                    hint="Maintiens ✋"
                    disabled={calling}
                    className="min-h-16"
                    ariaLabel={`Contre-Kems contre les ${TEAM_INFO[t.id].short} : maintenir appuyé`}
                    onTrigger={() => void call(kemsActions.counter(t.id))}
                  >
                    {TEAM_INFO[t.id].emoji} {TEAM_INFO[t.id].short}
                  </HoldButton>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="sticker rounded-card bg-surface p-3 text-center font-display text-lg font-extrabold">👀 Tu regardes la partie : les mains restent secrètes !</p>
      )}
    </div>
  )
}

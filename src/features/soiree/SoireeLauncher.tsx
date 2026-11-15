import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { KeyRound, PartyPopper, Play, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/Modal'
import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { burst } from '@/components/ui/confetti'
import { getCharacter } from '@/data/characters'
import { supabase } from '@/lib/supabase'
import { fx } from '@/lib/feedback'
import { useSession } from '@/store/session'
import { getGame } from '@/games/registry'
import type { ActiveSoireeJson, SoireeJson } from '@/types/db'
import { MAX_OPEN_SOIREES, refetchActiveSoirees, useActiveSoirees } from './activeSoirees'
import { usePlayers } from './players'
import { CheckableToken } from './components'
import { IdleCountdown } from './SoireeLive'
import { errorCode, toastError } from './errors'

/**
 * Bloc « soirées » du hub : une carte par soirée en cours (jusqu'à 5 : hôte,
 * joueurs, partie en cours ou salon, compte à rebours de fin auto, « Rejoindre »),
 * puis « Lancer une soirée » (sélection des joueurs -> create_soiree) et la saisie
 * du code 4 lettres, tant que la limite n'est pas atteinte.
 */
export function SoireeLauncher() {
  const meId = useSession((s) => s.profile?.id)
  const { soirees, loading } = useActiveSoirees(meId)
  const navigate = useNavigate()
  const [pickOpen, setPickOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const reduce = useReducedMotion()

  const goTo = (s: SoireeJson) => {
    fx.whoosh()
    void refetchActiveSoirees()
    navigate(`/soiree/${s.id}`)
  }

  if (!meId) return null
  if (loading && soirees.length === 0) return <Skeleton className="h-32 w-full rounded-card" />

  const full = soirees.length >= MAX_OPEN_SOIREES
  return (
    <div className="flex flex-col gap-3">
      {soirees.length > 0 && (
        <h2 className="text-2xl">{soirees.length > 1 ? `Mes ${soirees.length} soirées en cours` : 'Ma soirée en cours'}</h2>
      )}
      <AnimatePresence initial={false} mode="popLayout">
        {soirees.map((s, i) => (
          <SoireeCard key={s.id} soiree={s} meId={meId} index={i} />
        ))}
      </AnimatePresence>

      {full ? (
        <motion.p layout className="sticker-sm bg-sunk p-3 text-center text-sm font-bold">
          {MAX_OPEN_SOIREES} soirées en même temps, c’est le maximum ! Quittes-en une pour en lancer ou en rejoindre une autre.
        </motion.p>
      ) : (
        <motion.div layout className="flex flex-col gap-2">
          <motion.div animate={reduce ? undefined : { rotate: [-1, 1, -1] }} transition={{ repeat: Infinity, duration: 2.4 }}>
            <Button
              size={soirees.length ? 'md' : 'lg'}
              variant={soirees.length ? 'secondary' : 'primary'}
              fullWidth
              onClick={() => setPickOpen(true)}
              icon={<PartyPopper className={soirees.length ? 'size-6' : 'size-7'} />}
            >
              {soirees.length ? 'Lancer une autre soirée' : 'Lancer une soirée'}
            </Button>
          </motion.div>
          <button
            type="button"
            onClick={() => {
              fx.pop()
              setCodeOpen(true)
            }}
            className="mx-auto flex min-h-10 items-center gap-1.5 font-display font-extrabold text-muted underline decoration-2 underline-offset-4"
          >
            <KeyRound className="size-4" /> J’ai un code
          </button>
        </motion.div>
      )}
      <PickPlayersSheet
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        meId={meId}
        onCreated={(s) => {
          setPickOpen(false)
          goTo(s)
        }}
        onFull={() => void refetchActiveSoirees()}
      />
      <JoinCodeSheet
        open={codeOpen}
        onClose={() => setCodeOpen(false)}
        onJoined={(s) => {
          setCodeOpen(false)
          goTo(s)
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/** Carte d'une soirée en cours (hub). */
function SoireeCard({ soiree, meId, index }: { soiree: ActiveSoireeJson; meId: string; index: number }) {
  const { byId } = usePlayers()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const host = byId[soiree.host_id]
  const hostSlug = host?.slug ?? soiree.host?.slug ?? 'dede'
  const isHost = soiree.host_id === meId
  const color = getCharacter(hostSlug)?.color ?? '#FFB703'
  const match = soiree.current_match
  const game = match ? getGame(match.game_id) : undefined
  const inMatch = Boolean(match && match.player_ids.includes(meId))
  const others = soiree.player_ids.filter((id) => id !== soiree.host_id)
  const shown = others.slice(0, 6)

  const go = () => {
    fx.whoosh()
    navigate(inMatch && match ? `/partie/${match.id}` : `/soiree/${soiree.id}`)
  }

  return (
    <motion.article
      layout
      initial={{ scale: 0.7, rotate: index % 2 ? 4 : -4, opacity: 0 }}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      exit={{ scale: 0.6, rotate: index % 2 ? -8 : 8, opacity: 0, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 320, damping: 16, delay: reduce ? 0 : index * 0.06 }}
      className="sticker relative overflow-hidden bg-surface p-4 text-text"
      style={{ background: `color-mix(in srgb, ${color} 30%, var(--surface))` }}
      aria-label={`Soirée ${isHost ? 'chez toi' : `chez ${host?.nickname ?? soiree.host?.nickname ?? '…'}`}`}
    >
      {match && !reduce && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-1/2 opacity-20"
          style={{ background: `repeating-conic-gradient(${color} 0deg 10deg, transparent 10deg 24deg)` }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 18, ease: 'linear' }}
        />
      )}
      <div className="relative flex items-center gap-3">
        <motion.div animate={reduce ? undefined : { rotate: [-6, 6, -6] }} transition={{ repeat: Infinity, duration: 1.6 + index * 0.25 }}>
          <Avatar slug={hostSlug} expression={host?.equipped ?? soiree.host?.equipped_expression ?? 'joie'} tenue={host?.equippedTenue} size={68} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xs font-extrabold tracking-wide uppercase opacity-75">🎉 Soirée · {soiree.code}</p>
          <h3 className="truncate text-2xl">{isHost ? 'Chez toi !' : `Chez ${host?.nickname ?? soiree.host?.nickname ?? '…'}`}</h3>
          {match ? (
            <p className="flex items-center gap-1.5 font-display leading-tight font-extrabold">
              <span className="relative flex size-2.5 shrink-0">
                {!reduce && <span className="absolute inline-flex size-full animate-ping rounded-full bg-tomato opacity-75" />}
                <span className="relative inline-flex size-2.5 rounded-full border border-ink bg-tomato" />
              </span>
              <span className="min-w-0">
                Partie en cours : <span className="whitespace-nowrap">{game?.emoji ?? '🎲'} {game?.name ?? match.game_id}</span>
              </span>
            </p>
          ) : (
            <p className="font-display leading-tight font-extrabold opacity-80">🛋️ Dans le salon</p>
          )}
        </div>
      </div>
      <div className="relative mt-2 flex items-center gap-2">
        <div className="flex -space-x-2">
          {shown.map((id) =>
            byId[id] ? <Avatar key={id} slug={byId[id].slug} expression={byId[id].equipped} tenue={byId[id].equippedTenue} size={30} /> : null,
          )}
        </div>
        <span className="flex items-center gap-1 text-sm font-bold opacity-80">
          {others.length > shown.length && <span>+{others.length - shown.length}</span>}
          <Users className="size-4" /> {soiree.player_ids.length}
        </span>
      </div>
      <IdleCountdown deadline={soiree.idle_deadline} variant="card" className="relative mt-2" />
      <motion.div
        className="relative mt-3"
        animate={reduce || !match ? undefined : { scale: [1, 1.04, 1] }}
        transition={{ repeat: Infinity, duration: 1.4 }}
      >
        <Button fullWidth size={inMatch ? 'lg' : 'md'} onClick={go} icon={inMatch ? <Play className="size-6 fill-current" /> : <PartyPopper className="size-6" />}>
          {inMatch ? 'Rejoindre la partie' : 'Rejoindre'}
        </Button>
      </motion.div>
    </motion.article>
  )
}

/* -------------------------------------------------------------------------- */

function PickPlayersSheet({ open, onClose, meId, onCreated, onFull }: { open: boolean; onClose: () => void; meId: string; onCreated: (s: SoireeJson) => void; onFull: () => void }) {
  const { list, loaded } = usePlayers()
  const [selected, setSelected] = useState<Set<string>>(() => new Set([meId]))
  const [busy, setBusy] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      n.add(meId)
      return n
    })

  const create = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('create_soiree', { p_player_ids: [...selected] })
    setBusy(false)
    if (error) {
      toastError(error)
      // Déjà 5 soirées (ou ancien serveur : déjà une soirée) : la liste du hub se met à jour.
      const code = errorCode(error)
      if (code === 'too_many_soirees' || code === 'already_in_soiree') {
        onFull()
        onClose()
      }
      return
    }
    fx.fanfare()
    burst({ x: 0.5, y: 0.8 }, 140)
    onCreated(data as SoireeJson)
  }

  const allIds = list.map((p) => p.id)
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Qui est là ce soir ?"
      footer={
        <Button ref={btnRef} size="lg" fullWidth loading={busy} onClick={create}>
          C’est parti ! ({selected.size})
        </Button>
      }
    >
      <p className="mb-3 text-muted">Touche les copains présents. Ils verront la soirée apparaître sur leur téléphone.</p>
      {!loaded ? (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} circle className="mx-auto size-16" />
          ))}
        </div>
      ) : (
        <motion.div className="grid grid-cols-3 gap-2" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.04 } } }}>
          {list.map((p) => (
            <motion.div key={p.id} variants={{ h: { scale: 0, rotate: -20 }, s: { scale: 1, rotate: 0 } }} className="flex justify-center">
              <CheckableToken player={p} checked={selected.has(p.id)} locked={p.id === meId} onToggle={() => toggle(p.id)} />
            </motion.div>
          ))}
        </motion.div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          className="font-display font-extrabold text-muted underline"
          onClick={() => setSelected(selected.size === allIds.length ? new Set([meId]) : new Set(allIds))}
        >
          {selected.size === allIds.length ? 'Juste moi' : 'Tout le monde'}
        </button>
        <span className="flex items-center gap-1 font-display font-extrabold">
          <Users className="size-5" /> {selected.size}
        </span>
      </div>
    </BottomSheet>
  )
}

/* -------------------------------------------------------------------------- */

const ALLOWED = /[A-Z]/

function JoinCodeSheet({ open, onClose, onJoined }: { open: boolean; onClose: () => void; onJoined: (s: SoireeJson) => void }) {
  const [chars, setChars] = useState(['', '', '', ''])
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const refs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    if (!open) return
    setChars(['', '', '', ''])
    const t = window.setTimeout(() => refs.current[0]?.focus(), 300)
    return () => clearTimeout(t)
  }, [open])

  const submit = async (code: string) => {
    setBusy(true)
    const { data, error } = await supabase.rpc('join_soiree_by_code', { p_code: code })
    setBusy(false)
    if (error) {
      toastError(error)
      setShake((n) => n + 1)
      setChars(['', '', '', ''])
      refs.current[0]?.focus()
      return
    }
    fx.fanfare()
    onJoined(data as SoireeJson)
  }

  const setAt = (i: number, value: string) => {
    const letters = value
      .toUpperCase()
      .normalize('NFD')
      .replace(/[^A-Z]/g, '')
    if (!letters) {
      setChars((c) => c.map((x, j) => (j === i ? '' : x)))
      return
    }
    const next = [...chars]
    let k = i
    for (const ch of letters) {
      if (k > 3) break
      if (ALLOWED.test(ch)) next[k++] = ch
    }
    setChars(next)
    fx.tick()
    if (k <= 3) refs.current[k]?.focus()
    else refs.current[3]?.blur()
    if (next.every(Boolean)) void submit(next.join(''))
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Code de la soirée">
      <p className="mb-4 text-muted">Demande les 4 lettres à l’hôte.</p>
      <motion.div key={shake} className="flex justify-center gap-3" animate={shake ? { x: [0, -14, 14, -10, 10, 0] } : undefined} transition={{ duration: 0.4 }}>
        {chars.map((c, i) => (
          <motion.input
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            value={c}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={4}
            aria-label={`Lettre ${i + 1}`}
            disabled={busy}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !chars[i] && i > 0) {
                refs.current[i - 1]?.focus()
                setChars((cs) => cs.map((x, j) => (j === i - 1 ? '' : x)))
              }
            }}
            onFocus={(e) => e.target.select()}
            animate={c ? { scale: [1.25, 1], rotate: [i % 2 ? 6 : -6, 0] } : { scale: 1 }}
            className="sticker h-20 w-16 bg-sunk text-center font-display text-5xl font-extrabold text-text uppercase outline-none focus:bg-sun focus:text-[#1f1b2e]"
          />
        ))}
      </motion.div>
      <AnimatePresence>
        {busy && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 text-center font-display font-extrabold text-muted">
            On toque à la porte…
          </motion.p>
        )}
      </AnimatePresence>
    </BottomSheet>
  )
}

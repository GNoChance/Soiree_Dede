import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { KeyRound, PartyPopper, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/Modal'
import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { burst } from '@/components/ui/confetti'
import { supabase } from '@/lib/supabase'
import { fx } from '@/lib/feedback'
import { useSession } from '@/store/session'
import type { SoireeJson } from '@/types/db'
import { useActiveSoiree } from './hooks'
import { usePlayers } from './players'
import { CheckableToken } from './components'
import { errorCode, toastError } from './errors'

/**
 * Bloc « soirée » du hub : bannière de soirée active (rejoindre),
 * bouton « Lancer une soirée » (sélection des joueurs -> create_soiree),
 * saisie du code 4 lettres en secours.
 */
export function SoireeLauncher() {
  const meId = useSession((s) => s.profile?.id)
  const { soiree, loading, refetch } = useActiveSoiree(meId)
  const { byId } = usePlayers()
  const navigate = useNavigate()
  const [pickOpen, setPickOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const reduce = useReducedMotion()

  const goTo = (s: SoireeJson) => {
    fx.whoosh()
    navigate(`/soiree/${s.id}`)
  }

  if (!meId) return null
  if (loading) return <Skeleton className="h-32 w-full rounded-card" />

  if (soiree) {
    const host = byId[soiree.host_id]
    const others = soiree.player_ids.filter((id) => id !== soiree.host_id).slice(0, 6)
    return (
      <motion.div
        initial={{ scale: 0.7, rotate: -4, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 14 }}
        className="sticker relative overflow-hidden bg-bubblegum p-4 text-[#1f1b2e]"
      >
        {!reduce && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-1/2 opacity-25"
            style={{ background: 'repeating-conic-gradient(#fff 0deg 10deg, transparent 10deg 24deg)' }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 18, ease: 'linear' }}
          />
        )}
        <div className="relative flex items-center gap-3">
          {host && (
            <motion.div animate={reduce ? undefined : { rotate: [-6, 6, -6] }} transition={{ repeat: Infinity, duration: 1.6 }}>
              <Avatar slug={host.slug} expression={host.equipped} size={72} />
            </motion.div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-extrabold uppercase tracking-wide">🎉 Soirée en cours</p>
            <h2 className="truncate text-2xl">{soiree.host_id === meId ? 'Chez toi !' : `chez ${host?.nickname ?? '…'}`}</h2>
            <div className="mt-1 flex -space-x-2">
              {others.map((id) =>
                byId[id] ? <Avatar key={id} slug={byId[id].slug} expression={byId[id].equipped} size={30} /> : null,
              )}
              {soiree.player_ids.length > 7 && <span className="pl-3 font-bold">+{soiree.player_ids.length - 7}</span>}
            </div>
          </div>
        </div>
        <motion.div className="relative mt-3" animate={reduce ? undefined : { scale: [1, 1.04, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>
          <Button size="lg" fullWidth onClick={() => goTo(soiree)} icon={<PartyPopper className="size-7" />}>
            Rejoindre
          </Button>
        </motion.div>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <motion.div animate={reduce ? undefined : { rotate: [-1, 1, -1] }} transition={{ repeat: Infinity, duration: 2.4 }}>
        <Button size="lg" fullWidth onClick={() => setPickOpen(true)} icon={<PartyPopper className="size-7" />}>
          Lancer une soirée
        </Button>
      </motion.div>
      <button
        type="button"
        onClick={() => {
          fx.pop()
          setCodeOpen(true)
        }}
        className="mx-auto flex items-center gap-1.5 font-display font-extrabold text-muted underline decoration-2 underline-offset-4"
      >
        <KeyRound className="size-4" /> J’ai un code
      </button>
      <PickPlayersSheet
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        meId={meId}
        onCreated={(s) => {
          setPickOpen(false)
          goTo(s)
        }}
        onAlready={() => void refetch()}
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

function PickPlayersSheet({ open, onClose, meId, onCreated, onAlready }: { open: boolean; onClose: () => void; meId: string; onCreated: (s: SoireeJson) => void; onAlready: () => void }) {
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
      if (errorCode(error) === 'already_in_soiree') {
        onAlready()
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
    <BottomSheet open={open} onClose={onClose} title="Qui est là ce soir ?">
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
      <Button ref={btnRef} size="lg" fullWidth className="mt-4" loading={busy} onClick={create}>
        C’est parti !
      </Button>
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

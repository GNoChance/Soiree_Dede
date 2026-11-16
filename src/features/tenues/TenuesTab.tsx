import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { burst } from '@/components/ui/confetti'
import { tenuePortraitUrl, useTenueArt } from '@/components/ui/tenueArt'
import { usePlayersStore } from '@/features/soiree/players'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'
import { refreshProfile } from '@/lib/auth'
import { fx } from '@/lib/feedback'
import { toastRpcError } from '@/lib/rpcError'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { DEFAULT_TENUE, TENUES, type TenueDef } from '@/data/tenues'
import { useSession } from '@/store/session'
import { toast } from '@/store/toast'

/** Victoires par jeu du joueur (et duels remportés pour les jeux en duel), depuis match_players. */
function useWinsByGame(profileId: string | undefined) {
  const [wins, setWins] = useState<Record<string, number>>({})
  const [duelWins, setDuelWins] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const load = useCallback(async () => {
    if (!profileId) return
    const { data } = await supabase.from('match_players').select('game_id, won, stats').eq('profile_id', profileId)
    const byGame: Record<string, number> = {}
    const byDuel: Record<string, number> = {}
    let n = 0
    for (const r of (data ?? []) as { game_id: string; won: boolean; stats: { duel_wins?: unknown } | null }[]) {
      if (r.won) {
        byGame[r.game_id] = (byGame[r.game_id] ?? 0) + 1
        n++
      }
      const d = Number(r.stats?.duel_wins ?? 0)
      if (Number.isFinite(d) && d > 0) byDuel[r.game_id] = (byDuel[r.game_id] ?? 0) + d
    }
    setWins(byGame)
    setDuelWins(byDuel)
    setTotal(n)
  }, [profileId])
  useEffect(() => {
    void load()
  }, [load])
  useRefetchOnFocus(() => void load())
  return { wins, duelWins, total }
}

export function TenuesTab() {
  const profile = useSession((s) => s.profile)
  const tenueUnlocks = useSession((s) => s.tenueUnlocks)
  const patchProfile = useSession((s) => s.patchProfile)
  const [busy, setBusy] = useState<string | null>(null)
  const { wins, duelWins, total } = useWinsByGame(profile?.id)

  if (!profile) return null
  const equippedTenue = profile.equipped_tenue ?? DEFAULT_TENUE

  const progressOf = (t: TenueDef) => {
    const raw = t.gameId ? ((t.duel ? duelWins : wins)[t.gameId] ?? 0) : total
    return { value: Math.min(raw, t.threshold), target: t.threshold }
  }

  const equip = async (t: TenueDef) => {
    setBusy(t.id)
    try {
      const { data, error } = await supabase.rpc('equip_tenue', { p_tenue: t.id })
      if (error) throw error
      patchProfile(data)
      void usePlayersStore.getState().load(true)
      fx.success()
      burst({ x: 0.5, y: 0.4 }, 60)
      toast.success('Tenue équipée !')
    } catch (e) {
      toastRpcError(e)
      void refreshProfile().catch(() => undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <StaggerList className="grid grid-cols-2 gap-3">
      {TENUES.map((t) => {
        const unlocked = Boolean(t.default || tenueUnlocks[t.id])
        return (
          <StaggerItem key={t.id} className={cn(t.default && 'col-span-2')}>
            <TenueCard
              slug={profile.slug}
              expression={profile.equipped_expression}
              def={t}
              unlocked={unlocked}
              equipped={equippedTenue === t.id}
              progress={progressOf(t)}
              busy={busy === t.id}
              onEquip={() => void equip(t)}
            />
          </StaggerItem>
        )
      })}
    </StaggerList>
  )
}

function TenueCard({
  slug, expression, def, unlocked, equipped, progress, busy, onEquip,
}: {
  slug: string
  expression: string
  def: TenueDef
  unlocked: boolean
  equipped: boolean
  progress: { value: number; target: number }
  busy: boolean
  onEquip: () => void
}) {
  const art = useTenueArt(slug, def.id)
  const hasArt = art.missingEmoji === null
  const portrait = tenuePortraitUrl(slug, def.id)
  const reveal = useFirstReveal(slug, def.id, unlocked && !def.default)
  const pct = progress.target ? (progress.value / progress.target) * 100 : 100
  return (
    <motion.div
      whileHover={{ y: -3 }}
      className={cn(
        'sticker relative flex h-full flex-col items-center gap-2 rounded-card p-3 text-center',
        equipped ? 'bg-sun text-[#1f1b2e]' : 'bg-surface text-text',
      )}
    >
      {equipped && (
        <span className="absolute -right-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full border-2 border-ink bg-mint text-[#1f1b2e]">
          <Check className="size-4" strokeWidth={4} />
        </span>
      )}

      <div className="relative flex h-36 w-full items-center justify-center">
        {portrait ? (
          <PortraitCard src={portrait} label={def.label} unlocked={unlocked} reveal={reveal} />
        ) : def.default ? (
          <ChibiImage slug={slug} expression={expression} tenue={def.id} size={128} />
        ) : (
          <motion.div
            initial={{ scale: 0.6, rotate: -8 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 10 }}
            className={cn(
              'relative flex size-full flex-col items-center justify-center overflow-hidden rounded-card border-[3px] border-dashed border-ink/40 bg-sunk',
              !unlocked && 'grayscale',
            )}
          >
            <motion.span
              className={cn('text-6xl leading-none', !unlocked && 'opacity-40')}
              animate={unlocked ? { rotate: [-6, 6, -6], y: [0, -3, 0] } : undefined}
              transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
            >
              {def.emoji}
            </motion.span>
            <span className="mt-1 text-xs font-extrabold text-muted">Illustration bientôt ✨</span>
            {!unlocked && <Lock className="absolute top-1 right-1 size-5 text-ink" strokeWidth={3} />}
          </motion.div>
        )}
      </div>

      <p className="font-display text-lg leading-tight font-extrabold">
        {def.emoji} {def.label}
      </p>

      {unlocked ? (
        <p className={cn('text-xs font-bold', equipped ? 'text-[#1f1b2e]/70' : 'text-muted')}>
          {def.default ? 'Débloquée d\'office' : hasArt ? 'Débloquée !' : 'Débloquée ! Stickers bientôt ✨'}
        </p>
      ) : (
        <div className="w-full">
          <p className="text-xs font-bold text-muted">{def.condition}</p>
          <div className="mt-1 h-3.5 overflow-hidden rounded-full border-[3px] border-ink bg-sunk">
            <motion.div
              className="h-full rounded-full bg-tangerine"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(pct, 4)}%` }}
              transition={{ type: 'spring', stiffness: 90, damping: 16, delay: 0.2 }}
            />
          </div>
          <p className="mt-0.5 text-sm font-extrabold">
            {progress.value}/{progress.target} {def.unit}
          </p>
        </div>
      )}

      <Button
        fullWidth
        size="sm"
        className="mt-auto"
        disabled={!unlocked || equipped}
        loading={busy}
        icon={equipped ? <Check className="size-5" /> : undefined}
        onClick={onEquip}
      >
        {equipped ? 'Équipée' : unlocked ? 'Équiper' : 'Verrouillée'}
      </Button>
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Carte portrait : dos verrouillé, retournée (une fois) au déblocage          */
/* -------------------------------------------------------------------------- */

const SEEN_KEY = 'dede.tenues.revealed'

function readSeen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** true la première fois qu'une tenue débloquée est vue sur cet appareil (anime le retournement). */
function useFirstReveal(slug: string, tenue: string, unlocked: boolean) {
  const k = `${slug}/${tenue}`
  const [reveal] = useState(() => unlocked && !readSeen().includes(k))
  useEffect(() => {
    if (!unlocked) return
    const seen = readSeen()
    if (seen.includes(k)) return
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, k]))
    } catch {
      /* stockage indisponible : on rejouera l'animation, sans gravité */
    }
  }, [k, unlocked])
  return reveal
}

function PortraitCard({ src, label, unlocked, reveal }: { src: string; label: string; unlocked: boolean; reveal: boolean }) {
  const face = 'absolute inset-0 overflow-hidden rounded-card border-[3px] border-ink [backface-visibility:hidden]'
  return (
    <div className="relative h-full w-full max-w-[9.5rem] [perspective:700px]">
      <motion.div
        className="relative h-full w-full [transform-style:preserve-3d]"
        initial={{ rotateY: reveal ? 180 : unlocked ? 0 : 180 }}
        animate={{ rotateY: unlocked ? 0 : 180 }}
        transition={{ type: 'spring', stiffness: 120, damping: 14, delay: reveal ? 0.35 : 0 }}
        onAnimationComplete={() => {
          if (reveal) {
            fx.success()
            burst({ x: 0.5, y: 0.4 }, 40)
          }
        }}
      >
        {/* Recto : le portrait */}
        <div className={cn(face, 'bg-surface')}>
          <img src={src} alt={label} loading="lazy" decoding="async" draggable={false} className="size-full object-contain" />
        </div>
        {/* Verso : silhouette verrouillée */}
        <div className={cn(face, 'flex items-center justify-center bg-sunk [transform:rotateY(180deg)]')}>
          <img src={src} alt="" aria-hidden loading="lazy" decoding="async" draggable={false} className="size-full object-contain opacity-30 brightness-0" />
          <Lock className="absolute size-9 text-white drop-shadow-[0_2px_0_var(--ink)]" strokeWidth={3} />
        </div>
      </motion.div>
    </div>
  )
}


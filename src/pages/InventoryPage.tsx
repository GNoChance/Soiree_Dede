import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Lock } from 'lucide-react'
import { EXPRESSIONS, type ExpressionDef } from '@/data/expressions'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/Modal'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { burst } from '@/components/ui/confetti'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'
import { refreshProfile } from '@/lib/auth'
import { fx } from '@/lib/feedback'
import { toastRpcError } from '@/lib/rpcError'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { useSession } from '@/store/session'
import { toast } from '@/store/toast'
import type { ExpressionId } from '@/types/db'

export function InventoryPage() {
  const profile = useSession((s) => s.profile)
  const unlocks = useSession((s) => s.unlocks)
  const stats = useSession((s) => s.stats)
  const patchProfile = useSession((s) => s.patchProfile)
  const [selected, setSelected] = useState<ExpressionId | null>(null)
  const [friends, setFriends] = useState(0)
  const [busy, setBusy] = useState(false)

  const profileId = profile?.id
  const load = useCallback(async () => {
    if (!profileId) return
    void refreshProfile().catch(() => undefined)
    const { count } = await supabase
      .from('friendships')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'accepted')
      .or(`requester_id.eq.${profileId},addressee_id.eq.${profileId}`)
    setFriends(count ?? 0)
  }, [profileId])

  useEffect(() => {
    void load()
  }, [load])
  useRefetchOnFocus(() => void load())

  if (!profile) return null

  const isUnlocked = (id: ExpressionId) => Boolean(EXPRESSIONS[id]?.default || unlocks[id])
  const all = profile.expressions
  const unlockedCount = all.filter(isUnlocked).length
  const sel = selected ? EXPRESSIONS[selected] : null

  const progressOf = (def: ExpressionDef) => {
    const p = def.progress
    if (!p) return null
    const raw = p.stat === 'friends' ? friends : (stats?.[p.stat] ?? 0)
    return { value: Math.min(raw, p.target), target: p.target, unit: p.unit }
  }

  const equip = async (id: ExpressionId) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('equip_expression', { p_expression: id })
      if (error) throw error
      patchProfile(data)
      fx.success()
      burst({ x: 0.5, y: 0.35 }, 50)
      toast.success('Expression équipée !')
      setSelected(null)
    } catch (e) {
      toastRpcError(e)
    } finally {
      setBusy(false)
    }
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <StaggerList className="flex flex-col gap-4">
      <StaggerItem className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-4xl">Inventaire</h1>
          <Badge tone="mint" className="mt-1">
            <AnimatedNumber value={unlockedCount} />/{all.length} débloqués
          </Badge>
        </div>
        <AnimatePresence mode="popLayout">
          <motion.div
            key={profile.equipped_expression}
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 30 }}
            transition={{ type: 'spring', stiffness: 380, damping: 11 }}
          >
            <Avatar slug={profile.slug} expression={profile.equipped_expression} size={84} bounce badge="✓" />
          </motion.div>
        </AnimatePresence>
      </StaggerItem>

      <StaggerList className="grid grid-cols-3 gap-3">
        {all.map((id) => {
          const def = EXPRESSIONS[id]
          const open = isUnlocked(id)
          const equipped = profile.equipped_expression === id
          return (
            <StaggerItem key={id}>
              <motion.button
                whileTap={{ scale: 0.92, rotate: 3 }}
                whileHover={{ y: -4 }}
                onClick={() => {
                  fx.pop()
                  setSelected(id)
                }}
                aria-label={`${def.label}${open ? '' : ' (verrouillée)'}`}
                className={cn(
                  'relative flex w-full flex-col items-center gap-1 rounded-card border-[3px] border-ink px-1 py-2 shadow-sticker',
                  equipped ? 'bg-sun text-[#1f1b2e]' : 'bg-surface text-text',
                )}
              >
                <div className="relative">
                  <ChibiImage
                    slug={profile.slug}
                    expression={id}
                    size={84}
                    thumb
                    className={cn(!open && 'opacity-40 brightness-0')}
                  />
                  {!open && (
                    <>
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Lock className="size-7 text-white drop-shadow-[0_2px_0_var(--ink)]" strokeWidth={3} />
                      </span>
                    </>
                  )}
                </div>
                <span className="font-display text-sm font-extrabold">{open ? def.label : '???'}</span>
                {equipped && (
                  <span className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border-2 border-ink bg-mint text-[#1f1b2e]">
                    <Check className="size-4" strokeWidth={4} />
                  </span>
                )}
              </motion.button>
            </StaggerItem>
          )
        })}
      </StaggerList>

      <BottomSheet open={Boolean(sel)} onClose={() => setSelected(null)} title={sel && isUnlocked(sel.id) ? sel.label : 'Expression secrète'}>
        {sel && (
          <SheetBody
            slug={profile.slug}
            def={sel}
            unlocked={isUnlocked(sel.id)}
            unlockedAt={unlocks[sel.id]}
            equipped={profile.equipped_expression === sel.id}
            progress={progressOf(sel)}
            busy={busy}
            onEquip={() => void equip(sel.id)}
            fmtDate={fmtDate}
          />
        )}
      </BottomSheet>
    </StaggerList>
  )
}

function SheetBody({
  slug, def, unlocked, unlockedAt, equipped, progress, busy, onEquip, fmtDate,
}: {
  slug: string
  def: ExpressionDef
  unlocked: boolean
  unlockedAt?: string
  equipped: boolean
  progress: { value: number; target: number; unit: string } | null
  busy: boolean
  onEquip: () => void
  fmtDate: (iso: string) => string
}) {
  return (
    <div className="flex flex-col items-center gap-3 pb-2 text-center">
      <motion.div
        initial={{ scale: 0.4, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 10 }}
        className="relative"
      >
        <ChibiImage
          slug={slug}
          expression={def.id}
          size={220}
          thumb={false}
          className={cn(!unlocked && 'opacity-40 brightness-0')}
        />
        {!unlocked && <Lock className="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow-[0_3px_0_var(--ink)]" strokeWidth={3} />}
      </motion.div>
      <p className="text-3xl">{unlocked ? def.emoji : '🔒'}</p>
      {unlocked ? (
        <p className="text-muted">
          {unlockedAt ? `Débloquée le ${fmtDate(unlockedAt)}` : def.default ? 'Débloquée d\'office' : 'Débloquée'}
        </p>
      ) : (
        <>
          <p className="font-display text-lg font-extrabold">{def.condition}</p>
          {progress && (
            <div className="w-full">
              <div className="h-4 overflow-hidden rounded-full border-[3px] border-ink bg-sunk">
                <motion.div
                  className="h-full rounded-full bg-tangerine"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max((progress.value / progress.target) * 100, 3)}%` }}
                  transition={{ type: 'spring', stiffness: 90, damping: 16, delay: 0.2 }}
                />
              </div>
              <p className="mt-1 text-sm font-bold text-muted">
                {progress.value}/{progress.target} {progress.unit}
              </p>
            </div>
          )}
        </>
      )}
      <Button
        fullWidth
        size="lg"
        disabled={!unlocked || equipped}
        loading={busy}
        icon={equipped ? <Check className="size-6" /> : undefined}
        onClick={onEquip}
      >
        {equipped ? 'Équipée' : unlocked ? 'Équiper' : 'Verrouillée'}
      </Button>
    </div>
  )
}

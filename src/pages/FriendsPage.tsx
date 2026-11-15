import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Check, Clock, UserMinus, UserPlus, X } from 'lucide-react'
import { EXPRESSIONS } from '@/data/expressions'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { victoryConfetti } from '@/components/ui/confetti'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'
import { refreshProfile } from '@/lib/auth'
import { fx } from '@/lib/feedback'
import { rpcErrorMessage, toastRpcError } from '@/lib/rpcError'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/store/session'
import { toast } from '@/store/toast'
import type { FriendRequestResult, FriendshipRow, ProfileRow, UUID } from '@/types/db'

export function FriendsPage() {
  const me = useSession((s) => s.profile?.id)
  const [profiles, setProfiles] = useState<ProfileRow[] | null>(null)
  const [links, setLinks] = useState<FriendshipRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<UUID | null>(null)
  const [toRemove, setToRemove] = useState<ProfileRow | null>(null)

  // Pas de Realtime sur friendships (publication : soirees, soiree_players, matches, match_players) => refetch au focus.
  const load = useCallback(async () => {
    if (!me) return
    try {
      const [p, f] = await Promise.all([
        supabase.from('profiles').select('*').order('sort_order', { ascending: true }),
        supabase.from('friendships').select('*'),
      ])
      if (p.error) throw p.error
      if (f.error) throw f.error
      setProfiles((p.data ?? []).filter((x) => x.id !== me))
      setLinks((f.data ?? []).filter((x) => x.requester_id === me || x.addressee_id === me))
      setError(null)
    } catch (e) {
      setError(rpcErrorMessage(e))
    }
  }, [me])

  useEffect(() => {
    void load()
  }, [load])
  useRefetchOnFocus(() => void load())

  if (!me) return null

  const celebrate = (res: FriendRequestResult) => {
    const mine = res.new_unlocks[me] ?? []
    if (mine.length > 0) {
      fx.fanfare()
      victoryConfetti()
      const names = mine.map((e) => `${EXPRESSIONS[e]?.emoji ?? ''} ${EXPRESSIONS[e]?.label ?? e}`).join(', ')
      toast.success(`Nouvelle expression débloquée : ${names}`, { duration: 6000 })
    }
  }

  const run = async (id: UUID, fn: () => Promise<void>) => {
    setBusyId(id)
    try {
      await fn()
      await Promise.all([load(), refreshProfile().catch(() => undefined)])
    } catch (e) {
      toastRpcError(e)
    } finally {
      setBusyId(null)
    }
  }

  const respond = (p: ProfileRow, accept: boolean) =>
    run(p.id, async () => {
      const { data, error } = await supabase.rpc('respond_friend_request', { p_requester_id: p.id, p_accept: accept })
      if (error) throw error
      if (accept) {
        fx.success()
        toast.success(`${p.nickname} est maintenant ton ami !`)
        celebrate(data)
      } else toast(`Demande de ${p.nickname} refusée`)
    })

  const send = (p: ProfileRow) =>
    run(p.id, async () => {
      const { data, error } = await supabase.rpc('send_friend_request', { p_profile_id: p.id })
      if (error) throw error
      fx.success()
      toast.success(data.status === 'accepted' ? `${p.nickname} est maintenant ton ami !` : `Demande envoyée à ${p.nickname}`)
      celebrate(data)
    })

  const remove = (p: ProfileRow) =>
    run(p.id, async () => {
      const { error } = await supabase.rpc('remove_friend', { p_profile_id: p.id })
      if (error) throw error
      toast(`${p.nickname} retiré de tes amis`)
    })

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]))
  const related = new Set<UUID>()
  const received: ProfileRow[] = []
  const friends: ProfileRow[] = []
  const sent: ProfileRow[] = []
  for (const l of links) {
    const other = byId.get(l.requester_id === me ? l.addressee_id : l.requester_id)
    if (!other) continue
    related.add(other.id)
    if (l.status === 'accepted') friends.push(other)
    else if (l.addressee_id === me) received.push(other)
    else sent.push(other)
  }
  const others = (profiles ?? []).filter((p) => !related.has(p.id))

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-4xl">Amis</h1>
      {error ? (
        <p className="text-center font-bold text-tomato">{error}</p>
      ) : !profiles ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-card" />
          ))}
        </div>
      ) : (
        <>
          <Section title="Demandes reçues" count={received.length} hideWhenEmpty>
            {received.map((p) => (
              <PersonRow key={p.id} p={p}>
                <Button size="sm" variant="primary" loading={busyId === p.id} icon={<Check className="size-5" />} onClick={() => void respond(p, true)}>
                  Accepter
                </Button>
                <Button size="sm" variant="secondary" aria-label="Refuser" disabled={busyId === p.id} onClick={() => void respond(p, false)}>
                  <X className="size-5" />
                </Button>
              </PersonRow>
            ))}
          </Section>

          <Section title="Mes amis" count={friends.length} empty="Pas encore d'amis. Ajoute-en ci-dessous !">
            {friends.map((p) => (
              <PersonRow key={p.id} p={p}>
                <Button size="sm" variant="ghost" aria-label={`Retirer ${p.nickname}`} onClick={() => setToRemove(p)} icon={<UserMinus className="size-5" />} />
              </PersonRow>
            ))}
          </Section>

          <Section title="Demandes envoyées" count={sent.length} hideWhenEmpty>
            {sent.map((p) => (
              <PersonRow key={p.id} p={p}>
                <Badge tone="neutral"><Clock className="size-3.5" /> En attente</Badge>
                <Button size="sm" variant="ghost" aria-label="Annuler la demande" loading={busyId === p.id} onClick={() => void remove(p)} icon={<X className="size-5" />} />
              </PersonRow>
            ))}
          </Section>

          <Section title="Ajouter" count={others.length} empty="Tu es déjà en lien avec tout le monde !">
            {others.map((p) => (
              <PersonRow key={p.id} p={p}>
                <Button size="sm" loading={busyId === p.id} icon={<UserPlus className="size-5" />} onClick={() => void send(p)}>
                  Ajouter
                </Button>
              </PersonRow>
            ))}
          </Section>
        </>
      )}

      <Modal open={Boolean(toRemove)} onClose={() => setToRemove(null)} title="Retirer cet ami ?">
        {toRemove && (
          <div className="flex flex-col items-center gap-4 text-center">
            <Avatar slug={toRemove.slug} expression="pleurs" size={96} />
            <p>
              Tu ne seras plus ami avec <strong>{toRemove.nickname}</strong>. Tu pourras toujours lui renvoyer une demande.
            </p>
            <div className="flex w-full gap-3">
              <Button variant="secondary" fullWidth onClick={() => setToRemove(null)}>Annuler</Button>
              <Button
                variant="danger"
                fullWidth
                onClick={() => {
                  const p = toRemove
                  setToRemove(null)
                  void remove(p)
                }}
              >
                Retirer
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Section({
  title, count, empty, hideWhenEmpty, children,
}: {
  title: string
  count: number
  empty?: string
  hideWhenEmpty?: boolean
  children: ReactNode
}) {
  if (count === 0 && hideWhenEmpty) return null
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="flex items-center gap-2 text-2xl">
        {title}
        <Badge tone="sun">{count}</Badge>
      </h2>
      {count === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <StaggerList className="flex flex-col gap-2.5">
          {children}
        </StaggerList>
      )}
    </section>
  )
}

function PersonRow({ p, children }: { p: ProfileRow; children: ReactNode }) {
  return (
    <StaggerItem>
      <motion.div layout className="sticker flex items-center gap-3 rounded-card bg-surface p-3">
        <Avatar slug={p.slug} expression={p.equipped_expression} tenue={p.equipped_tenue} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-extrabold">{p.nickname}</p>
          <p className="truncate text-xs font-bold text-muted">{p.first_name}</p>
        </div>
        <div className="flex items-center gap-2">{children}</div>
      </motion.div>
    </StaggerItem>
  )
}

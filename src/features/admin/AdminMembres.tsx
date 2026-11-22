import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { GUEST_AVATARS } from '@/data/guests'
import { usePlayersStore } from '@/features/soiree/players'
import { cn } from '@/lib/cn'
import { toastRpcError } from '@/lib/rpcError'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toast'

const inputCls =
  'sticker-sm min-w-0 w-full rounded-card border-[3px] border-ink bg-surface px-3 py-2 font-display text-lg font-extrabold text-text outline-none'

/** Wrapper typé à la main (supabase/features/membres.sql, hors src/types/db.ts). */
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args)

/** Admin : ajoute une personne à la bande (avatar emoji en attendant son chibi). */
export function AdminMembres() {
  const [firstName, setFirstName] = useState('')
  const [nickname, setNickname] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<string | null>(null)

  const ready = firstName.trim().length > 0 && nickname.trim().length > 0 && avatar !== null

  const add = async () => {
    if (!ready || !avatar) return
    setBusy(true)
    try {
      const { data, error } = await rpc('admin_create_member', {
        p_first_name: firstName.trim(),
        p_nickname: nickname.trim(),
        p_avatar: avatar,
      })
      if (error) throw error
      const nick = (data as { nickname?: string } | null)?.nickname ?? nickname.trim()
      setAdded(nick)
      setFirstName('')
      setNickname('')
      setAvatar(null)
      void usePlayersStore.getState().load(true)
      toast.success(`${nick} est dans la bande !`)
    } catch (e) {
      toastRpcError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="flex items-center gap-2 font-display text-lg font-extrabold">
        <UserPlus className="size-5" /> Ajouter quelqu'un à la bande
      </p>
      <input
        aria-label="Prénom"
        placeholder="Prénom"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        maxLength={30}
        className={inputCls}
      />
      <input
        aria-label="Surnom"
        placeholder="Surnom (affiché dans les parties)"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        maxLength={20}
        className={inputCls}
      />
      <p className="text-sm font-bold text-muted">Choisis son avatar</p>
      <div className="grid grid-cols-4 gap-2">
        {GUEST_AVATARS.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-label={a.label}
            aria-pressed={avatar === a.id}
            onClick={() => setAvatar(a.id)}
            className={cn(
              'flex aspect-square items-center justify-center rounded-full border-[3px] border-ink text-3xl shadow-sticker-sm active:scale-95',
              avatar === a.id && 'ring-4 ring-sun',
            )}
            style={{ backgroundColor: a.color }}
          >
            {a.emoji}
          </button>
        ))}
      </div>
      <Button fullWidth size="lg" icon={<UserPlus className="size-5" />} loading={busy} disabled={!ready} onClick={() => void add()}>
        Ajouter
      </Button>
      {added && (
        <p className="rounded-card border-[3px] border-ink bg-mint/40 p-3 text-center text-sm font-bold text-text">
          {added} peut se connecter : au premier lancement, il suffit de choisir son code.
        </p>
      )}
    </Card>
  )
}

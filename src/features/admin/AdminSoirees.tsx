import { useCallback, useEffect, useState } from 'react'
import { PartyPopper, RefreshCw, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { refetchActiveSoirees } from '@/features/soiree/activeSoirees'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { getGame } from '@/games/registry'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'
import { toastRpcError } from '@/lib/rpcError'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toast'

interface AdminSoiree {
  id: string
  code: string
  status: 'lobby' | 'active'
  created_at: string
  host_id: string
  player_ids: string[]
  match: { id: string; game_id: string; status: string; created_at: string; updated_at: string | null } | null
}

/** « il y a 12 min » / « il y a 2 h 05 ». */
function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  return `il y a ${h} h ${String(min % 60).padStart(2, '0')}`
}

/** Admin : toutes les soirées non terminées, avec suppression forcée (soirée buguée). */
export function AdminSoirees() {
  const { byId } = usePlayers()
  const [list, setList] = useState<AdminSoiree[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [target, setTarget] = useState<AdminSoiree | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('admin_list_soirees')
    setLoading(false)
    if (error) {
      toastRpcError(error)
      return
    }
    setList((data as unknown as AdminSoiree[] | null) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])
  useRefetchOnFocus(() => void load())

  const doDelete = async () => {
    if (!target) return
    setDeleting(true)
    try {
      const { error } = await supabase.rpc('admin_end_soiree', { p_soiree_id: target.id })
      if (error) throw error
      toast.success(`Soirée ${target.code} supprimée.`)
      setTarget(null)
      void refetchActiveSoirees()
      void load()
    } catch (e) {
      toastRpcError(e)
      void load()
    } finally {
      setDeleting(false)
    }
  }

  const name = (id: string) => playerOrPlaceholder(byId, id).nickname

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-lg font-extrabold">
          <PartyPopper className="size-5" /> Admin : soirées en cours
        </p>
        <Button variant="secondary" size="sm" loading={loading} icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
          Rafraîchir
        </Button>
      </div>

      {list === null ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">Aucune soirée en cours. Tout est propre ✨</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((s) => {
            const game = s.match ? getGame(s.match.game_id) : undefined
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-card border-[3px] border-ink bg-sunk p-2">
                <Avatar slug={playerOrPlaceholder(byId, s.host_id).slug} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-display font-extrabold">
                    {s.code}
                    <Badge tone={s.match ? 'mint' : 'sun'}>{s.match ? 'partie en cours' : s.status === 'lobby' ? 'salon' : 'entre deux jeux'}</Badge>
                  </p>
                  <p className="truncate text-xs font-bold text-muted">
                    Chez {name(s.host_id)} · {s.player_ids.length} joueur{s.player_ids.length > 1 ? 's' : ''} · créée {ago(s.created_at)}
                  </p>
                  {s.match && (
                    <p className="truncate text-xs font-bold text-muted">
                      {game ? `${game.emoji} ${game.name}` : s.match.game_id} · dernière action {ago(s.match.updated_at ?? s.match.created_at)}
                    </p>
                  )}
                </div>
                <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} onClick={() => setTarget(s)}>
                  Supprimer
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <Modal open={Boolean(target)} onClose={() => setTarget(null)} title="Supprimer la soirée ?">
        {target && (
          <div className="flex flex-col items-center gap-4 text-center">
            <Avatar slug={playerOrPlaceholder(byId, target.host_id).slug} expression="reflexion" size={96} />
            <p>
              La soirée <strong>{target.code}</strong> chez <strong>{name(target.host_id)}</strong> sera fermée pour
              tout le monde ({target.player_ids.map(name).join(', ') || 'personne'}).
            </p>
            <p className="text-sm text-muted">
              {target.match ? 'La partie en cours est annulée, sans points. ' : ''}
              Les parties déjà terminées restent dans l’historique et le classement.
            </p>
            <div className="flex w-full gap-3">
              <Button variant="secondary" fullWidth onClick={() => setTarget(null)}>Annuler</Button>
              <Button variant="danger" fullWidth loading={deleting} onClick={() => void doDelete()}>Supprimer</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  )
}

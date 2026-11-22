import { useState } from 'react'
import { useNavigate } from 'react-router'
import { KeyRound, LogOut, Pencil, RefreshCw } from 'lucide-react'
import { AdminMembres } from '@/features/admin/AdminMembres'
import { usePlayers } from '@/features/soiree/players'
import { AdminSoirees } from '@/features/admin/AdminSoirees'
import { PushReminderCard } from '@/features/push/PushReminderCard'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { Toggle } from '@/components/ui/Toggle'
import { usePWAUpdate } from '@/hooks/usePWAUpdate'
import { logout } from '@/lib/auth'
import { toastRpcError } from '@/lib/rpcError'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toast'
import { useSession } from '@/store/session'
import { useSettings, type Theme } from '@/store/settings'
import { isNoelSeason } from '@/features/noel/season'

const inputCls =
  'sticker-sm min-w-0 flex-1 rounded-card border-[3px] border-ink bg-surface px-3 py-2 font-display text-lg font-extrabold text-text outline-none'

export function SettingsPage() {
  const { theme, sound, haptics, noelDecor, setTheme, setSound, setHaptics, setNoelDecor } = useSettings()
  const profile = useSession((s) => s.profile)
  const patchProfile = useSession((s) => s.patchProfile)
  const navigate = useNavigate()
  const band = usePlayers().list
  const { needRefresh, applyUpdate } = usePWAUpdate()
  const [nick, setNick] = useState<string | null>(null)
  const [savingNick, setSavingNick] = useState(false)
  const [resetSlug, setResetSlug] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const saveNick = async () => {
    if (nick === null) return
    setSavingNick(true)
    try {
      const { data, error } = await supabase.rpc('update_nickname', { p_nickname: nick.trim() })
      if (error) throw error
      patchProfile(data)
      toast.success('Pseudo modifié !')
      setNick(null)
    } catch (e) {
      toastRpcError(e)
    } finally {
      setSavingNick(false)
    }
  }

  const doReset = async () => {
    if (!resetSlug) return
    setResetting(true)
    try {
      const { error } = await supabase.rpc('admin_reset_pin', { p_slug: resetSlug })
      if (error) throw error
      toast.success('Code réinitialisé : le joueur en choisira un nouveau à sa prochaine connexion.')
      setResetSlug(null)
    } catch (e) {
      toastRpcError(e)
    } finally {
      setResetting(false)
    }
  }

  const resetTarget = band.find((c) => c.slug === resetSlug)

  return (
    <StaggerList className="flex flex-col gap-4">
      <StaggerItem>
        <h1 className="text-4xl">Réglages</h1>
      </StaggerItem>
      {profile && (
        <StaggerItem>
          <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar slug={profile.slug} expression={profile.equipped_expression} tenue={profile.equipped_tenue} size={56} />
              <div className="flex-1">
                <p className="font-display text-xl font-extrabold">{profile.nickname}</p>
                <p className="text-sm text-muted">{profile.first_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                aria-label="Pseudo"
                value={nick ?? profile.nickname}
                onChange={(e) => setNick(e.target.value)}
                maxLength={20}
                className={inputCls}
              />
              <Button
                size="sm"
                icon={<Pencil className="size-4" />}
                loading={savingNick}
                disabled={nick === null || !nick.trim() || nick.trim() === profile.nickname}
                onClick={() => void saveNick()}
              >
                Changer
              </Button>
            </div>
          </Card>
        </StaggerItem>
      )}
      <StaggerItem>
        <Card className="flex flex-col gap-3">
          <p className="font-display text-lg font-extrabold">Thème</p>
          <SegmentedControl<Theme>
            ariaLabel="Thème"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: '☀️ Clair' },
              { value: 'dark', label: '🌙 Sombre' },
              { value: 'system', label: '📱 Auto' },
            ]}
          />
        </Card>
      </StaggerItem>
      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="font-display text-lg font-extrabold">🔊 Sons</span>
            <Toggle checked={sound} onChange={setSound} label="Sons" />
          </div>
          <div className="flex items-center justify-between">
            <span className="font-display text-lg font-extrabold">📳 Vibrations</span>
            <Toggle checked={haptics} onChange={setHaptics} label="Vibrations" />
          </div>
          {isNoelSeason() && (
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-extrabold">🎄 Décor de Noël</span>
              <Toggle checked={noelDecor} onChange={setNoelDecor} label="Décor de Noël" />
            </div>
          )}
        </Card>
      </StaggerItem>
      <StaggerItem>
        <PushReminderCard />
      </StaggerItem>
      {profile?.is_admin && (
        <StaggerItem>
          <Card className="flex flex-col gap-3">
            <p className="flex items-center gap-2 font-display text-lg font-extrabold">
              <KeyRound className="size-5" /> Admin : réinitialiser le code d'un joueur
            </p>
            <div className="grid grid-cols-4 gap-2">
              {band.filter((c) => c.slug !== profile.slug).map((c) => (
                <button
                  key={c.slug}
                  onClick={() => setResetSlug(c.slug)}
                  className="flex flex-col items-center gap-0.5 rounded-card py-1 active:scale-95"
                >
                  <Avatar slug={c.slug} size={52} />
                  <span className="max-w-full truncate text-xs font-bold">{c.nickname}</span>
                </button>
              ))}
            </div>
          </Card>
        </StaggerItem>
      )}
      {profile?.is_admin && (
        <StaggerItem>
          <AdminMembres />
        </StaggerItem>
      )}
      {profile?.is_admin && (
        <StaggerItem>
          <AdminSoirees />
        </StaggerItem>
      )}
      <StaggerItem>
        <Button
          variant="secondary"
          fullWidth
          icon={<RefreshCw className="size-5" />}
          onClick={() => (needRefresh ? void applyUpdate() : toast.success('Tu as la dernière version !'))}
        >
          {needRefresh ? "Mettre à jour l'app" : 'Rechercher une mise à jour'}
        </Button>
      </StaggerItem>
      <StaggerItem>
        <Button
          variant="danger"
          fullWidth
          icon={<LogOut className="size-5" />}
          onClick={async () => {
            await logout()
            navigate('/onboarding', { replace: true })
          }}
        >
          Changer de personnage
        </Button>
      </StaggerItem>

      <Modal open={Boolean(resetTarget)} onClose={() => setResetSlug(null)} title="Réinitialiser le code ?">
        {resetTarget && (
          <div className="flex flex-col items-center gap-4 text-center">
            <Avatar slug={resetTarget.slug} expression="reflexion" size={96} />
            <p>
              Le code de <strong>{resetTarget.nickname}</strong> sera effacé et ses appareils déconnectés. Il en choisira un nouveau à sa prochaine connexion.
            </p>
            <div className="flex w-full gap-3">
              <Button variant="secondary" fullWidth onClick={() => setResetSlug(null)}>Annuler</Button>
              <Button variant="danger" fullWidth loading={resetting} onClick={() => void doReset()}>Réinitialiser</Button>
            </div>
          </div>
        )}
      </Modal>
    </StaggerList>
  )
}

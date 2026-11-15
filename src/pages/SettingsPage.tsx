import { useNavigate } from 'react-router'
import { LogOut, RefreshCw } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { Toggle } from '@/components/ui/Toggle'
import { usePWAUpdate } from '@/hooks/usePWAUpdate'
import { toast } from '@/store/toast'
import { useSession } from '@/store/session'
import { useSettings, type Theme } from '@/store/settings'

export function SettingsPage() {
  const { theme, sound, haptics, setTheme, setSound, setHaptics } = useSettings()
  const { profile, logout } = useSession()
  const navigate = useNavigate()
  const { needRefresh, applyUpdate } = usePWAUpdate()

  return (
    <StaggerList className="flex flex-col gap-4">
      <StaggerItem>
        <h1 className="text-4xl">Réglages</h1>
      </StaggerItem>
      {profile && (
        <StaggerItem>
          <Card className="flex items-center gap-3">
            <Avatar slug={profile.slug} expression={profile.equipped_expression} size={56} />
            <div className="flex-1">
              <p className="font-display text-xl font-extrabold">{profile.nickname}</p>
              <p className="text-sm text-muted">{profile.first_name}</p>
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
        </Card>
      </StaggerItem>
      <StaggerItem>
        <Button
          variant="secondary"
          fullWidth
          icon={<RefreshCw className="size-5" />}
          onClick={() => (needRefresh ? void applyUpdate() : toast.success('Tu as la dernière version !'))}
        >
          {needRefresh ? 'Mettre à jour l\'app' : 'Rechercher une mise à jour'}
        </Button>
      </StaggerItem>
      <StaggerItem>
        <Button
          variant="danger"
          fullWidth
          icon={<LogOut className="size-5" />}
          onClick={() => {
            logout()
            navigate('/onboarding', { replace: true })
          }}
        >
          Changer de personnage
        </Button>
      </StaggerItem>
    </StaggerList>
  )
}

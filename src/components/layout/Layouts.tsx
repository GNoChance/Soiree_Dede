import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router'
import { MotionConfig, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { useSession } from '@/store/session'
import { bootSession, refreshProfile } from '@/lib/auth'
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus'
import { ToastHost } from '@/components/ui/Toast'
import { isSupabaseConfigured, SUPABASE_MISSING_MESSAGE } from '@/lib/supabase'
import { LiveSoireeBanner } from '@/features/soiree/SoireeLive'
import { SoireeChat } from '@/features/chat/SoireeChat'
import { AnimatedOutlet } from './AnimatedOutlet'
import { BottomNav } from './BottomNav'
import { UpdatePrompt } from './UpdatePrompt'

/**
 * Haut de page : zone sûre + hauteur du bandeau global « une partie commence »
 * (`--live-banner-h`, publiée par LiveSoireeBanner) : le bandeau pousse la page
 * au lieu de masquer ses boutons.
 */
const TOP_PAD = { paddingTop: 'calc(env(safe-area-inset-top) + var(--live-banner-h, 0px))' } as const

/** Racine : MotionConfig (respect prefers-reduced-motion), toasts, MAJ PWA, banniere Supabase, bandeau des soirées. */
export function Root() {
  useEffect(() => {
    void bootSession()
  }, [])
  return (
    <MotionConfig reducedMotion="user">
      {!isSupabaseConfigured && (
        <div className="pt-safe relative z-50 flex items-start gap-2 border-b-[3px] border-ink bg-tomato px-4 pb-2 text-sm font-bold text-white">
          <AlertTriangle className="mt-2 size-5 shrink-0" />
          <span className="mt-2">{SUPABASE_MISSING_MESSAGE}</span>
        </div>
      )}
      <Outlet />
      <LiveSoireeBanner />
      <SoireeChat />
      <ToastHost />
      <UpdatePrompt />
    </MotionConfig>
  )
}

/** Garde : pas de profil connecte => /onboarding. */
export function RequireProfile() {
  const profile = useSession((s) => s.profile)
  const booted = useSession((s) => s.booted)
  useSessionLifecycle()
  if (!booted) return <Splash />
  if (!profile) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <motion.div
        animate={{ rotate: [0, -8, 8, 0], scale: [1, 1.1, 1] }}
        transition={{ repeat: Infinity, duration: 1.2 }}
        className="text-6xl"
      >
        🎉
      </motion.div>
      <p className="font-display text-xl font-extrabold text-muted">Chargement…</p>
    </div>
  )
}

/** Garde le profil à jour : refetch quand l'app reprend le focus. */
function useSessionLifecycle() {
  useRefetchOnFocus(() => {
    if (useSession.getState().profile) void refreshProfile().catch(() => undefined)
  })
}

/** Layout des 5 onglets, avec barre de navigation inferieure. */
export function TabsLayout() {
  return (
    <div style={TOP_PAD} className="pl-safe pr-safe mx-auto min-h-dvh max-w-md pb-[calc(6.5rem+env(safe-area-inset-bottom))] transition-[padding] duration-200">
      <AnimatedOutlet className="px-4 pt-4" />
      <BottomNav />
    </div>
  )
}

/** Layout plein ecran (salon, partie) sans barre de navigation. */
export function FullLayout() {
  return (
    <div style={TOP_PAD} className="pb-safe pl-safe pr-safe mx-auto min-h-dvh max-w-md transition-[padding] duration-200">
      <AnimatedOutlet className="px-4 pt-4" />
    </div>
  )
}

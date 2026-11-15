import { Navigate, Outlet } from 'react-router'
import { MotionConfig } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { useSession } from '@/store/session'
import { ToastHost } from '@/components/ui/Toast'
import { isSupabaseConfigured, SUPABASE_MISSING_MESSAGE } from '@/lib/supabase'
import { AnimatedOutlet } from './AnimatedOutlet'
import { BottomNav } from './BottomNav'
import { UpdatePrompt } from './UpdatePrompt'

/** Racine : MotionConfig (respect prefers-reduced-motion), toasts, MAJ PWA, banniere Supabase. */
export function Root() {
  return (
    <MotionConfig reducedMotion="user">
      {!isSupabaseConfigured && (
        <div className="pt-safe relative z-50 flex items-start gap-2 border-b-[3px] border-ink bg-tomato px-4 pb-2 text-sm font-bold text-white">
          <AlertTriangle className="mt-2 size-5 shrink-0" />
          <span className="mt-2">{SUPABASE_MISSING_MESSAGE}</span>
        </div>
      )}
      <Outlet />
      <ToastHost />
      <UpdatePrompt />
    </MotionConfig>
  )
}

/** Garde : pas de profil connecte => /onboarding. */
export function RequireProfile() {
  const profile = useSession((s) => s.profile)
  if (!profile) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/** Layout des 5 onglets, avec barre de navigation inferieure. */
export function TabsLayout() {
  return (
    <div className="pt-safe pl-safe pr-safe mx-auto min-h-dvh max-w-md pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
      <AnimatedOutlet className="px-4 pt-4" />
      <BottomNav />
    </div>
  )
}

/** Layout plein ecran (salon, partie) sans barre de navigation. */
export function FullLayout() {
  return (
    <div className="pt-safe pb-safe pl-safe pr-safe mx-auto min-h-dvh max-w-md">
      <AnimatedOutlet className="px-4 pt-4" />
    </div>
  )
}

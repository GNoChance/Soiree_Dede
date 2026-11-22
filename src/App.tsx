import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { FullLayout, RequireProfile, Root, TabsLayout } from '@/components/layout/Layouts'
import { HubPage } from '@/pages/HubPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { FriendsPage } from '@/pages/FriendsPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { LeaderboardPage } from '@/pages/LeaderboardPage'
import { SoireePage } from '@/pages/SoireePage'
import { MatchPage } from '@/pages/MatchPage'
import { TvPage } from '@/pages/TvPage'
import { HistoryDetailPage, HistoryPage } from '@/features/stats/HistoryPages'
import { HeadToHeadPage } from '@/features/stats/HeadToHeadPage'
import { ProfilePage } from '@/features/stats/ProfilePage'
import { DailyPage } from '@/features/daily/DailyPage'
import { AlbumPage } from '@/features/album/AlbumPage'
import { AlbumPrintPage } from '@/features/album/AlbumPrintPage'
import { AdventPage } from '@/features/advent/AdventPage'
import { ChallengesPage } from '@/features/mises/ChallengesPage'
import { SoloRoute } from '@/features/solo/SoloRoute'
import { TrainingRoute } from '@/features/entrainement/TrainingRoute'
import { IdeasPage } from '@/features/idees/IdeasPage'
import { CartesPage } from '@/features/cartes/CartesPage'
import { RouteError } from '@/pages/RouteError'
import { onPushOpen } from '@/features/push/push'
import { GuestJoinPage } from '@/features/guest/GuestJoinPage'

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      // Mode invité : lien du QR code (/invite/<jeton>) ou code tapé à la main (/invite).
      { path: '/invite', element: <GuestJoinPage /> },
      { path: '/invite/:token', element: <GuestJoinPage /> },
      {
        element: <RequireProfile />,
        children: [
          {
            element: <TabsLayout />,
            children: [
              { path: '/', element: <HubPage /> },
              { path: '/inventaire', element: <InventoryPage /> },
              { path: '/classement', element: <LeaderboardPage /> },
              { path: '/amis', element: <FriendsPage /> },
              { path: '/cartes', element: <CartesPage /> },
              { path: '/idees', element: <IdeasPage /> },
              { path: '/historique', element: <HistoryPage /> },
              { path: '/album', element: <AlbumPage /> },
              { path: '/historique/:id', element: <HistoryDetailPage /> },
              { path: '/profil/:id', element: <ProfilePage /> },
              { path: '/face-a-face/:id', element: <HeadToHeadPage /> },
              { path: '/defis-potes', element: <ChallengesPage /> },
              { path: '/parametres', element: <SettingsPage /> },
            ],
          },
          {
            element: <FullLayout />,
            children: [
              { path: '/soiree/:id', element: <SoireePage /> },
              { path: '/partie/:matchId', element: <MatchPage /> },
              { path: '/defi', element: <DailyPage /> },
              { path: '/avent', element: <AdventPage /> },
              { path: '/solo/:gameId', element: <SoloRoute /> },
              { path: '/entrainement/:gameId', element: <TrainingRoute /> },
            ],
          },
          // Livre à imprimer : pleine page, sans gabarit mobile.
          { path: '/album/imprimer', element: <AlbumPrintPage /> },
          // Mode télé : plein écran, hors gabarit mobile.
          { path: '/soiree/:id/tele', element: <TvPage /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

// Clic sur un rappel push avec l'app déjà ouverte : navigation interne (sans rechargement).
onPushOpen((path) => void router.navigate(path))

export default function App() {
  return <RouterProvider router={router} />
}

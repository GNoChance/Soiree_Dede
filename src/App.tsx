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
import { ProfilePage } from '@/features/stats/ProfilePage'
import { DailyPage } from '@/features/daily/DailyPage'
import { SoloRoute } from '@/features/solo/SoloRoute'
import { RouteError } from '@/pages/RouteError'
import { onPushOpen } from '@/features/push/push'

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
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
              { path: '/historique', element: <HistoryPage /> },
              { path: '/historique/:id', element: <HistoryDetailPage /> },
              { path: '/profil/:id', element: <ProfilePage /> },
              { path: '/parametres', element: <SettingsPage /> },
            ],
          },
          {
            element: <FullLayout />,
            children: [
              { path: '/soiree/:id', element: <SoireePage /> },
              { path: '/partie/:matchId', element: <MatchPage /> },
              { path: '/defi', element: <DailyPage /> },
              { path: '/solo/:gameId', element: <SoloRoute /> },
            ],
          },
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

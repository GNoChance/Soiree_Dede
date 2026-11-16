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
import { RouteError } from '@/pages/RouteError'

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
              { path: '/parametres', element: <SettingsPage /> },
            ],
          },
          {
            element: <FullLayout />,
            children: [
              { path: '/soiree/:id', element: <SoireePage /> },
              { path: '/partie/:matchId', element: <MatchPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}

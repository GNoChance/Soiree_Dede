import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initTheme } from './lib/theme'
import { initFeedback } from './lib/feedback'
import { initPushSync } from './features/push/push'

initTheme()
initFeedback()
initPushSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

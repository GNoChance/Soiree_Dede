import { useSettings, type Theme } from '@/store/settings'

const mq = () => window.matchMedia('(prefers-color-scheme: dark)')

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && mq().matches)
  document.documentElement.classList.toggle('dark', dark)
}

/** A appeler une fois au demarrage : applique + suit les changements. */
export function initTheme() {
  applyTheme(useSettings.getState().theme)
  useSettings.subscribe((s, prev) => {
    if (s.theme !== prev.theme) applyTheme(s.theme)
  })
  mq().addEventListener('change', () => applyTheme(useSettings.getState().theme))
}

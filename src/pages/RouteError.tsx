/** Écran d'erreur des routes : remplace la page technique de React Router par un message lisible. */
import { useRouteError } from 'react-router'

export function RouteError() {
  const err = useRouteError()
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper p-6 text-center text-text">
      <span className="text-6xl" aria-hidden>
        🙈
      </span>
      <h1 className="font-display text-2xl font-extrabold">Oups, un bug s’est glissé dans la soirée</h1>
      <p className="max-w-sm text-sm text-muted">Recharge la page : la partie reprend là où elle en était.</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => window.location.reload()} className="sticker rounded-chip bg-sun px-5 py-3 font-display font-extrabold text-[#1f1b2e]">
          Recharger
        </button>
        <a href="/" className="sticker rounded-chip bg-surface px-5 py-3 font-display font-extrabold">
          Accueil
        </a>
      </div>
      {msg && <p className="max-w-sm text-xs break-words text-muted/70">{msg}</p>}
    </div>
  )
}

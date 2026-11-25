import { useNoelStore } from './api'

/** Bandeau « aperçu admin » (pages Noël) : rappelle que rien n'est enregistré, et permet d'en sortir. */
export function PreviewBar() {
  const preview = useNoelStore((s) => s.preview)
  const stop = useNoelStore((s) => s.stopPreview)
  if (!preview) return null
  const day = new Date(preview.day + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  return (
    <div className="sticker-sm flex items-center gap-2 rounded-card bg-sun p-2 pl-3 text-ink">
      <p className="min-w-0 flex-1 text-sm font-bold">
        👀 <span className="font-extrabold">Aperçu du {day}</span> : rien n’est enregistré.
      </p>
      <button
        type="button"
        onClick={stop}
        className="shrink-0 rounded-chip border-2 border-ink bg-surface px-3 py-1 text-sm font-extrabold text-text"
      >
        Quitter
      </button>
    </div>
  )
}

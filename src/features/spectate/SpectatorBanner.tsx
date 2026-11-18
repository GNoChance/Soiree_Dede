import { ArrowLeft } from 'lucide-react'

/** Bandeau « Tu regardes » de l'écran de partie en lecture seule (bouton retour ≥ 44 px). */
export function SpectatorBanner({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  return (
    <div className="sticker flex items-center gap-2 bg-sky p-2 pl-3 text-[#1f1b2e]" role="status">
      <span className="min-w-0 flex-1 font-display text-base leading-tight font-extrabold">
        👀 Tu regardes <span className="font-bold">— tu joues à la prochaine !</span>
      </span>
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-11 shrink-0 items-center gap-1 rounded-full border-[3px] border-ink bg-surface px-3 font-display text-sm font-extrabold shadow-sticker-sm active:scale-95"
      >
        <ArrowLeft className="size-4" strokeWidth={3} /> {backLabel}
      </button>
    </div>
  )
}

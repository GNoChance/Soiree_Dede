import { Avatar } from '@/components/ui/Avatar'
import { hasTenueArt } from '@/components/ui/tenueArt'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import type { GrosLot } from '@/features/noel/grosLot'

const fmt = (n: number) => n.toLocaleString('fr-FR')

/**
 * Plaque souvenir du Gros Lot de Noël (récompense de la Grande Hotte) : la bande autour du sapin
 * (en pyjama de Noël dès que l'art existe, sinon dans sa tenue du moment) + le classement des lutins.
 */
export function AlbumPlaque({ lot }: { lot: GrosLot }) {
  const { byId } = usePlayers()
  const ring = lot.contributors.slice(0, 10)
  return (
    <div className="album-leaf flex flex-col items-center gap-4 rounded-card border-[3px] border-ink bg-[linear-gradient(160deg,#1B4332,#2D6A4F_55%,#9D0208)] p-5 text-center text-white shadow-sticker">
      <p className="rounded-chip border-2 border-[#FFD166] px-3 py-0.5 font-display text-sm font-extrabold tracking-wide text-[#FFD166] uppercase">Plaque souvenir · Noël {lot.year}</p>
      <h2 className="text-3xl leading-tight font-extrabold">La Grande Hotte est pleine !</h2>
      <div className="relative mx-auto aspect-square w-full max-w-80">
        <span className="absolute inset-0 flex items-center justify-center text-[7rem] leading-none" aria-hidden>
          🎄
        </span>
        {ring.map((c, i) => {
          const p = playerOrPlaceholder(byId, c.profile_id)
          const a = (i / ring.length) * 2 * Math.PI - Math.PI / 2
          return (
            <div
              key={c.profile_id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${50 + 41 * Math.cos(a)}%`, top: `${50 + 41 * Math.sin(a)}%` }}
            >
              <Avatar slug={p.slug} tenue={hasTenueArt(p.slug, 'pyjama_noel') ? 'pyjama_noel' : p.equippedTenue} frame={null} fx={null} size={ring.length > 7 ? 48 : 58} />
            </div>
          )
        })}
      </div>
      <p className="font-display text-2xl font-extrabold">{fmt(lot.total)} ❄️ apportés ensemble</p>
      <ol className="flex w-full flex-col gap-1 rounded-card bg-white/10 p-3 text-left">
        {lot.contributors.map((c, i) => {
          const p = playerOrPlaceholder(byId, c.profile_id)
          return (
            <li key={c.profile_id} className="flex items-center gap-2 font-bold">
              <span className="w-7 text-center font-display font-extrabold">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{p.nickname}</span>
              <span className="font-display font-extrabold tabular-nums">{fmt(c.flakes)} ❄️</span>
            </li>
          )
        })}
      </ol>
      <p className="text-sm font-bold text-white/85">Merci la bande ! Trophée « Esprit d’équipe {lot.year} » pour tous les lutins qui ont apporté au moins 400 ❄️.</p>
    </div>
  )
}

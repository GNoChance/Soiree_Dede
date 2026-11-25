import { Avatar } from '@/components/ui/Avatar'
import type { ItemDef } from '@/data/cadeaux'
import { useSession } from '@/store/session'

const INK = '#1f1b2e'

/** Aperçu visuel d'un cadeau / article (vignette de la boutique et de l'onglet Déco). */
export function ItemPreview({ it, size = 48 }: { it: ItemDef; size?: number }) {
  const profile = useSession((s) => s.profile)
  if (it.slot === 'frame' && profile) {
    return <Avatar slug={profile.slug} expression={profile.equipped_expression} tenue={profile.equipped_tenue} frame={it.id} fx={null} size={size * 0.92} />
  }
  if (it.slot === 'fx_avatar' && profile) {
    return <Avatar slug={profile.slug} expression={profile.equipped_expression} tenue={profile.equipped_tenue} frame={null} fx={it.id} size={Math.max(48, size * 0.92)} />
  }
  if (it.cardBack) {
    return (
      <span
        className="flex items-center justify-center overflow-hidden rounded-md border-2 border-ink leading-none"
        style={{ width: size * 0.72, height: size, background: it.cardBack.bg, fontSize: size * 0.32 }}
      >
        {it.cardBack.emoji}
      </span>
    )
  }
  if (it.dice) {
    const d = it.dice
    return (
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
        <rect x="4" y="8" width="92" height="88" rx="22" fill={INK} />
        <rect x="4" y="4" width="88" height="88" rx="22" fill={d.face} stroke={INK} strokeWidth="6" />
        {[[28, 28], [64, 28], [46, 46], [28, 64], [64, 64]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="9.5" fill={d.pip} />
        ))}
      </svg>
    )
  }
  if (it.marks) {
    const m = it.marks
    const paths = ['M 25 24 L 76 77', 'M 76 24 L 24 76']
    return (
      <svg viewBox="0 0 100 100" width={size} height={size} style={m.glow ? { filter: `drop-shadow(0 0 5px ${m.glow})` } : undefined} aria-hidden>
        <rect x="0" y="0" width="100" height="100" rx="18" fill={m.outline === '#F4F1EA' ? '#2F3E46' : '#fff6e5'} />
        {paths.map((d) => <path key={d} d={d} stroke={m.outline} strokeWidth="18" strokeLinecap="round" />)}
        {paths.map((d) => <path key={`c${d}`} d={d} stroke="#FF4D6D" strokeWidth="11" strokeLinecap="round" strokeDasharray={m.dash ? '14 7' : undefined} />)}
      </svg>
    )
  }
  const ball = it.golf ?? it.bowling
  if (it.kart?.body || (ball && !('style' in ball && ball.style))) {
    const bg = it.kart?.body ?? it.golf?.color ?? it.bowling?.color ?? '#fff'
    const band = it.golf?.stripe ?? it.bowling?.band
    return (
      <span
        className="flex items-center justify-center rounded-full border-[3px] border-ink leading-none"
        style={{ width: size, height: size, background: band ? `linear-gradient(90deg, ${bg} 42%, ${band} 42% 58%, ${bg} 58%)` : bg, fontSize: size * 0.45 }}
      >
        {it.kart ? '🏎️' : ''}
      </span>
    )
  }
  return <span className="leading-none" style={{ fontSize: size * 0.62 }}>{it.emoji}</span>
}
